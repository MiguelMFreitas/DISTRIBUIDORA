-- =====================================================================
-- Numeração das cargas (romaneios) recomeça todo dia:
-- hoje Carga 1, 2, 3… amanhã volta para a Carga 1.
-- O número antigo (numero) continua existindo por dentro, mas a tela
-- e o romaneio mostram numero_dia.
-- =====================================================================
alter table public.cargas add column if not exists numero_dia integer;

-- cargas que já existem: numera por dia, na ordem em que foram criadas
update public.cargas c set numero_dia = x.n
  from (select id, row_number() over (partition by data order by numero) as n from public.cargas) x
 where x.id = c.id and c.numero_dia is null;

alter table public.cargas alter column numero_dia set not null;
create unique index if not exists cargas_data_numero_dia on public.cargas (data, numero_dia);

create or replace function public._numerar_carga_do_dia()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.data is distinct from old.data then
    -- uma carga de cada vez por dia, para não repetir número
    perform pg_advisory_xact_lock(hashtext('carga_dia_' || new.data::text));
    select coalesce(max(numero_dia), 0) + 1 into new.numero_dia from cargas where data = new.data and id <> new.id;
  end if;
  return new;
end $$;
revoke execute on function public._numerar_carga_do_dia() from public, anon, authenticated;

drop trigger if exists numerar_carga_do_dia on public.cargas;
create trigger numerar_carga_do_dia before insert or update of data on public.cargas
  for each row execute function public._numerar_carga_do_dia();
