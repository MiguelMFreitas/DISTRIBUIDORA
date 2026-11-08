-- =====================================================================
-- O escritório também faz pedidos (no próprio nome ou no de um vendedor).
-- O limite de desconto que vale é o de quem lança o pedido.
-- =====================================================================

drop function if exists public.criar_pedido(uuid, uuid, jsonb, text, timestamptz);

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
begin
  select * into v_perfil from perfis where id = auth.uid() and ativo;
  if not found or not (v_perfil.admin or 'pedidos_criar' = any (v_perfil.permissoes)
                       or 'pedidos_ver_todos' = any (v_perfil.permissoes)) then
    raise exception 'Você não tem permissão para fazer pedidos.' using errcode = '42501';
  end if;

  -- Pedido lançado pelo escritório no nome de um vendedor (cliente ligou, por exemplo)
  v_vendedor := coalesce(p_vendedor_id, v_perfil.id);
  if v_vendedor <> v_perfil.id then
    if not (v_perfil.admin or 'pedidos_ver_todos' = any (v_perfil.permissoes)) then
      raise exception 'Você só pode lançar pedidos no seu próprio nome.' using errcode = '42501';
    end if;
    if not exists (select 1 from perfis where id = v_vendedor and ativo) then
      raise exception 'Vendedor não encontrado ou inativo.';
    end if;
  end if;

  -- Já recebido antes (reenvio do celular)? Devolve o mesmo pedido.
  if p_client_id is not null then
    select * into v_pedido from pedidos where client_id = p_client_id;
    if found then
      return jsonb_build_object('id', v_pedido.id, 'numero', v_pedido.numero, 'status', v_pedido.status, 'duplicado', true);
    end if;
  end if;

  if not exists (select 1 from clientes where id = p_cliente_id and ativo) then
    raise exception 'Cliente não encontrado ou inativo.';
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
           coalesce((e->>'desconto_pct')::numeric, 0) as desconto
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
    if v_item.desconto > v_perfil.desconto_max and not v_perfil.admin then
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
           coalesce((e->>'desconto_pct')::numeric, 0) as desconto
      from jsonb_array_elements(p_itens) e
  loop
    select * into v_prod from produtos where id = v_item.produto_id;
    v_unit := round(v_prod.preco * (1 - v_item.desconto / 100), 2);
    insert into pedido_itens (pedido_id, produto_id, quantidade, preco_tabela, desconto_pct, preco_unit, total, peso_kg)
    values (v_pedido.id, v_prod.id, v_item.qtd, v_prod.preco, v_item.desconto, v_unit,
            round(v_unit * v_item.qtd, 2), v_prod.peso_kg * v_item.qtd);
    v_total := v_total + round(v_unit * v_item.qtd, 2);
    v_peso  := v_peso + v_prod.peso_kg * v_item.qtd;
    perform _mover_estoque(v_prod.id, -v_item.qtd, 'venda', v_pedido.id, null, null);
  end loop;

  update pedidos set total = v_total, peso_kg = v_peso where id = v_pedido.id;

  return jsonb_build_object('id', v_pedido.id, 'numero', v_pedido.numero, 'status', v_pedido.status, 'duplicado', false);
end $$;

revoke execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid) from public, anon;
grant execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid) to authenticated;
