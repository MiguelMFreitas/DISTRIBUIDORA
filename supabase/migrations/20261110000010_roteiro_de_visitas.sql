-- =====================================================================
-- Roteiro de visitas: cada rota tem um vendedor responsável e os
-- clientes da rota têm uma ordem de visita (1º, 2º, 3º...).
-- Trocando o vendedor da rota, o novo segue a mesma ordem.
-- =====================================================================
alter table public.rotas add column if not exists vendedor_id uuid references public.perfis (id) on delete set null;
alter table public.clientes add column if not exists ordem_visita integer;
create index if not exists clientes_rota_ordem on public.clientes (rota_id, ordem_visita);

-- Salva a ordem: p_clientes é a lista na ordem de visita.
-- Clientes da rota que ficarem de fora perdem a ordem (vão para o fim).
create or replace function public.salvar_ordem_visitas(p_rota uuid, p_clientes uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (tem_perm('clientes') or tem_perm('cadastros')) then
    raise exception 'Você não tem permissão para mudar o roteiro.' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(p_clientes) c(id) left join clientes k on k.id = c.id where k.id is null or k.rota_id is distinct from p_rota) then
    raise exception 'Há cliente na lista que não é desta rota.';
  end if;
  update clientes set ordem_visita = array_position(p_clientes, id) where rota_id = p_rota;
end $$;

-- Troca o vendedor responsável pela rota.
-- p_mover_clientes: os clientes da rota passam para a carteira do novo vendedor.
create or replace function public.definir_vendedor_rota(p_rota uuid, p_vendedor uuid, p_mover_clientes boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (tem_perm('clientes') or tem_perm('cadastros')) then
    raise exception 'Você não tem permissão para mudar o vendedor da rota.' using errcode = '42501';
  end if;
  if p_vendedor is not null and not exists (select 1 from perfis where id = p_vendedor and ativo) then
    raise exception 'Vendedor não encontrado ou inativo.';
  end if;
  update rotas set vendedor_id = p_vendedor where id = p_rota;
  if not found then raise exception 'Rota não encontrada.'; end if;
  if p_mover_clientes and p_vendedor is not null then
    update clientes set vendedor_id = p_vendedor where rota_id = p_rota;
  end if;
end $$;

revoke execute on function public.salvar_ordem_visitas(uuid, uuid[]) from public, anon;
grant execute on function public.salvar_ordem_visitas(uuid, uuid[]) to authenticated;
revoke execute on function public.definir_vendedor_rota(uuid, uuid, boolean) from public, anon;
grant execute on function public.definir_vendedor_rota(uuid, uuid, boolean) to authenticated;
