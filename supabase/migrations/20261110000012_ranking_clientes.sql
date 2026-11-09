-- =====================================================================
-- Ranking dos clientes no período (semana ou mês): quantas vezes
-- compraram (pedidos), quantos itens e quanto em reais.
-- Mesma regra do ranking dos vendedores: não conta cancelados e recusados.
-- =====================================================================
create or replace function public.ranking_clientes(p_inicio date, p_fim date)
returns table (cliente_id uuid, cliente text, fantasia text, bairro text, rota text, vendedor text,
               pedidos bigint, itens numeric, caixas numeric, valor numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not eh_admin() then raise exception 'Só administradores veem o ranking.' using errcode = '42501'; end if;
  return query
  with ped as (
    select p.id, p.cliente_id, p.total from pedidos p
     where p.status not in ('cancelado', 'recusado')
       and p.feito_em >= p_inicio::timestamptz and p.feito_em < (p_fim + 1)::timestamptz
  ), it as (
    select ped.cliente_id, sum(i.quantidade) as itens,
           sum(case when pr.unidade = 'CX' then i.quantidade else 0 end) as caixas
      from ped join pedido_itens i on i.pedido_id = ped.id join produtos pr on pr.id = i.produto_id
     group by ped.cliente_id
  )
  select c.id, c.razao_social, c.nome_fantasia, c.bairro, r.nome, pf.nome,
         count(ped.id), coalesce(max(it.itens), 0), coalesce(max(it.caixas), 0), coalesce(sum(ped.total), 0)
    from ped
    join clientes c on c.id = ped.cliente_id
    left join rotas r on r.id = c.rota_id
    left join perfis pf on pf.id = c.vendedor_id
    left join it on it.cliente_id = c.id
   group by c.id, c.razao_social, c.nome_fantasia, c.bairro, r.nome, pf.nome;
end $$;

revoke execute on function public.ranking_clientes(date, date) from public, anon;
grant execute on function public.ranking_clientes(date, date) to authenticated;
