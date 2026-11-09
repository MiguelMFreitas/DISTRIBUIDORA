-- =====================================================================
-- Alerta para o vendedor: quais clientes do roteiro dele tiveram pedido
-- num dia (de qualquer vendedor ou do escritório). O app usa isso para
-- mostrar "ainda faltam" (hoje) e "não vendeu para" (ontem).
-- O vendedor só recebe ids de clientes das rotas em que é o responsável.
-- =====================================================================
create or replace function public.clientes_do_roteiro_com_pedido(p_dia date)
returns setof uuid language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Faça login.' using errcode = '42501'; end if;
  return query
  select distinct p.cliente_id
    from pedidos p
    join clientes c on c.id = p.cliente_id
    join rotas r on r.id = c.rota_id
   where r.vendedor_id = auth.uid()
     and c.ordem_visita is not null
     and p.status not in ('cancelado', 'recusado')
     and p.feito_em >= p_dia::timestamptz and p.feito_em < (p_dia + 1)::timestamptz;
end $$;

revoke execute on function public.clientes_do_roteiro_com_pedido(date) from public, anon;
grant execute on function public.clientes_do_roteiro_com_pedido(date) to authenticated;
