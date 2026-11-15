-- =====================================================================
-- Agenda: o vendedor pode visitar mais de um bairro no mesmo período
-- (ex.: segunda de manhã SERRINHA e CENTRO). Cada bairro continua separado
-- no celular, nas visitas do dia e no romaneio.
-- =====================================================================
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.agenda_visitas'::regclass and contype = 'u'
  loop
    execute format('alter table public.agenda_visitas drop constraint %I', c);
  end loop;
end $$;
alter table public.agenda_visitas
  add constraint agenda_visitas_vendedor_dia_turno_rota_key unique (vendedor_id, dia_semana, turno, rota_id);

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
    if not found then raise exception 'Bairro não encontrado.'; end if;
    if v_dono is null then
      perform definir_vendedor_rota(r.rota_id, p_vendedor, true);
    end if;  -- bairro de outro vendedor: fica compartilhado (os dois vendem nele)
  end loop;

  delete from agenda_visitas where vendedor_id = p_vendedor;
  insert into agenda_visitas (vendedor_id, dia_semana, turno, rota_id)
  select distinct p_vendedor, (e->>'dia')::smallint, e->>'turno', (e->>'rota_id')::uuid
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
   where nullif(e->>'rota_id', '') is not null;
end $$;

create or replace function public.versao_banco() returns integer language sql stable as $$ select 23 $$;
