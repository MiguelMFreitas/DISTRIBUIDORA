-- =====================================================================
-- Recibos: "Recebemos de ... a importância de R$ ... referente a ..."
-- Ficam numerados e entram no relatório financeiro como recebimentos.
-- =====================================================================
create table if not exists public.recibos (
  id            uuid primary key default gen_random_uuid(),
  numero        bigint generated always as identity unique,
  data          date not null default current_date,
  valor         numeric(12,2) not null check (valor > 0),
  recebemos_de  text not null,
  documento     text,                       -- CPF/CNPJ de quem pagou (opcional)
  cliente_id    uuid references public.clientes (id) on delete set null,
  referente     text,
  observacao    text,
  cancelado     boolean not null default false,
  criado_por    uuid references public.perfis (id) on delete set null default auth.uid(),
  criado_em     timestamptz not null default now()
);
create index if not exists recibos_data_idx on public.recibos (data);

alter table public.recibos enable row level security;
revoke all on public.recibos from anon;
create policy recibos_ler on public.recibos for select to authenticated
  using (tem_perm('pedidos_ver_todos') or tem_perm('financeiro'));
create policy recibos_criar on public.recibos for insert to authenticated
  with check (tem_perm('pedidos_ver_todos') or tem_perm('financeiro'));
-- só cancelar (nunca apagar), e só administrador
create policy recibos_cancelar on public.recibos for update to authenticated
  using (eh_admin()) with check (eh_admin());
revoke insert, update, delete on public.recibos from authenticated;
grant insert (data, valor, recebemos_de, documento, cliente_id, referente, observacao) on public.recibos to authenticated;
grant update (cancelado) on public.recibos to authenticated;

-- Relatório financeiro passa a mostrar os recebimentos (recibos)
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
      'itens_sem_custo', (select count(*) from it where custo_unit = 0),
      'recebimentos',   (select coalesce(sum(valor), 0) from recibos where data between p_inicio and p_fim and not cancelado)
    ),
    'recibos', (select coalesce(jsonb_agg(x order by x.numero), '[]') from (
      select r.numero, r.data, r.valor, r.recebemos_de, r.referente, r.observacao, pf.nome as usuario
        from recibos r left join perfis pf on pf.id = r.criado_por
       where r.data between p_inicio and p_fim and not r.cancelado) x),
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
