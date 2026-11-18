-- =====================================================================
-- Códigos automáticos: cada cliente e cada produto novo recebe o próximo
-- número (1, 2, 3...), na ordem em que foi criado. Os que já existem e
-- estão sem código ganham número na ordem em que foram cadastrados.
-- Quem já tem código continua com o mesmo.
-- =====================================================================
create sequence if not exists public.produtos_codigo_seq;
create sequence if not exists public.clientes_codigo_seq;

create or replace function public._codigo_automatico()
returns trigger language plpgsql security definer set search_path = public as $$
declare v text; achou boolean;
begin
  if new.codigo is null or trim(new.codigo) = '' then
    loop
      v := nextval(tg_argv[0])::text;
      execute format('select exists (select 1 from %I.%I where codigo = $1)', tg_table_schema, tg_table_name) into achou using v;
      exit when not achou;     -- pula número que alguém digitou à mão
    end loop;
    new.codigo := v;
  end if;
  return new;
end $$;
revoke execute on function public._codigo_automatico() from public, anon, authenticated;

drop trigger if exists codigo_automatico on public.produtos;
create trigger codigo_automatico before insert on public.produtos
  for each row execute function public._codigo_automatico('public.produtos_codigo_seq');
drop trigger if exists codigo_automatico on public.clientes;
create trigger codigo_automatico before insert on public.clientes
  for each row execute function public._codigo_automatico('public.clientes_codigo_seq');

-- numera os que já existem sem código, na ordem de cadastro
-- (a regra "cliente precisa ter vendedor" sai e volta, para numerar também os clientes antigos sem vendedor)
alter table public.clientes drop constraint if exists clientes_vendedor_obrigatorio;
do $$
declare t text; m bigint; r record;
begin
  foreach t in array array['produtos', 'clientes'] loop
    execute format('select coalesce(max(codigo::bigint), 0) from public.%I where codigo ~ ''^[0-9]{1,15}$''', t) into m;
    for r in execute format('select id from public.%I where codigo is null or trim(codigo) = '''' order by criado_em, id', t) loop
      m := m + 1;
      execute format('update public.%I set codigo = $1 where id = $2', t) using m::text, r.id;
    end loop;
    perform setval(format('public.%I', t || '_codigo_seq'), greatest(m, 1), m > 0);
  end loop;
end $$;
alter table public.clientes add constraint clientes_vendedor_obrigatorio check (vendedor_id is not null) not valid;

create or replace function public.versao_banco() returns integer language sql stable as $$ select 27 $$;
