-- =====================================================================
-- Impressão automática dos pedidos: a tela "Impressão automática" pega
-- os pedidos liberados que ainda não foram impressos e já marca como
-- impressos, numa operação só. Assim, mesmo com a tela aberta em dois
-- computadores, cada pedido sai uma vez.
-- =====================================================================
create or replace function public.pegar_pedidos_para_imprimir(p_desde timestamptz)
returns setof uuid language plpgsql security definer set search_path = public as $$
begin
  if not (tem_perm('pedidos_ver_todos') or tem_perm('cargas')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return query
  update pedidos set impresso_em = now()
   where id in (
     select id from pedidos
      where status = 'liberado' and impresso_em is null and criado_em >= p_desde
      order by numero
      for update skip locked
      limit 50)
  returning id;
end $$;

-- quantos estão esperando (para a tela mostrar antes de ligar)
create or replace function public.pedidos_sem_imprimir(p_desde timestamptz)
returns integer language plpgsql stable security definer set search_path = public as $$
begin
  if not (tem_perm('pedidos_ver_todos') or tem_perm('cargas')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return (select count(*) from pedidos where status = 'liberado' and impresso_em is null and criado_em >= p_desde);
end $$;

revoke execute on function public.pegar_pedidos_para_imprimir(timestamptz) from public, anon;
grant execute on function public.pegar_pedidos_para_imprimir(timestamptz) to authenticated;
revoke execute on function public.pedidos_sem_imprimir(timestamptz) from public, anon;
grant execute on function public.pedidos_sem_imprimir(timestamptz) to authenticated;
