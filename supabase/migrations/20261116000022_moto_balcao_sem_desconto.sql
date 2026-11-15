-- =====================================================================
-- Vendedor sem desconto, venda sem estoque, entrega de moto e balcão
--  * vendedor não dá desconto: qualquer mudança no preço espera aprovação
--  * estoque zerado: o vendedor pode vender, o produto espera aprovação
--  * cada pedido tem um tipo de entrega: caminhão (carga), moto ou balcão
--    - moto: tela simples no celular (mapa, ligar, entregue)
--    - balcão: o cliente leva na hora, o pedido já nasce entregue
-- =====================================================================
alter table public.pedidos add column if not exists entrega text not null default 'caminhao';
alter table public.pedidos drop constraint if exists pedidos_entrega_check;
alter table public.pedidos add constraint pedidos_entrega_check check (entrega in ('caminhao', 'moto', 'balcao'));
alter table public.pedidos add column if not exists entregue_em timestamptz;
alter table public.pedido_itens add column if not exists motivo_aprovacao text;
create index if not exists pedidos_entrega_pendente on public.pedidos (entrega) where status = 'liberado' and carga_id is null;

-- quem tem a permissão "moto" vê os pedidos de moto e os clientes
drop policy if exists pedidos_ler on public.pedidos;
create policy pedidos_ler on public.pedidos for select to authenticated
  using (vendedor_id = auth.uid() or tem_perm('pedidos_ver_todos') or tem_perm('cargas') or tem_perm('conferencia')
         or (entrega = 'moto' and tem_perm('moto')));
drop policy if exists clientes_ler on public.clientes;
create policy clientes_ler on public.clientes for select to authenticated
  using (
    vendedor_id = auth.uid()
    or rota_id = any (rotas_do_vendedor(auth.uid()))
    or tem_perm('clientes') or tem_perm('pedidos_ver_todos') or tem_perm('cargas')
    or tem_perm('conferencia') or tem_perm('financeiro') or tem_perm('cadastros') or tem_perm('moto')
  );

drop function if exists public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid);
create or replace function public.criar_pedido(
  p_client_id uuid, p_cliente_id uuid, p_itens jsonb,
  p_observacao text default null, p_feito_em timestamptz default null,
  p_vendedor_id uuid default null, p_entrega text default 'caminhao')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_perfil   perfis;
  v_pedido   pedidos;
  v_prod     produtos;
  v_item     record;
  v_faltas   jsonb := '[]'::jsonb;
  v_aprovar  boolean := false;
  v_unit     numeric;
  v_total    numeric := 0;
  v_peso     numeric := 0;
  v_vendedor uuid;
  v_dono     uuid;     -- vendedor dono do cliente
  v_escritorio boolean;
  v_rota     uuid;
begin
  select * into v_perfil from perfis where id = auth.uid() and ativo;
  if not found or not (v_perfil.admin or 'pedidos_criar' = any (v_perfil.permissoes)
                       or 'pedidos_ver_todos' = any (v_perfil.permissoes)) then
    raise exception 'Você não tem permissão para fazer pedidos.' using errcode = '42501';
  end if;

  -- Já recebido antes (reenvio do celular)? Devolve o mesmo pedido.
  if p_client_id is not null then
    select * into v_pedido from pedidos where client_id = p_client_id;
    if found then
      return jsonb_build_object('id', v_pedido.id, 'numero', v_pedido.numero, 'status', v_pedido.status, 'duplicado', true);
    end if;
  end if;

  select vendedor_id, rota_id into v_dono, v_rota from clientes where id = p_cliente_id and ativo;
  if not found then
    raise exception 'Cliente não encontrado ou inativo.';
  end if;

  -- Cada cliente é de um vendedor. O vendedor só faz pedido para os clientes dele.
  -- Administrador: a venda é de quem fez (ele mesmo), para qualquer cliente;
  --   pode escolher creditar ao dono do cliente (p_vendedor_id).
  -- Escritório sem ser administrador: lança no nome do dono do cliente.
  v_escritorio := v_perfil.admin or 'pedidos_ver_todos' = any (v_perfil.permissoes);
  v_vendedor := coalesce(p_vendedor_id,
                         case when v_perfil.admin then v_perfil.id
                              when v_escritorio and v_dono is not null then v_dono
                              else v_perfil.id end);
  if v_vendedor <> v_perfil.id and not v_escritorio then
    raise exception 'Você só pode lançar pedidos no seu próprio nome.' using errcode = '42501';
  end if;
  if v_vendedor <> v_perfil.id and not exists (select 1 from perfis where id = v_vendedor and ativo) then
    raise exception 'Vendedor não encontrado ou inativo.';
  end if;
  -- bairro/rota compartilhado: quem tem a rota na agenda (ou é o responsável) vende para todos os clientes dela
  if v_rota is not null and v_rota = any (rotas_do_vendedor(v_vendedor)) then
    v_dono := v_vendedor;
  end if;
  if v_dono is null and not v_escritorio then
    raise exception 'Este cliente ainda não tem vendedor. Peça ao escritório para colocar o cliente na sua carteira.' using errcode = '42501';
  end if;
  -- administrador pode tudo: qualquer cliente, qualquer vendedor
  if v_dono is not null and v_vendedor <> v_dono and not v_perfil.admin then
    raise exception 'Este cliente é do vendedor %. Só ele pode ter pedidos para este cliente.',
      (select nome from perfis where id = v_dono) using errcode = '42501';
  end if;
  if coalesce(p_entrega, 'caminhao') not in ('caminhao', 'moto', 'balcao') then
    raise exception 'Tipo de entrega inválido.';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'O pedido não tem itens.';
  end if;
  if (select count(*) <> count(distinct e->>'produto_id') from jsonb_array_elements(p_itens) e) then
    raise exception 'Há produto repetido no pedido.';
  end if;

  -- Trava os produtos (ordem fixa, evita deadlock) e valida tudo antes de gravar
  perform 1 from produtos
   where id in (select (e->>'produto_id')::uuid from jsonb_array_elements(p_itens) e)
   order by id for update;

  for v_item in
    select (e->>'produto_id')::uuid as produto_id,
           (e->>'quantidade')::numeric as qtd,
           coalesce((e->>'desconto_pct')::numeric, 0) as desconto,
           nullif(e->>'preco_unit', '')::numeric as preco_inf
      from jsonb_array_elements(p_itens) e
  loop
    select * into v_prod from produtos where id = v_item.produto_id;
    if not found or not v_prod.ativo then
      raise exception 'Produto não encontrado ou inativo.';
    end if;
    if not _quantidade_valida(v_prod, v_item.qtd) then
      raise exception 'Quantidade inválida para %: %', v_prod.nome, v_item.qtd;
    end if;
    if v_item.desconto < 0 or v_item.desconto > 100 then
      raise exception 'Desconto inválido para %.', v_prod.nome;
    end if;
    if v_item.preco_inf is not null and v_item.preco_inf <= 0 then
      raise exception 'Preço inválido para %.', v_prod.nome;
    end if;
    -- preço digitado pelo vendedor (ou, em versões antigas do app, a % de desconto)
    v_unit := coalesce(round(v_item.preco_inf, 2), round(v_prod.preco * (1 - v_item.desconto / 100), 2));
    -- vendedor não dá desconto: qualquer mudança no preço espera aprovação
    if v_unit <> v_prod.preco and not v_perfil.admin then
      v_aprovar := true;
    end if;
    -- sem estoque: o vendedor pode vender, mas espera aprovação; o administrador é avisado
    if v_prod.estoque < v_item.qtd and not v_perfil.admin then
      v_aprovar := true;
    elsif v_prod.estoque < v_item.qtd then
      v_faltas := v_faltas || jsonb_build_object(
        'produto_id', v_prod.id, 'produto', v_prod.nome,
        'pedido', v_item.qtd, 'disponivel', greatest(v_prod.estoque, 0));
    end if;
  end loop;

  if jsonb_array_length(v_faltas) > 0 then
    raise exception 'ESTOQUE_INSUFICIENTE' using detail = v_faltas::text;
  end if;

  insert into pedidos (client_id, cliente_id, vendedor_id, status, observacao, feito_em, entrega, entregue_em)
  values (p_client_id, p_cliente_id, v_vendedor,
          case when v_aprovar then 'aguardando_aprovacao' when p_entrega = 'balcao' then 'entregue' else 'liberado' end,
          nullif(trim(p_observacao), ''), coalesce(p_feito_em, now()), coalesce(p_entrega, 'caminhao'),
          case when not v_aprovar and p_entrega = 'balcao' then now() end)
  returning * into v_pedido;

  for v_item in
    select (e->>'produto_id')::uuid as produto_id,
           (e->>'quantidade')::numeric as qtd,
           coalesce((e->>'desconto_pct')::numeric, 0) as desconto,
           nullif(e->>'preco_unit', '')::numeric as preco_inf
      from jsonb_array_elements(p_itens) e
  loop
    select * into v_prod from produtos where id = v_item.produto_id;
    v_unit := coalesce(round(v_item.preco_inf, 2), round(v_prod.preco * (1 - v_item.desconto / 100), 2));
    insert into pedido_itens (pedido_id, produto_id, quantidade, preco_tabela, desconto_pct, preco_unit, total, peso_kg, custo_unit, precisa_aprovacao, motivo_aprovacao)
    values (v_pedido.id, v_prod.id, v_item.qtd, v_prod.preco,
            case when v_prod.preco > 0 then least(100, greatest(0, round((v_prod.preco - v_unit) / v_prod.preco * 100, 2))) else 0 end,
            v_unit, round(v_unit * v_item.qtd, 2), v_prod.peso_kg * v_item.qtd, v_prod.custo,
            not v_perfil.admin and (v_unit <> v_prod.preco or v_prod.estoque < v_item.qtd),
            case when v_perfil.admin then null
                 else nullif(concat_ws(' e ', case when v_unit <> v_prod.preco then 'preço mudado' end,
                                              case when v_prod.estoque < v_item.qtd then 'sem estoque' end), '') end);
    v_total := v_total + round(v_unit * v_item.qtd, 2);
    v_peso  := v_peso + v_prod.peso_kg * v_item.qtd;
    perform _mover_estoque(v_prod.id, -v_item.qtd, 'venda', v_pedido.id, null, null,
                           v_prod.preco, greatest(0, round((v_prod.preco - v_unit) * v_item.qtd, 2)));
  end loop;

  update pedidos set total = v_total, peso_kg = v_peso where id = v_pedido.id;

  return jsonb_build_object('id', v_pedido.id, 'numero', v_pedido.numero, 'status', v_pedido.status, 'duplicado', false);
end $$;

create or replace function public._fechar_aprovacao(p_pedido uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_status text; v_itens int; v_pend int;
begin
  select count(*), count(*) filter (where precisa_aprovacao) into v_itens, v_pend from pedido_itens where pedido_id = p_pedido;
  update pedidos set total = coalesce((select sum(total) from pedido_itens where pedido_id = p_pedido), 0),
                     peso_kg = coalesce((select sum(peso_kg) from pedido_itens where pedido_id = p_pedido), 0)
   where id = p_pedido;
  select status into v_status from pedidos where id = p_pedido;
  if v_status = 'aguardando_aprovacao' then
    if v_itens = 0 then
      update pedidos set status = 'recusado', aprovado_por = auth.uid(), aprovado_em = now() where id = p_pedido;
      return 'recusado';
    elsif v_pend = 0 then
      update pedidos set status = case when entrega = 'balcao' then 'entregue' else 'liberado' end,
             entregue_em = case when entrega = 'balcao' then now() end,
             aprovado_por = auth.uid(), aprovado_em = now() where id = p_pedido
      returning status into v_status;
      return v_status;
    end if;
  end if;
  return v_status;
end $$;
revoke execute on function public._fechar_aprovacao(uuid) from public, anon, authenticated;

create or replace function public.aprovar_pedido(p_pedido uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not eh_admin() then raise exception 'Só administradores aprovam pedidos.' using errcode = '42501'; end if;
  update pedidos set status = case when entrega = 'balcao' then 'entregue' else 'liberado' end,
         entregue_em = case when entrega = 'balcao' then now() end,
         aprovado_por = auth.uid(), aprovado_em = now()
   where id = p_pedido and status = 'aguardando_aprovacao';
  if not found then raise exception 'Pedido não está aguardando aprovação.'; end if;
  update pedido_itens set precisa_aprovacao = false where pedido_id = p_pedido;
end $$;

-- muda o tipo de entrega (antes de ir para uma carga)
create or replace function public.mudar_entrega(p_pedido uuid, p_entrega text)
returns text language plpgsql security definer set search_path = public as $$
declare v pedidos;
begin
  if not (tem_perm('pedidos_ver_todos') or tem_perm('cargas')) then
    raise exception 'Sem permissão para mudar a entrega.' using errcode = '42501';
  end if;
  if p_entrega not in ('caminhao', 'moto', 'balcao') then raise exception 'Tipo de entrega inválido.'; end if;
  select * into v from pedidos where id = p_pedido for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v.carga_id is not null then raise exception 'Este pedido já está numa carga. Tire da carga primeiro.'; end if;
  if v.status not in ('aguardando_aprovacao', 'liberado') then
    raise exception 'Só dá para mudar a entrega de pedido liberado ou aguardando aprovação.';
  end if;
  update pedidos set entrega = p_entrega,
         status = case when status = 'liberado' and p_entrega = 'balcao' then 'entregue' else status end,
         entregue_em = case when status = 'liberado' and p_entrega = 'balcao' then now() end
   where id = p_pedido returning status into v.status;
  return v.status;
end $$;

-- entrega de moto: marca como entregue (ou volta para "a entregar")
create or replace function public.entregar_moto(p_pedido uuid, p_entregue boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (tem_perm('moto') or tem_perm('pedidos_ver_todos')) then
    raise exception 'Sem permissão para entregas de moto.' using errcode = '42501';
  end if;
  if p_entregue then
    update pedidos set status = 'entregue', entregue_em = now()
     where id = p_pedido and entrega = 'moto' and status = 'liberado';
    if not found then raise exception 'Este pedido não está esperando entrega de moto.'; end if;
  else
    update pedidos set status = 'liberado', entregue_em = null
     where id = p_pedido and entrega = 'moto' and status = 'entregue' and carga_id is null;
    if not found then raise exception 'Não deu para desfazer.'; end if;
  end if;
end $$;

-- cliente "CONSUMIDOR BALCÃO" para vendas rápidas no balcão (cria se não existir)
create or replace function public.cliente_balcao()
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not tem_perm('pedidos_ver_todos') then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select id into v from clientes where razao_social = 'CONSUMIDOR BALCÃO' order by ativo desc limit 1;
  if v is null then
    insert into clientes (razao_social, vendedor_id, observacao)
    values ('CONSUMIDOR BALCÃO', auth.uid(), 'Vendas rápidas no balcão')
    returning id into v;
  else
    update clientes set ativo = true where id = v and not ativo;
  end if;
  return v;
end $$;

revoke execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid, text) from public, anon;
grant execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid, text) to authenticated;
revoke execute on function public.aprovar_pedido(uuid) from public, anon;
grant execute on function public.aprovar_pedido(uuid) to authenticated;
revoke execute on function public.mudar_entrega(uuid, text) from public, anon;
grant execute on function public.mudar_entrega(uuid, text) to authenticated;
revoke execute on function public.entregar_moto(uuid, boolean) from public, anon;
grant execute on function public.entregar_moto(uuid, boolean) to authenticated;
revoke execute on function public.cliente_balcao() from public, anon;
grant execute on function public.cliente_balcao() to authenticated;

create or replace function public.versao_banco() returns integer language sql stable as $$ select 22 $$;
