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
