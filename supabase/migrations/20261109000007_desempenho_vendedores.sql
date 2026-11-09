-- =====================================================================
-- Desempenho dos vendedores no período (dia, semana ou mês):
-- pedidos, clientes atendidos, quantidade por unidade (CX/FD/LT/UN),
-- valor vendido e quanto cada um vendeu de cada produto.
-- Conta pedidos liberados, carregados, entregues e aguardando aprovação
-- (igual ao ranking); não conta cancelados nem recusados.
-- =====================================================================
create or replace function public.desempenho_vendedores(p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not eh_admin() then
    raise exception 'Só administradores veem o desempenho dos vendedores.' using errcode = '42501';
  end if;

  with ped as (
    select p.* from pedidos p
     where p.status not in ('cancelado', 'recusado')
       and p.vendedor_id is not null
       and p.feito_em >= p_inicio::timestamptz and p.feito_em < (p_fim + 1)::timestamptz
  ), it as (
    select i.*, ped.vendedor_id, ped.cliente_id, pr.nome as produto, pr.codigo, pr.unidade
      from pedido_itens i join ped on ped.id = i.pedido_id join produtos pr on pr.id = i.produto_id
  )
  select jsonb_build_object(
    'vendedores', (select coalesce(jsonb_agg(x order by x.valor desc), '[]') from (
      select pf.id as vendedor_id, pf.nome,
             (select count(*) from ped where ped.vendedor_id = pf.id) as pedidos,
             (select count(distinct cliente_id) from ped where ped.vendedor_id = pf.id) as clientes,
             coalesce((select sum(quantidade) from it where it.vendedor_id = pf.id), 0) as itens,
             coalesce((select sum(quantidade) from it where it.vendedor_id = pf.id and unidade = 'CX'), 0) as caixas,
             coalesce((select sum(quantidade) from it where it.vendedor_id = pf.id and unidade = 'FD'), 0) as fardos,
             coalesce((select sum(quantidade) from it where it.vendedor_id = pf.id and unidade = 'LT'), 0) as litros,
             coalesce((select sum(quantidade) from it where it.vendedor_id = pf.id and unidade = 'UN'), 0) as unidades,
             coalesce((select sum(total) from ped where ped.vendedor_id = pf.id), 0) as valor
        from perfis pf
       where pf.id in (select vendedor_id from ped)
          or (pf.ativo and 'pedidos_criar' = any (pf.permissoes))
    ) x),
    'produtos', (select coalesce(jsonb_agg(x order by x.produto, x.vendedor_id), '[]') from (
      select vendedor_id, produto_id, produto, codigo, unidade,
             sum(quantidade) as quantidade, sum(total) as valor, count(distinct cliente_id) as clientes
        from it group by vendedor_id, produto_id, produto, codigo, unidade
    ) x)
  ) into v;
  return v;
end $$;

revoke execute on function public.desempenho_vendedores(date, date) from public, anon;
grant execute on function public.desempenho_vendedores(date, date) to authenticated;
