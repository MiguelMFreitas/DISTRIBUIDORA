-- =====================================================================
-- ATUALIZAÇÕES 21 a 26 juntas (cole tudo no SQL Editor do Supabase e clique em Run)
-- Pode rodar mesmo se já rodou alguma delas antes (por exemplo a 21 a 24): não estraga nada.
-- 21 desconto por preço · 22 moto, balcão e venda sem estoque · 23 vários bairros por período
-- 24 link de pedidos e Aparência · 25 abastecimento · 26 combustível
-- =====================================================================

-- >>> 20261115000021_desconto_por_preco.sql
-- =====================================================================
-- Desconto por PREÇO e aprovação produto por produto
--  * o vendedor digita o preço de venda; o sistema calcula a %
--    (o limite de % do vendedor continua valendo: abaixo do preço mínimo,
--     aquele produto fica "precisa de aprovação")
--  * o administrador aprova, edita ou recusa CADA produto; recusar apaga só
--    aquele produto (devolve o estoque) e o resto do pedido segue normal
-- =====================================================================
alter table public.pedido_itens add column if not exists precisa_aprovacao boolean not null default false;

-- preço mínimo cadastrado no produto (vazio = só vale o limite de % do vendedor)
alter table public.produtos add column if not exists preco_minimo numeric(12,2) check (preco_minimo is null or preco_minimo >= 0);
grant insert (preco_minimo), update (preco_minimo) on public.produtos to authenticated;

-- preço mínimo de um produto para um vendedor:
--   o maior entre o preço mínimo do cadastro e o limite de % do vendedor (administrador: só o do cadastro)
create or replace function public.preco_minimo_para(p_prod produtos, p_perfil perfis)
returns numeric language sql immutable as $$
  select greatest(coalesce(p_prod.preco_minimo, 0),
                  case when p_perfil.admin then 0 else round(p_prod.preco * (1 - p_perfil.desconto_max / 100), 2) end)
$$;

-- pedidos que já estão aguardando: marca os produtos acima do limite do vendedor
update public.pedido_itens i set precisa_aprovacao = true
  from public.pedidos p join public.perfis pf on pf.id = p.vendedor_id
 where p.id = i.pedido_id and p.status = 'aguardando_aprovacao' and i.desconto_pct > pf.desconto_max;

create or replace function public.criar_pedido(
  p_client_id uuid, p_cliente_id uuid, p_itens jsonb,
  p_observacao text default null, p_feito_em timestamptz default null,
  p_vendedor_id uuid default null)
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
    if v_unit < preco_minimo_para(v_prod, v_perfil) and not v_perfil.admin then
      v_aprovar := true;
    end if;
    if v_prod.estoque < v_item.qtd then
      v_faltas := v_faltas || jsonb_build_object(
        'produto_id', v_prod.id, 'produto', v_prod.nome,
        'pedido', v_item.qtd, 'disponivel', greatest(v_prod.estoque, 0));
    end if;
  end loop;

  if jsonb_array_length(v_faltas) > 0 then
    raise exception 'ESTOQUE_INSUFICIENTE' using detail = v_faltas::text;
  end if;

  insert into pedidos (client_id, cliente_id, vendedor_id, status, observacao, feito_em)
  values (p_client_id, p_cliente_id, v_vendedor,
          case when v_aprovar then 'aguardando_aprovacao' else 'liberado' end,
          nullif(trim(p_observacao), ''), coalesce(p_feito_em, now()))
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
    insert into pedido_itens (pedido_id, produto_id, quantidade, preco_tabela, desconto_pct, preco_unit, total, peso_kg, custo_unit, precisa_aprovacao)
    values (v_pedido.id, v_prod.id, v_item.qtd, v_prod.preco,
            case when v_prod.preco > 0 then least(100, greatest(0, round((v_prod.preco - v_unit) / v_prod.preco * 100, 2))) else 0 end,
            v_unit, round(v_unit * v_item.qtd, 2), v_prod.peso_kg * v_item.qtd, v_prod.custo,
            v_unit < preco_minimo_para(v_prod, v_perfil) and not v_perfil.admin);
    v_total := v_total + round(v_unit * v_item.qtd, 2);
    v_peso  := v_peso + v_prod.peso_kg * v_item.qtd;
    perform _mover_estoque(v_prod.id, -v_item.qtd, 'venda', v_pedido.id, null, null,
                           v_prod.preco, greatest(0, round((v_prod.preco - v_unit) * v_item.qtd, 2)));
  end loop;

  update pedidos set total = v_total, peso_kg = v_peso where id = v_pedido.id;

  return jsonb_build_object('id', v_pedido.id, 'numero', v_pedido.numero, 'status', v_pedido.status, 'duplicado', false);
end $$;

-- recalcula total/peso do pedido; sem produto pendente, libera; sem produto nenhum, recusa
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
      update pedidos set status = 'liberado', aprovado_por = auth.uid(), aprovado_em = now() where id = p_pedido;
      return 'liberado';
    end if;
  end if;
  return v_status;
end $$;
revoke execute on function public._fechar_aprovacao(uuid) from public, anon, authenticated;

create or replace function public._item_editavel(p_item uuid)
returns pedido_itens language plpgsql security definer set search_path = public as $$
declare v pedido_itens; v_status text;
begin
  if not eh_admin() then raise exception 'Só administradores aprovam descontos.' using errcode = '42501'; end if;
  select * into v from pedido_itens where id = p_item for update;
  if not found then raise exception 'Produto do pedido não encontrado.'; end if;
  select status into v_status from pedidos where id = v.pedido_id for update;
  if v_status not in ('aguardando_aprovacao', 'liberado') then
    raise exception 'Este pedido já saiu para entrega e não pode mais ser alterado.';
  end if;
  return v;
end $$;
revoke execute on function public._item_editavel(uuid) from public, anon, authenticated;

-- aprova o desconto de um produto
create or replace function public.aprovar_item(p_item uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v pedido_itens;
begin
  v := _item_editavel(p_item);
  update pedido_itens set precisa_aprovacao = false where id = p_item;
  return _fechar_aprovacao(v.pedido_id);
end $$;

-- recusa um produto: sai do pedido e o estoque volta
create or replace function public.recusar_item(p_item uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v pedido_itens;
begin
  v := _item_editavel(p_item);
  perform _mover_estoque(v.produto_id, v.quantidade, 'cancelamento', v.pedido_id, null, 'Produto recusado no pedido',
                         v.preco_tabela, greatest(0, round(v.preco_tabela * v.quantidade - v.total, 2)));
  delete from pedido_itens where id = p_item;
  return _fechar_aprovacao(v.pedido_id);
end $$;

-- edita preço e/ou quantidade de um produto (e já aprova)
create or replace function public.editar_item(p_item uuid, p_quantidade numeric, p_preco_unit numeric)
returns text language plpgsql security definer set search_path = public as $$
declare v pedido_itens; v_prod produtos; v_dif numeric;
begin
  v := _item_editavel(p_item);
  select * into v_prod from produtos where id = v.produto_id for update;
  if not _quantidade_valida(v_prod, p_quantidade) then raise exception 'Quantidade inválida: %', p_quantidade; end if;
  if p_preco_unit is null or p_preco_unit <= 0 then raise exception 'Preço inválido.'; end if;
  v_dif := p_quantidade - v.quantidade;
  if v_dif > 0 and v_prod.estoque < v_dif then
    raise exception 'Só tem % de % em estoque.', v_prod.estoque, v_prod.nome;
  end if;
  if v_dif <> 0 then
    perform _mover_estoque(v.produto_id, -v_dif, case when v_dif > 0 then 'venda' else 'cancelamento' end, v.pedido_id, null,
                           'Produto editado na aprovação', round(p_preco_unit, 2), 0);
  end if;
  update pedido_itens set quantidade = p_quantidade, preco_unit = round(p_preco_unit, 2),
         desconto_pct = case when preco_tabela > 0 then least(100, greatest(0, round((preco_tabela - round(p_preco_unit, 2)) / preco_tabela * 100, 2))) else 0 end,
         total = round(round(p_preco_unit, 2) * p_quantidade, 2), peso_kg = v_prod.peso_kg * p_quantidade, precisa_aprovacao = false
   where id = p_item;
  return _fechar_aprovacao(v.pedido_id);
end $$;

-- aprovar o pedido inteiro também tira a marca dos produtos
create or replace function public.aprovar_pedido(p_pedido uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not eh_admin() then raise exception 'Só administradores aprovam pedidos.' using errcode = '42501'; end if;
  update pedidos set status = 'liberado', aprovado_por = auth.uid(), aprovado_em = now()
   where id = p_pedido and status = 'aguardando_aprovacao';
  if not found then raise exception 'Pedido não está aguardando aprovação.'; end if;
  update pedido_itens set precisa_aprovacao = false where pedido_id = p_pedido;
end $$;

grant execute on function public.preco_minimo_para(public.produtos, public.perfis) to authenticated;
revoke execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid) from public, anon;
grant execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid) to authenticated;
revoke execute on function public.aprovar_item(uuid) from public, anon;
grant execute on function public.aprovar_item(uuid) to authenticated;
revoke execute on function public.recusar_item(uuid) from public, anon;
grant execute on function public.recusar_item(uuid) to authenticated;
revoke execute on function public.editar_item(uuid, numeric, numeric) from public, anon;
grant execute on function public.editar_item(uuid, numeric, numeric) to authenticated;

create or replace function public.versao_banco() returns integer language sql stable as $$ select 21 $$;

-- >>> 20261116000022_moto_balcao_sem_desconto.sql
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

-- >>> 20261116000023_varios_bairros_por_periodo.sql
-- =====================================================================
-- Agenda: o vendedor pode visitar mais de um bairro no mesmo período
-- (ex.: segunda de manhã SERRINHA e CENTRO). Cada bairro continua separado
-- no celular, nas visitas do dia e no romaneio.
-- =====================================================================
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.agenda_visitas'::regclass and contype = 'u'
  loop
    execute format('alter table public.agenda_visitas drop constraint %I', c);
  end loop;
end $$;
alter table public.agenda_visitas
  add constraint agenda_visitas_vendedor_dia_turno_rota_key unique (vendedor_id, dia_semana, turno, rota_id);

create or replace function public.salvar_agenda(p_vendedor uuid, p_itens jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_dono uuid;
begin
  if not (tem_perm('clientes') or tem_perm('cadastros')) then
    raise exception 'Você não tem permissão para mudar a agenda.' using errcode = '42501';
  end if;
  if not exists (select 1 from perfis where id = p_vendedor and ativo) then
    raise exception 'Vendedor não encontrado ou inativo.';
  end if;

  for r in select distinct (e->>'rota_id')::uuid as rota_id
             from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
            where nullif(e->>'rota_id', '') is not null
  loop
    select vendedor_id into v_dono from rotas where id = r.rota_id;
    if not found then raise exception 'Bairro não encontrado.'; end if;
    if v_dono is null then
      perform definir_vendedor_rota(r.rota_id, p_vendedor, true);
    end if;  -- bairro de outro vendedor: fica compartilhado (os dois vendem nele)
  end loop;

  delete from agenda_visitas where vendedor_id = p_vendedor;
  insert into agenda_visitas (vendedor_id, dia_semana, turno, rota_id)
  select distinct p_vendedor, (e->>'dia')::smallint, e->>'turno', (e->>'rota_id')::uuid
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
   where nullif(e->>'rota_id', '') is not null;
end $$;

create or replace function public.versao_banco() returns integer language sql stable as $$ select 23 $$;

-- >>> 20261116000024_link_de_pedidos.sql
-- =====================================================================
-- Link de pedidos: o cliente abre um link (sem login), escolhe os produtos,
-- informa nome, telefone e endereço, escolhe dinheiro (com ou sem troco) ou Pix
-- e finaliza. O pedido:
--   * entra LIBERADO, marcado como "pelo link", para entrega de MOTO
--     (o escritório pode mudar para caminhão e pôr num romaneio)
--   * conta para o "vendedor" 🔗 Pedidos pelo link
--   * não cadastra o cliente: os dados ficam só no pedido
--     (o escritório pode cadastrar depois, com um botão)
-- =====================================================================

-- ---------- o "vendedor" do link ----------
do $$
declare
  v_id uuid := 'f0000000-0000-4000-8000-00000000c0de';
  v_email text := 'link-de-pedidos@usuarios.distribuidora.app';
begin
  if not exists (select 1 from auth.users where id = v_id) then
    if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'aud') then
      -- usuário sem senha e sem e-mail confirmado: ninguém entra com ele
      execute format($f$insert into auth.users (id, instance_id, email, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
                       values (%L, '00000000-0000-0000-0000-000000000000', %L, 'authenticated', 'authenticated', '{"provider":"email","providers":["email"]}', '{}', now(), now())$f$, v_id, v_email);
    else
      insert into auth.users (id, email) values (v_id, v_email);
    end if;
  end if;
  insert into public.perfis (id, nome, usuario, admin, permissoes, ativo)
  values (v_id, '🔗 Pedidos pelo link', 'link-de-pedidos', false, '{}', true)
  on conflict (id) do nothing;
end $$;

-- ---------- cliente genérico (os dados de verdade ficam no pedido) ----------
insert into public.clientes (id, razao_social, vendedor_id, observacao)
values ('f0000000-0000-4000-8000-00000000c11e', 'PEDIDOS PELO LINK', 'f0000000-0000-4000-8000-00000000c0de',
        'Cliente automático dos pedidos feitos pelo link. Não apague.')
on conflict (id) do nothing;

-- ---------- dados do pedido feito pelo link ----------
alter table public.pedidos add column if not exists origem text not null default 'sistema';
alter table public.pedidos drop constraint if exists pedidos_origem_check;
alter table public.pedidos add constraint pedidos_origem_check check (origem in ('sistema', 'link'));
alter table public.pedidos add column if not exists contato_nome text;
alter table public.pedidos add column if not exists contato_telefone text;
alter table public.pedidos add column if not exists contato_endereco text;
alter table public.pedidos add column if not exists contato_bairro text;
alter table public.pedidos add column if not exists contato_referencia text;
alter table public.pedidos add column if not exists pagamento text;
alter table public.pedidos drop constraint if exists pedidos_pagamento_check;
alter table public.pedidos add constraint pedidos_pagamento_check check (pagamento is null or pagamento in ('dinheiro', 'pix'));
alter table public.pedidos add column if not exists troco_para numeric(12,2);
alter table public.pedidos add column if not exists visto_em timestamptz;   -- quando o escritório olhou
create index if not exists pedidos_link_nao_visto on public.pedidos (feito_em) where origem = 'link' and visto_em is null;

-- ---------- configuração do link ----------
create table if not exists public.configuracoes (
  chave text primary key,
  valor jsonb not null
);
alter table public.configuracoes enable row level security;
revoke all on public.configuracoes from anon;
drop policy if exists configuracoes_ler on public.configuracoes;
create policy configuracoes_ler on public.configuracoes for select to authenticated using (true);
drop policy if exists configuracoes_gravar on public.configuracoes;
create policy configuracoes_gravar on public.configuracoes for all to authenticated using (eh_admin()) with check (eh_admin());
grant select, insert, update on public.configuracoes to authenticated;
insert into public.configuracoes (chave, valor)
values ('link_pedidos', '{"ligado": true, "aviso": "Faça seu pedido! Entregamos no seu endereço."}')
on conflict (chave) do nothing;

-- ---------- catálogo público (sem login) ----------
create or replace function public.loja_catalogo()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ligado', coalesce((select (valor->>'ligado')::boolean from configuracoes where chave = 'link_pedidos'), false),
    'aviso', (select valor->>'aviso' from configuracoes where chave = 'link_pedidos'),
    'produtos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'nome', p.nome, 'unidade', p.unidade, 'permite_meia', p.permite_meia, 'preco', p.preco,
               'categoria', c.nome, 'ordem', coalesce(c.ordem, 999), 'esgotado', p.estoque <= 0)
             order by coalesce(c.ordem, 999), p.nome)
        from produtos p left join categorias c on c.id = p.categoria_id
       where p.ativo and p.preco > 0), '[]'::jsonb))
$$;

-- ---------- o cliente finaliza o pedido ----------
create or replace function public.loja_pedido(
  p_client_id uuid, p_nome text, p_telefone text, p_endereco text, p_bairro text,
  p_referencia text, p_pagamento text, p_troco_para numeric, p_observacao text, p_itens jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_vendedor constant uuid := 'f0000000-0000-4000-8000-00000000c0de';
  v_cliente  constant uuid := 'f0000000-0000-4000-8000-00000000c11e';
  v_pedido pedidos;
  v_prod   produtos;
  v_item   record;
  v_total  numeric := 0;
  v_peso   numeric := 0;
  v_tel    text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
begin
  if not coalesce((select (valor->>'ligado')::boolean from configuracoes where chave = 'link_pedidos'), false) then
    raise exception 'Os pedidos pelo link estão fechados no momento.';
  end if;
  if p_client_id is null then raise exception 'Pedido inválido.'; end if;
  select * into v_pedido from pedidos where client_id = p_client_id;
  if found then
    return jsonb_build_object('numero', v_pedido.numero, 'total', v_pedido.total, 'duplicado', true);
  end if;

  if length(trim(coalesce(p_nome, ''))) < 2 or length(p_nome) > 80 then raise exception 'Informe o seu nome.'; end if;
  if length(v_tel) < 10 or length(v_tel) > 13 then raise exception 'Informe o telefone com DDD.'; end if;
  if length(trim(coalesce(p_endereco, ''))) < 5 or length(p_endereco) > 200 then raise exception 'Informe o endereço com o número.'; end if;
  if length(trim(coalesce(p_bairro, ''))) < 2 or length(p_bairro) > 80 then raise exception 'Informe o bairro.'; end if;
  if length(coalesce(p_referencia, '')) > 200 or length(coalesce(p_observacao, '')) > 500 then raise exception 'Texto muito grande.'; end if;
  if p_pagamento not in ('dinheiro', 'pix') then raise exception 'Escolha dinheiro ou Pix.'; end if;

  -- proteção contra abuso: no máximo 5 pedidos por telefone por hora e 300 por hora no total
  if (select count(*) from pedidos where origem = 'link' and contato_telefone = v_tel and feito_em > now() - interval '1 hour') >= 5
     or (select count(*) from pedidos where origem = 'link' and feito_em > now() - interval '1 hour') >= 300 then
    raise exception 'Muitos pedidos seguidos. Tente de novo mais tarde ou ligue para nós.';
  end if;

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Escolha pelo menos um produto.';
  end if;
  if jsonb_array_length(p_itens) > 60 then raise exception 'Produtos demais em um pedido.'; end if;
  if (select count(*) <> count(distinct e->>'produto_id') from jsonb_array_elements(p_itens) e) then
    raise exception 'Há produto repetido no pedido.';
  end if;

  perform 1 from produtos
   where id in (select (e->>'produto_id')::uuid from jsonb_array_elements(p_itens) e)
   order by id for update;

  for v_item in select (e->>'produto_id')::uuid as produto_id, (e->>'quantidade')::numeric as qtd from jsonb_array_elements(p_itens) e loop
    select * into v_prod from produtos where id = v_item.produto_id and ativo and preco > 0;
    if not found then raise exception 'Um dos produtos não está mais disponível. Atualize a página.'; end if;
    if v_item.qtd is null or v_item.qtd <= 0 or v_item.qtd > 999 or not _quantidade_valida(v_prod, v_item.qtd) then
      raise exception 'Quantidade inválida para %.', v_prod.nome;
    end if;
    if v_prod.estoque < v_item.qtd then
      raise exception 'Acabou o estoque de % (tem %). Diminua a quantidade ou tire o produto.', v_prod.nome,
        replace(regexp_replace(greatest(v_prod.estoque, 0)::text, '\.0+$', ''), '.', ',');
    end if;
    v_total := v_total + round(v_prod.preco * v_item.qtd, 2);
  end loop;
  if p_pagamento = 'dinheiro' and p_troco_para is not null and p_troco_para < v_total then
    raise exception 'O troco tem que ser para um valor maior que o total do pedido.';
  end if;

  insert into pedidos (client_id, cliente_id, vendedor_id, status, entrega, origem, observacao, feito_em,
                       contato_nome, contato_telefone, contato_endereco, contato_bairro, contato_referencia, pagamento, troco_para)
  values (p_client_id, v_cliente, v_vendedor, 'liberado', 'moto', 'link', nullif(trim(p_observacao), ''), now(),
          upper(trim(p_nome)), v_tel, upper(trim(p_endereco)), upper(trim(p_bairro)), nullif(upper(trim(p_referencia)), ''),
          p_pagamento, case when p_pagamento = 'dinheiro' then p_troco_para end)
  returning * into v_pedido;

  for v_item in select (e->>'produto_id')::uuid as produto_id, (e->>'quantidade')::numeric as qtd from jsonb_array_elements(p_itens) e loop
    select * into v_prod from produtos where id = v_item.produto_id;
    insert into pedido_itens (pedido_id, produto_id, quantidade, preco_tabela, desconto_pct, preco_unit, total, peso_kg, custo_unit)
    values (v_pedido.id, v_prod.id, v_item.qtd, v_prod.preco, 0, v_prod.preco, round(v_prod.preco * v_item.qtd, 2), v_prod.peso_kg * v_item.qtd, v_prod.custo);
    v_peso := v_peso + v_prod.peso_kg * v_item.qtd;
    perform _mover_estoque(v_prod.id, -v_item.qtd, 'venda', v_pedido.id, null, 'Pedido pelo link', v_prod.preco, 0);
  end loop;
  update pedidos set total = v_total, peso_kg = v_peso where id = v_pedido.id;
  return jsonb_build_object('numero', v_pedido.numero, 'total', v_total, 'duplicado', false);
end $$;

-- ---------- escritório: "já vi" e cadastrar o cliente ----------
create or replace function public.marcar_link_visto(p_pedido uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not tem_perm('pedidos_ver_todos') then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  update pedidos set visto_em = coalesce(visto_em, now()) where id = p_pedido and origem = 'link';
end $$;

create or replace function public.cadastrar_cliente_do_link(p_pedido uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v pedidos; v_cli uuid;
begin
  if not tem_perm('clientes') then raise exception 'Sem permissão para cadastrar clientes.' using errcode = '42501'; end if;
  select * into v from pedidos where id = p_pedido and origem = 'link' for update;
  if not found then raise exception 'Pedido pelo link não encontrado.'; end if;
  if v.cliente_id <> 'f0000000-0000-4000-8000-00000000c11e' then return v.cliente_id; end if;
  insert into clientes (razao_social, telefone, endereco, bairro, referencia, vendedor_id, observacao)
  values (v.contato_nome, v.contato_telefone, v.contato_endereco, v.contato_bairro, v.contato_referencia, auth.uid(),
          'Cadastrado a partir do pedido nº ' || v.numero || ' (link)')
  returning id into v_cli;
  update pedidos set cliente_id = v_cli, visto_em = coalesce(visto_em, now()) where id = p_pedido;
  return v_cli;
end $$;

revoke execute on function public.loja_catalogo() from public;
grant execute on function public.loja_catalogo() to anon, authenticated;
revoke execute on function public.loja_pedido(uuid, text, text, text, text, text, text, numeric, text, jsonb) from public;
grant execute on function public.loja_pedido(uuid, text, text, text, text, text, text, numeric, text, jsonb) to anon, authenticated;
revoke execute on function public.marcar_link_visto(uuid) from public, anon;
grant execute on function public.marcar_link_visto(uuid) to authenticated;
revoke execute on function public.cadastrar_cliente_do_link(uuid) from public, anon;
grant execute on function public.cadastrar_cliente_do_link(uuid) to authenticated;

create or replace function public.versao_banco() returns integer language sql stable as $$ select 24 $$;

-- >>> 20261116000025_abastecimento.sql
-- =====================================================================
-- Abastecimento dos carros
--  * permissão nova "abastecimento" (usuário só para abastecer)
--  * carro: nome, placa e se o painel marca a quilometragem
--  * cada abastecimento: data, km atual (se o carro marca), valor pago,
--    preço do litro, litros (calculado), foto do painel e foto da km
--  * fotos no Storage (pasta privada "abastecimentos")
--  * relatório: km rodados, km por litro e custo por km; entra nas despesas
-- =====================================================================
alter table public.veiculos add column if not exists marca_km boolean not null default true;

-- quem abastece também cadastra os carros
drop policy if exists veiculos_abastecimento on public.veiculos;
create policy veiculos_abastecimento on public.veiculos for all to authenticated
  using (tem_perm('abastecimento')) with check (tem_perm('abastecimento'));

create table if not exists public.abastecimentos (
  id           uuid primary key default gen_random_uuid(),
  veiculo_id   uuid not null references public.veiculos (id) on delete restrict,
  data         date not null default current_date,
  km           numeric(10,0) check (km is null or km >= 0),
  valor        numeric(10,2) not null check (valor > 0),
  preco_litro  numeric(8,3) not null check (preco_litro > 0),
  litros       numeric(10,3) generated always as (round(valor / preco_litro, 3)) stored,
  foto_painel  text not null,
  foto_km      text,
  observacao   text,
  usuario_id   uuid references public.perfis (id) on delete set null default auth.uid(),
  criado_em    timestamptz not null default now()
);
create index if not exists abastecimentos_veiculo on public.abastecimentos (veiculo_id, data desc, criado_em desc);
create index if not exists abastecimentos_data on public.abastecimentos (data);

alter table public.abastecimentos enable row level security;
revoke all on public.abastecimentos from anon;
revoke insert, update, delete on public.abastecimentos from authenticated;
grant select on public.abastecimentos to authenticated;
drop policy if exists abastecimentos_ler on public.abastecimentos;
create policy abastecimentos_ler on public.abastecimentos for select to authenticated
  using (tem_perm('abastecimento') or tem_perm('financeiro'));

-- ---------- registrar ----------
create or replace function public.registrar_abastecimento(
  p_veiculo uuid, p_data date, p_km numeric, p_valor numeric, p_preco_litro numeric,
  p_foto_painel text, p_foto_km text default null, p_observacao text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v veiculos; v_ult numeric; v_id uuid;
begin
  if not tem_perm('abastecimento') then
    raise exception 'Você não tem permissão para lançar abastecimento.' using errcode = '42501';
  end if;
  select * into v from veiculos where id = p_veiculo and ativo;
  if not found then raise exception 'Carro não encontrado ou inativo.'; end if;
  if p_data is null or p_data > current_date + 1 or p_data < current_date - 60 then
    raise exception 'Data inválida.';
  end if;
  if p_valor is null or p_valor <= 0 or p_valor > 10000 then raise exception 'Informe o valor do abastecimento.'; end if;
  if p_preco_litro is null or p_preco_litro <= 0 or p_preco_litro > 50 then raise exception 'Informe o preço do litro.'; end if;
  if p_valor / p_preco_litro > 1000 then raise exception 'Deu mais de 1.000 litros: confira o valor e o preço do litro.'; end if;
  if coalesce(p_foto_painel, '') = '' then raise exception 'Falta a foto do painel.'; end if;
  if v.marca_km then
    if p_km is null then raise exception 'Informe a quilometragem atual do %.', v.nome; end if;
    if coalesce(p_foto_km, '') = '' then raise exception 'Falta a foto da quilometragem.'; end if;
    select km into v_ult from abastecimentos where veiculo_id = p_veiculo and km is not null
     order by data desc, criado_em desc limit 1;
    if v_ult is not null and p_km < v_ult then
      raise exception 'A quilometragem (% km) está menor que a do último abastecimento (% km). Confira o número.',
        to_char(p_km, 'FM999G999G999'), to_char(v_ult, 'FM999G999G999');
    end if;
  end if;
  insert into abastecimentos (veiculo_id, data, km, valor, preco_litro, foto_painel, foto_km, observacao, usuario_id)
  values (p_veiculo, p_data, case when v.marca_km then round(p_km) end, round(p_valor, 2), round(p_preco_litro, 3),
          p_foto_painel, case when v.marca_km then p_foto_km end, nullif(trim(p_observacao), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ---------- apagar (administrador, ou quem lançou no mesmo dia) ----------
create or replace function public.apagar_abastecimento(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare a abastecimentos;
begin
  select * into a from abastecimentos where id = p_id;
  if not found then raise exception 'Abastecimento não encontrado.'; end if;
  if not (eh_admin() or (a.usuario_id = auth.uid() and a.criado_em::date = current_date)) then
    raise exception 'Só o administrador apaga abastecimento (ou quem lançou, no mesmo dia).' using errcode = '42501';
  end if;
  delete from abastecimentos where id = p_id;
  return concat_ws(',', a.foto_painel, a.foto_km);   -- o app apaga as fotos
end $$;

-- ---------- relatório ----------
-- km rodados = km deste abastecimento − km do abastecimento anterior do mesmo carro
-- km/litro   = km rodados ÷ litros deste abastecimento (tanque completo toda semana)
create or replace function public.relatorio_abastecimentos(p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not (tem_perm('abastecimento') or tem_perm('financeiro')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  with todos as (
    select a.*, ve.nome as veiculo, ve.placa, ve.marca_km, pf.nome as usuario,
           lag(a.km) over (partition by a.veiculo_id order by a.data, a.criado_em) as km_anterior
      from abastecimentos a join veiculos ve on ve.id = a.veiculo_id left join perfis pf on pf.id = a.usuario_id
  ), per as (
    select t.*, case when t.km is not null and t.km_anterior is not null then t.km - t.km_anterior end as km_rodados
      from todos t where t.data between p_inicio and p_fim
  )
  select jsonb_build_object(
    'total_valor',  (select coalesce(sum(valor), 0) from per),
    'total_litros', (select coalesce(sum(litros), 0) from per),
    'quantidade',   (select count(*) from per),
    'lista', (select coalesce(jsonb_agg(x order by x.data desc, x.criado_em desc), '[]') from (
      select id, veiculo_id, veiculo, placa, data, criado_em, km, km_anterior, km_rodados, valor, preco_litro, litros,
             case when km_rodados > 0 and litros > 0 then round(km_rodados / litros, 2) end as km_litro,
             case when km_rodados > 0 then round(valor / km_rodados, 2) end as custo_km,
             foto_painel, foto_km, observacao, usuario, usuario_id
        from per) x),
    'por_veiculo', (select coalesce(jsonb_agg(x order by x.valor desc), '[]') from (
      select veiculo_id, veiculo, placa, count(*) as abastecimentos, sum(valor) as valor, sum(litros) as litros,
             sum(km_rodados) as km_rodados,
             case when sum(km_rodados) > 0 then round(sum(km_rodados) / nullif(sum(litros) filter (where km_rodados is not null), 0), 2) end as km_litro,
             case when sum(km_rodados) > 0 then round(sum(valor) filter (where km_rodados is not null) / sum(km_rodados), 2) end as custo_km
        from per group by veiculo_id, veiculo, placa) x)
  ) into v;
  return v;
end $$;

-- ---------- fotos (Storage, pasta privada) ----------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('abastecimentos', 'abastecimentos', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = 8388608, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
    execute 'drop policy if exists abastecimentos_fotos_enviar on storage.objects';
    execute 'drop policy if exists abastecimentos_fotos_ver on storage.objects';
    execute 'drop policy if exists abastecimentos_fotos_apagar on storage.objects';
    execute $p$create policy abastecimentos_fotos_enviar on storage.objects for insert to authenticated
               with check (bucket_id = 'abastecimentos' and public.tem_perm('abastecimento'))$p$;
    execute $p$create policy abastecimentos_fotos_ver on storage.objects for select to authenticated
               using (bucket_id = 'abastecimentos' and (public.tem_perm('abastecimento') or public.tem_perm('financeiro')))$p$;
    execute $p$create policy abastecimentos_fotos_apagar on storage.objects for delete to authenticated
               using (bucket_id = 'abastecimentos' and public.tem_perm('abastecimento'))$p$;
  end if;
end $$;

revoke execute on function public.registrar_abastecimento(uuid, date, numeric, numeric, numeric, text, text, text) from public, anon;
grant execute on function public.registrar_abastecimento(uuid, date, numeric, numeric, numeric, text, text, text) to authenticated;
revoke execute on function public.apagar_abastecimento(uuid) from public, anon;
grant execute on function public.apagar_abastecimento(uuid) to authenticated;
revoke execute on function public.relatorio_abastecimentos(date, date) from public, anon;
grant execute on function public.relatorio_abastecimentos(date, date) to authenticated;

create or replace function public.versao_banco() returns integer language sql stable as $$ select 25 $$;

-- >>> 20261117000026_combustivel.sql
-- =====================================================================
-- Combustível
--  * cada carro diz o que aceita: etanol, gasolina, diesel e/ou gás (GNV)
--    (carro flex: etanol e gasolina)
--  * no abastecimento escolhe o combustível
--  * valor pago, preço do litro e litros: põe dois, o terceiro é calculado
-- =====================================================================
alter table public.veiculos add column if not exists combustiveis text[] not null default '{}';
alter table public.veiculos drop constraint if exists veiculos_combustiveis_check;
alter table public.veiculos add constraint veiculos_combustiveis_check
  check (combustiveis <@ array['etanol', 'gasolina', 'diesel', 'gnv']::text[]);

alter table public.abastecimentos add column if not exists combustivel text;
alter table public.abastecimentos drop constraint if exists abastecimentos_combustivel_check;
alter table public.abastecimentos add constraint abastecimentos_combustivel_check
  check (combustivel is null or combustivel in ('etanol', 'gasolina', 'diesel', 'gnv'));

-- litros deixa de ser sempre calculado: pode ser o valor que a bomba mostrou
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'abastecimentos' and column_name = 'litros' and is_generated = 'ALWAYS') then
    alter table public.abastecimentos alter column litros drop expression;
  end if;
end $$;
alter table public.abastecimentos alter column litros set not null;
alter table public.abastecimentos drop constraint if exists abastecimentos_litros_check;
alter table public.abastecimentos add constraint abastecimentos_litros_check check (litros > 0);

drop function if exists public.registrar_abastecimento(uuid, date, numeric, numeric, numeric, text, text, text);
-- p_valor, p_preco_litro, p_litros: precisa de pelo menos dois; o que faltar é calculado.
-- Se vierem os três, vale o valor pago e os litros (o que a bomba mostra) e o preço é recalculado.
create or replace function public.registrar_abastecimento(
  p_veiculo uuid, p_data date, p_km numeric, p_valor numeric, p_preco_litro numeric, p_litros numeric,
  p_combustivel text, p_foto_painel text, p_foto_km text default null, p_observacao text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v veiculos; v_ult numeric; v_id uuid;
        v_valor numeric := nullif(p_valor, 0); v_preco numeric := nullif(p_preco_litro, 0); v_litros numeric := nullif(p_litros, 0);
begin
  if not tem_perm('abastecimento') then
    raise exception 'Você não tem permissão para lançar abastecimento.' using errcode = '42501';
  end if;
  select * into v from veiculos where id = p_veiculo and ativo;
  if not found then raise exception 'Carro não encontrado ou inativo.'; end if;
  if p_data is null or p_data > current_date + 1 or p_data < current_date - 60 then
    raise exception 'Data inválida.';
  end if;

  -- combustível
  if p_combustivel is not null and p_combustivel not in ('etanol', 'gasolina', 'diesel', 'gnv') then
    raise exception 'Combustível inválido.';
  end if;
  if cardinality(v.combustiveis) > 0 then
    if p_combustivel is null then raise exception 'Escolha o combustível.'; end if;
    if not p_combustivel = any (v.combustiveis) then
      raise exception 'O % não está cadastrado para usar esse combustível. Arrume no cadastro do carro.', v.nome;
    end if;
  end if;

  -- dois dos três; o terceiro é calculado
  if (v_valor is not null)::int + (v_preco is not null)::int + (v_litros is not null)::int < 2 then
    raise exception 'Preencha dois destes: valor pago, preço do litro ou litros.';
  end if;
  if v_valor < 0 or v_preco < 0 or v_litros < 0 then raise exception 'Valores não podem ser negativos.'; end if;
  if v_valor is not null and v_litros is not null then
    v_preco := round(v_valor / v_litros, 3);
  elsif v_valor is not null then
    v_litros := round(v_valor / v_preco, 3);
  else
    v_valor := round(v_preco * v_litros, 2);
  end if;
  if v_valor > 10000 then raise exception 'Valor muito alto: confira.'; end if;
  if v_preco > 50 or v_preco < 0.5 then raise exception 'O preço do litro deu R$ %: confira os números.', to_char(v_preco, 'FM990D000'); end if;
  if v_litros > 1000 then raise exception 'Deu mais de 1.000 litros: confira os números.'; end if;

  if coalesce(p_foto_painel, '') = '' then raise exception 'Falta a foto do painel.'; end if;
  if v.marca_km then
    if p_km is null then raise exception 'Informe a quilometragem atual do %.', v.nome; end if;
    if coalesce(p_foto_km, '') = '' then raise exception 'Falta a foto da quilometragem.'; end if;
    select km into v_ult from abastecimentos where veiculo_id = p_veiculo and km is not null
     order by data desc, criado_em desc limit 1;
    if v_ult is not null and p_km < v_ult then
      raise exception 'A quilometragem (% km) está menor que a do último abastecimento (% km). Confira o número.',
        to_char(p_km, 'FM999G999G999'), to_char(v_ult, 'FM999G999G999');
    end if;
  end if;

  insert into abastecimentos (veiculo_id, data, km, valor, preco_litro, litros, combustivel, foto_painel, foto_km, observacao, usuario_id)
  values (p_veiculo, p_data, case when v.marca_km then round(p_km) end, round(v_valor, 2), round(v_preco, 3), round(v_litros, 3),
          p_combustivel, p_foto_painel, case when v.marca_km then p_foto_km end, nullif(trim(p_observacao), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- relatório com o combustível
create or replace function public.relatorio_abastecimentos(p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not (tem_perm('abastecimento') or tem_perm('financeiro')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  with todos as (
    select a.*, ve.nome as veiculo, ve.placa, ve.marca_km, pf.nome as usuario,
           lag(a.km) over (partition by a.veiculo_id order by a.data, a.criado_em) as km_anterior
      from abastecimentos a join veiculos ve on ve.id = a.veiculo_id left join perfis pf on pf.id = a.usuario_id
  ), per as (
    select t.*, case when t.km is not null and t.km_anterior is not null then t.km - t.km_anterior end as km_rodados
      from todos t where t.data between p_inicio and p_fim
  )
  select jsonb_build_object(
    'total_valor',  (select coalesce(sum(valor), 0) from per),
    'total_litros', (select coalesce(sum(litros), 0) from per),
    'quantidade',   (select count(*) from per),
    'lista', (select coalesce(jsonb_agg(x order by x.data desc, x.criado_em desc), '[]') from (
      select id, veiculo_id, veiculo, placa, data, criado_em, km, km_anterior, km_rodados, valor, preco_litro, litros, combustivel,
             case when km_rodados > 0 and litros > 0 then round(km_rodados / litros, 2) end as km_litro,
             case when km_rodados > 0 then round(valor / km_rodados, 2) end as custo_km,
             foto_painel, foto_km, observacao, usuario, usuario_id
        from per) x),
    'por_veiculo', (select coalesce(jsonb_agg(x order by x.valor desc), '[]') from (
      select veiculo_id, veiculo, placa, count(*) as abastecimentos, sum(valor) as valor, sum(litros) as litros,
             sum(km_rodados) as km_rodados,
             case when sum(km_rodados) > 0 then round(sum(km_rodados) / nullif(sum(litros) filter (where km_rodados is not null), 0), 2) end as km_litro,
             case when sum(km_rodados) > 0 then round(sum(valor) filter (where km_rodados is not null) / sum(km_rodados), 2) end as custo_km
        from per group by veiculo_id, veiculo, placa) x),
    'por_combustivel', (select coalesce(jsonb_agg(x order by x.valor desc), '[]') from (
      select coalesce(combustivel, 'nao_informado') as combustivel, count(*) as abastecimentos, sum(valor) as valor, sum(litros) as litros,
             round(sum(valor) / nullif(sum(litros), 0), 3) as preco_medio
        from per group by coalesce(combustivel, 'nao_informado')) x)
  ) into v;
  return v;
end $$;

revoke execute on function public.registrar_abastecimento(uuid, date, numeric, numeric, numeric, numeric, text, text, text, text) from public, anon;
grant execute on function public.registrar_abastecimento(uuid, date, numeric, numeric, numeric, numeric, text, text, text, text) to authenticated;

create or replace function public.versao_banco() returns integer language sql stable as $$ select 26 $$;
