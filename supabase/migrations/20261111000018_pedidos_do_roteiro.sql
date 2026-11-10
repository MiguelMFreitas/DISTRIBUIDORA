-- =====================================================================
-- Para o celular mostrar QUEM tirou pedido de cada cliente do roteiro
-- (dois vendedores podem tirar pedido do mesmo cliente no mesmo dia).
-- Só clientes das rotas em que o vendedor trabalha.
-- =====================================================================
create or replace function public.pedidos_do_roteiro(p_dia date)
returns table (cliente_id uuid, numero bigint, vendedor text, meu boolean, total numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Faça login.' using errcode = '42501'; end if;
  return query
  select p.cliente_id, p.numero, pf.nome, p.vendedor_id = auth.uid(), p.total
    from pedidos p
    join clientes c on c.id = p.cliente_id
    left join perfis pf on pf.id = p.vendedor_id
   where c.rota_id = any (rotas_do_vendedor(auth.uid()))
     and p.status not in ('cancelado', 'recusado')
     and p.feito_em >= p_dia::timestamptz and p.feito_em < (p_dia + 1)::timestamptz
   order by p.numero;
end $$;
revoke execute on function public.pedidos_do_roteiro(date) from public, anon;
grant execute on function public.pedidos_do_roteiro(date) to authenticated;
