-- =====================================================================
-- Financeiro: valor em cada entrada e saída de estoque, custo do produto,
-- saída manual (avaria, perda, uso próprio) e relatório semanal.
-- =====================================================================

-- Custo de compra do produto (atualizado a cada entrada)
alter table public.produtos add column if not exists custo numeric(12,2) not null default 0 check (custo >= 0);
grant insert (custo) on public.produtos to authenticated;
grant update (custo) on public.produtos to authenticated;

-- Custo na hora da venda (para calcular o lucro mesmo se o custo mudar depois)
alter table public.pedido_itens add column if not exists custo_unit numeric(12,2) not null default 0;

-- Valores em cada movimento de estoque
alter table public.estoque_movimentos add column if not exists valor_unit numeric(12,2);
alter table public.estoque_movimentos add column if not exists desconto numeric(12,2) not null default 0;
alter table public.estoque_movimentos add column if not exists valor_total numeric(12,2);
alter table public.estoque_movimentos add column if not exists motivo text;
alter table public.estoque_movimentos drop constraint if exists estoque_movimentos_tipo_check;
alter table public.estoque_movimentos add constraint estoque_movimentos_tipo_check
  check (tipo in ('entrada','venda','cancelamento','devolucao','ajuste','saida'));

-- Nova permissão "financeiro" (administradores já têm tudo)
comment on column public.perfis.permissoes is
  'pedidos_criar, pedidos_ver_todos, clientes, produtos, estoque, cargas, conferencia, cadastros, financeiro';
drop policy if exists movimentos_ler on public.estoque_movimentos;
create policy movimentos_ler on public.estoque_movimentos for select to authenticated
  using (tem_perm('estoque') or tem_perm('financeiro'));

-- ---------------------------------------------------------------------
-- Movimento de estoque com valor
-- valor_total = quantidade × valor_unit − desconto (sempre positivo)
-- ---------------------------------------------------------------------
drop function if exists public._mover_estoque(uuid, numeric, text, uuid, uuid, text);
create or replace function public._mover_estoque(
  p_produto uuid, p_qtd numeric, p_tipo text,
  p_pedido uuid default null, p_carga uuid default null, p_obs text default null,
  p_valor_unit numeric default null, p_desconto numeric default 0, p_motivo text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_saldo numeric;
begin
  update produtos set estoque = estoque + p_qtd where id = p_produto returning estoque into v_saldo;
  insert into estoque_movimentos (produto_id, tipo, quantidade, saldo, pedido_id, carga_id, usuario_id, observacao,
                                  valor_unit, desconto, valor_total, motivo)
  values (p_produto, p_tipo, p_qtd, v_saldo, p_pedido, p_carga, auth.uid(), p_obs,
          p_valor_unit, coalesce(p_desconto, 0),
          case when p_valor_unit is null then null
               else round(abs(p_qtd) * p_valor_unit - coalesce(p_desconto, 0), 2) end,
          p_motivo);
  return v_saldo;
end $$;
revoke execute on function public._mover_estoque(uuid, numeric, text, uuid, uuid, text, numeric, numeric, text) from public, anon, authenticated;

-- Cancelamento devolve o estoque pelo mesmo valor da venda
create or replace function public._devolver_estoque_pedido(p_pedido uuid, p_tipo text, p_obs text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select produto_id, quantidade, preco_tabela, total from pedido_itens where pedido_id = p_pedido order by produto_id loop
    perform _mover_estoque(r.produto_id, r.quantidade, p_tipo, p_pedido, null, p_obs,
                           r.preco_tabela, round(r.preco_tabela * r.quantidade - r.total, 2));
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Pedido guarda o custo de cada item e o valor da saída
-- ---------------------------------------------------------------------
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
    insert into pedido_itens (pedido_id, produto_id, quantidade, preco_tabela, desconto_pct, preco_unit, total, peso_kg, custo_unit)
    values (v_pedido.id, v_prod.id, v_item.qtd, v_prod.preco, v_item.desconto, v_unit,
            round(v_unit * v_item.qtd, 2), v_prod.peso_kg * v_item.qtd, v_prod.custo);
    v_total := v_total + round(v_unit * v_item.qtd, 2);
    v_peso  := v_peso + v_prod.peso_kg * v_item.qtd;
    perform _mover_estoque(v_prod.id, -v_item.qtd, 'venda', v_pedido.id, null, null,
                           v_prod.preco, round((v_prod.preco - v_unit) * v_item.qtd, 2));
  end loop;

  update pedidos set total = v_total, peso_kg = v_peso where id = v_pedido.id;

  return jsonb_build_object('id', v_pedido.id, 'numero', v_pedido.numero, 'status', v_pedido.status, 'duplicado', false);
end $$;

-- ---------------------------------------------------------------------
-- Conferência: devolução registrada com valor
-- ---------------------------------------------------------------------
create or replace function public.finalizar_conferencia(p_carga uuid, p_itens jsonb, p_observacao text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; r record; v_prod produtos; v_preco numeric;
begin
  perform _exigir('conferencia');
  select status into v_status from cargas where id = p_carga for update;
  if not found then raise exception 'Carga não encontrada.'; end if;
  if v_status <> 'saiu' then raise exception 'Só dá para conferir carga que saiu e ainda não foi conferida.'; end if;

  insert into conferencias (carga_id, usuario_id, observacao)
  values (p_carga, auth.uid(), nullif(trim(p_observacao), ''));

  for r in
    select e->>'tipo' as tipo,
           nullif(e->>'produto_id', '')::uuid as produto_id,
           nullif(e->>'vasilhame_id', '')::uuid as vasilhame_id,
           (e->>'quantidade')::numeric as qtd
      from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
     order by e->>'produto_id'
  loop
    if r.qtd is null or r.qtd <= 0 then continue; end if;
    if r.tipo in ('devolvido', 'troca') then
      select * into v_prod from produtos where id = r.produto_id;
      if not found then raise exception 'Produto não encontrado na conferência.'; end if;
      if not _quantidade_valida(v_prod, r.qtd) then
        raise exception 'Quantidade inválida para %: %', v_prod.nome, r.qtd;
      end if;
    end if;
    insert into conferencia_itens (carga_id, tipo, produto_id, vasilhame_id, quantidade)
    values (p_carga, r.tipo, case when r.tipo = 'vasilhame' then null else r.produto_id end,
            case when r.tipo = 'vasilhame' then r.vasilhame_id end, r.qtd);
    if r.tipo = 'devolvido' then
      -- valor da devolução: preço médio que esse produto foi vendido nesta carga
      select coalesce(sum(i.total) / nullif(sum(i.quantidade), 0), v_prod.preco) into v_preco
        from pedido_itens i join pedidos p on p.id = i.pedido_id
       where p.carga_id = p_carga and i.produto_id = r.produto_id;
      perform _mover_estoque(r.produto_id, r.qtd, 'devolucao', null, p_carga, 'Voltou na conferência', round(v_preco, 2), 0);
    end if;
  end loop;

  update pedidos set status = 'entregue' where carga_id = p_carga and status = 'carregado';
  update cargas set status = 'conferida' where id = p_carga;
end $$;

-- ---------------------------------------------------------------------
-- Entrada de mercadoria com valor de compra e desconto do fornecedor
-- p_valor_unit: preço de compra de 1 unidade; p_desconto: desconto em R$ no total
-- ---------------------------------------------------------------------
drop function if exists public.entrada_estoque(uuid, numeric, text);
create or replace function public.entrada_estoque(
  p_produto uuid, p_quantidade numeric, p_observacao text default null,
  p_valor_unit numeric default null, p_desconto numeric default 0)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_prod produtos; v_custo numeric;
begin
  perform _exigir('estoque');
  select * into v_prod from produtos where id = p_produto for update;
  if not found then raise exception 'Produto não encontrado.'; end if;
  if not _quantidade_valida(v_prod, p_quantidade) then
    raise exception 'Quantidade inválida: %', p_quantidade;
  end if;
  if p_valor_unit is not null and p_valor_unit < 0 then raise exception 'Valor de compra inválido.'; end if;
  if coalesce(p_desconto, 0) < 0 then raise exception 'Desconto inválido.'; end if;
  if p_valor_unit is not null and coalesce(p_desconto, 0) > p_quantidade * p_valor_unit then
    raise exception 'O desconto é maior que o valor da entrada.';
  end if;
  -- custo real de 1 unidade, já com o desconto do fornecedor
  if p_valor_unit is not null then
    v_custo := round((p_quantidade * p_valor_unit - coalesce(p_desconto, 0)) / p_quantidade, 2);
    update produtos set custo = v_custo where id = p_produto;
  end if;
  return _mover_estoque(p_produto, p_quantidade, 'entrada', null, null, nullif(trim(p_observacao), ''),
                        p_valor_unit, coalesce(p_desconto, 0));
end $$;

-- ---------------------------------------------------------------------
-- Saída manual: avaria, perda, vencido, uso próprio, bonificação, outro
-- O valor é o custo do produto (o que a distribuidora perdeu)
-- ---------------------------------------------------------------------
create or replace function public.saida_estoque(
  p_produto uuid, p_quantidade numeric, p_motivo text, p_observacao text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_prod produtos;
begin
  perform _exigir('estoque');
  select * into v_prod from produtos where id = p_produto for update;
  if not found then raise exception 'Produto não encontrado.'; end if;
  if not _quantidade_valida(v_prod, p_quantidade) then
    raise exception 'Quantidade inválida: %', p_quantidade;
  end if;
  if v_prod.estoque < p_quantidade then
    raise exception 'Só tem % em estoque.', v_prod.estoque;
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da saída.'; end if;
  return _mover_estoque(p_produto, -p_quantidade, 'saida', null, null, nullif(trim(p_observacao), ''),
                        v_prod.custo, 0, trim(p_motivo));
end $$;

-- ---------------------------------------------------------------------
-- Relatório financeiro do período (normalmente uma semana)
-- Vendas = pedidos liberados, carregados ou entregues feitos no período.
-- ---------------------------------------------------------------------
create or replace function public.relatorio_financeiro(p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ini timestamptz := p_inicio::timestamptz;
  v_fim timestamptz := (p_fim + 1)::timestamptz;
  v jsonb;
begin
  if not tem_perm('financeiro') then
    raise exception 'Você não tem permissão para ver o financeiro.' using errcode = '42501';
  end if;

  with ped as (
    select p.*, c.razao_social, pf.nome as vendedor
      from pedidos p join clientes c on c.id = p.cliente_id left join perfis pf on pf.id = p.vendedor_id
     where p.feito_em >= v_ini and p.feito_em < v_fim and p.status in ('liberado','carregado','entregue')
  ), it as (
    select i.*, ped.feito_em from pedido_itens i join ped on ped.id = i.pedido_id
  ), mov as (
    select m.*, pr.nome as produto, pr.unidade, pf.nome as usuario
      from estoque_movimentos m join produtos pr on pr.id = m.produto_id left join perfis pf on pf.id = m.usuario_id
     where m.criado_em >= v_ini and m.criado_em < v_fim
  ), dias as (
    select d::date as dia from generate_series(p_inicio, p_fim, interval '1 day') d
  )
  select jsonb_build_object(
    'resumo', jsonb_build_object(
      'pedidos',        (select count(*) from ped),
      'clientes',       (select count(distinct cliente_id) from ped),
      'vendas_bruto',   (select coalesce(sum(preco_tabela * quantidade), 0) from it),
      'descontos',      (select coalesce(sum(preco_tabela * quantidade - total), 0) from it),
      'vendas_liquido', (select coalesce(sum(total), 0) from it),
      'custo_vendido',  (select coalesce(sum(custo_unit * quantidade), 0) from it),
      'devolucoes',     (select coalesce(sum(valor_total), 0) from mov where tipo = 'devolucao'),
      'compras',        (select coalesce(sum(valor_total), 0) from mov where tipo = 'entrada'),
      'descontos_compra', (select coalesce(sum(desconto), 0) from mov where tipo = 'entrada'),
      'saidas_manuais', (select coalesce(sum(valor_total), 0) from mov where tipo = 'saida'),
      'itens_sem_custo', (select count(*) from it where custo_unit = 0)
    ),
    'por_dia', (select coalesce(jsonb_agg(x order by x.dia), '[]') from (
      select d.dia,
             (select count(*) from ped where ped.feito_em::date = d.dia) as pedidos,
             (select coalesce(sum(total), 0) from it where it.feito_em::date = d.dia) as vendas,
             (select coalesce(sum(preco_tabela * quantidade - total), 0) from it where it.feito_em::date = d.dia) as descontos,
             (select coalesce(sum(valor_total), 0) from mov where tipo = 'entrada' and mov.criado_em::date = d.dia) as compras
        from dias d) x),
    'pedidos', (select coalesce(jsonb_agg(x order by x.numero), '[]') from (
      select ped.id, ped.numero, ped.feito_em, ped.razao_social as cliente, ped.vendedor, ped.status, ped.observacao,
             (select sum(preco_tabela * quantidade) from it where it.pedido_id = ped.id) as bruto,
             (select sum(preco_tabela * quantidade - total) from it where it.pedido_id = ped.id) as desconto,
             ped.total as liquido,
             (select max(desconto_pct) from it where it.pedido_id = ped.id) as maior_desconto
        from ped) x),
    'produtos', (select coalesce(jsonb_agg(x order by x.faturamento desc), '[]') from (
      select pr.nome as produto, pr.unidade, sum(it.quantidade) as quantidade,
             sum(it.total) as faturamento, sum(it.custo_unit * it.quantidade) as custo,
             sum(it.total) - sum(it.custo_unit * it.quantidade) as lucro,
             sum(it.preco_tabela * it.quantidade - it.total) as descontos,
             bool_or(it.custo_unit = 0) as sem_custo
        from it join produtos pr on pr.id = it.produto_id
       group by pr.nome, pr.unidade) x),
    'entradas', (select coalesce(jsonb_agg(x order by x.criado_em), '[]') from (
      select criado_em, produto, unidade, quantidade, valor_unit, desconto, valor_total, observacao, usuario
        from mov where tipo = 'entrada') x),
    'saidas', (select coalesce(jsonb_agg(x order by x.criado_em), '[]') from (
      select criado_em, produto, unidade, -quantidade as quantidade, valor_unit, valor_total, motivo, observacao, usuario
        from mov where tipo = 'saida') x),
    'devolucoes', (select coalesce(jsonb_agg(x order by x.criado_em), '[]') from (
      select criado_em, produto, unidade, quantidade, valor_unit, valor_total, observacao, usuario
        from mov where tipo = 'devolucao') x)
  ) into v;
  return v;
end $$;

revoke execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid) from public, anon;
grant execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid) to authenticated;
revoke execute on function public.entrada_estoque(uuid, numeric, text, numeric, numeric) from public, anon;
grant execute on function public.entrada_estoque(uuid, numeric, text, numeric, numeric) to authenticated;
revoke execute on function public.saida_estoque(uuid, numeric, text, text) from public, anon;
grant execute on function public.saida_estoque(uuid, numeric, text, text) to authenticated;
revoke execute on function public.relatorio_financeiro(date, date) from public, anon;
grant execute on function public.relatorio_financeiro(date, date) to authenticated;
revoke execute on function public._devolver_estoque_pedido(uuid, text, text) from public, anon, authenticated;
