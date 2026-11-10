-- =====================================================================
-- Agenda de visitas: para cada vendedor, qual rota ele faz em cada dia
-- da semana e período (manhã/tarde).
-- Ex.: segunda manhã = MONTESE, segunda tarde = CENTRO.
-- dia_semana: 0 = domingo, 1 = segunda ... 6 = sábado
-- =====================================================================
create table if not exists public.agenda_visitas (
  id           uuid primary key default gen_random_uuid(),
  vendedor_id  uuid not null references public.perfis (id) on delete cascade,
  dia_semana   smallint not null check (dia_semana between 0 and 6),
  turno        text not null check (turno in ('manha', 'tarde')),
  rota_id      uuid not null references public.rotas (id) on delete cascade,
  unique (vendedor_id, dia_semana, turno)
);
create index if not exists agenda_visitas_rota on public.agenda_visitas (rota_id);

alter table public.agenda_visitas enable row level security;
revoke all on public.agenda_visitas from anon;
create policy agenda_ler on public.agenda_visitas for select to authenticated using (true);
revoke insert, update, delete on public.agenda_visitas from authenticated;

-- Salva a semana inteira de um vendedor.
-- p_itens: [{"dia": 1, "turno": "manha", "rota_id": "..."}, ...]  (sem rota = folga)
-- Rota sem vendedor passa a ser dele (com a carteira de clientes).
-- Rota de outro vendedor não pode: troque o vendedor da rota antes.
create or replace function public.salvar_agenda(p_vendedor uuid, p_itens jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_dono uuid;
begin
  if not (tem_perm('clientes') or tem_perm('cadastros')) then
    raise exception 'Você não tem permissão para mudar a agenda.' using errcode = '42501';
  end if;
  if not exists (select 1 from perfis where id = p_vendedor and ativo) then
    raise exception 'Vendedor não encontrado ou inativo.';
  end if;

  for r in select distinct (e->>'rota_id')::uuid as rota_id
             from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
            where nullif(e->>'rota_id', '') is not null
  loop
    select vendedor_id into v_dono from rotas where id = r.rota_id;
    if not found then raise exception 'Rota não encontrada.'; end if;
    if v_dono is null then
      perform definir_vendedor_rota(r.rota_id, p_vendedor, true);
    elsif v_dono <> p_vendedor then
      raise exception 'A rota % é do vendedor %. Troque o vendedor da rota em "Roteiro de visitas" antes.',
        (select nome from rotas where id = r.rota_id), (select nome from perfis where id = v_dono);
    end if;
  end loop;

  delete from agenda_visitas where vendedor_id = p_vendedor;
  insert into agenda_visitas (vendedor_id, dia_semana, turno, rota_id)
  select p_vendedor, (e->>'dia')::smallint, e->>'turno', (e->>'rota_id')::uuid
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
   where nullif(e->>'rota_id', '') is not null;
end $$;

revoke execute on function public.salvar_agenda(uuid, jsonb) from public, anon;
grant execute on function public.salvar_agenda(uuid, jsonb) to authenticated;
