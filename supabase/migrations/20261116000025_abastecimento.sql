-- =====================================================================
-- Abastecimento dos carros
--  * permissão nova "abastecimento" (usuário só para abastecer)
--  * carro: nome, placa e se o painel marca a quilometragem
--  * cada abastecimento: data, km atual (se o carro marca), valor pago,
--    preço do litro, litros (calculado), foto do painel e foto da km
--  * fotos no Storage (pasta privada "abastecimentos")
--  * relatório: km rodados, km por litro e custo por km; entra nas despesas
-- =====================================================================
alter table public.veiculos add column if not exists marca_km boolean not null default true;

-- quem abastece também cadastra os carros
drop policy if exists veiculos_abastecimento on public.veiculos;
create policy veiculos_abastecimento on public.veiculos for all to authenticated
  using (tem_perm('abastecimento')) with check (tem_perm('abastecimento'));

create table if not exists public.abastecimentos (
  id           uuid primary key default gen_random_uuid(),
  veiculo_id   uuid not null references public.veiculos (id) on delete restrict,
  data         date not null default current_date,
  km           numeric(10,0) check (km is null or km >= 0),
  valor        numeric(10,2) not null check (valor > 0),
  preco_litro  numeric(8,3) not null check (preco_litro > 0),
  litros       numeric(10,3) generated always as (round(valor / preco_litro, 3)) stored,
  foto_painel  text not null,
  foto_km      text,
  observacao   text,
  usuario_id   uuid references public.perfis (id) on delete set null default auth.uid(),
  criado_em    timestamptz not null default now()
);
create index if not exists abastecimentos_veiculo on public.abastecimentos (veiculo_id, data desc, criado_em desc);
create index if not exists abastecimentos_data on public.abastecimentos (data);

alter table public.abastecimentos enable row level security;
revoke all on public.abastecimentos from anon;
revoke insert, update, delete on public.abastecimentos from authenticated;
grant select on public.abastecimentos to authenticated;
drop policy if exists abastecimentos_ler on public.abastecimentos;
create policy abastecimentos_ler on public.abastecimentos for select to authenticated
  using (tem_perm('abastecimento') or tem_perm('financeiro'));

-- ---------- registrar ----------
create or replace function public.registrar_abastecimento(
  p_veiculo uuid, p_data date, p_km numeric, p_valor numeric, p_preco_litro numeric,
  p_foto_painel text, p_foto_km text default null, p_observacao text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v veiculos; v_ult numeric; v_id uuid;
begin
  if not tem_perm('abastecimento') then
    raise exception 'Você não tem permissão para lançar abastecimento.' using errcode = '42501';
  end if;
  select * into v from veiculos where id = p_veiculo and ativo;
  if not found then raise exception 'Carro não encontrado ou inativo.'; end if;
  if p_data is null or p_data > current_date + 1 or p_data < current_date - 60 then
    raise exception 'Data inválida.';
  end if;
  if p_valor is null or p_valor <= 0 or p_valor > 10000 then raise exception 'Informe o valor do abastecimento.'; end if;
  if p_preco_litro is null or p_preco_litro <= 0 or p_preco_litro > 50 then raise exception 'Informe o preço do litro.'; end if;
  if p_valor / p_preco_litro > 1000 then raise exception 'Deu mais de 1.000 litros: confira o valor e o preço do litro.'; end if;
  if coalesce(p_foto_painel, '') = '' then raise exception 'Falta a foto do painel.'; end if;
  if v.marca_km then
    if p_km is null then raise exception 'Informe a quilometragem atual do %.', v.nome; end if;
    if coalesce(p_foto_km, '') = '' then raise exception 'Falta a foto da quilometragem.'; end if;
    select km into v_ult from abastecimentos where veiculo_id = p_veiculo and km is not null
     order by data desc, criado_em desc limit 1;
    if v_ult is not null and p_km < v_ult then
      raise exception 'A quilometragem (% km) está menor que a do último abastecimento (% km). Confira o número.',
        to_char(p_km, 'FM999G999G999'), to_char(v_ult, 'FM999G999G999');
    end if;
  end if;
  insert into abastecimentos (veiculo_id, data, km, valor, preco_litro, foto_painel, foto_km, observacao, usuario_id)
  values (p_veiculo, p_data, case when v.marca_km then round(p_km) end, round(p_valor, 2), round(p_preco_litro, 3),
          p_foto_painel, case when v.marca_km then p_foto_km end, nullif(trim(p_observacao), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ---------- apagar (administrador, ou quem lançou no mesmo dia) ----------
create or replace function public.apagar_abastecimento(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare a abastecimentos;
begin
  select * into a from abastecimentos where id = p_id;
  if not found then raise exception 'Abastecimento não encontrado.'; end if;
  if not (eh_admin() or (a.usuario_id = auth.uid() and a.criado_em::date = current_date)) then
    raise exception 'Só o administrador apaga abastecimento (ou quem lançou, no mesmo dia).' using errcode = '42501';
  end if;
  delete from abastecimentos where id = p_id;
  return concat_ws(',', a.foto_painel, a.foto_km);   -- o app apaga as fotos
end $$;

-- ---------- relatório ----------
-- km rodados = km deste abastecimento − km do abastecimento anterior do mesmo carro
-- km/litro   = km rodados ÷ litros deste abastecimento (tanque completo toda semana)
create or replace function public.relatorio_abastecimentos(p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not (tem_perm('abastecimento') or tem_perm('financeiro')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  with todos as (
    select a.*, ve.nome as veiculo, ve.placa, ve.marca_km, pf.nome as usuario,
           lag(a.km) over (partition by a.veiculo_id order by a.data, a.criado_em) as km_anterior
      from abastecimentos a join veiculos ve on ve.id = a.veiculo_id left join perfis pf on pf.id = a.usuario_id
  ), per as (
    select t.*, case when t.km is not null and t.km_anterior is not null then t.km - t.km_anterior end as km_rodados
      from todos t where t.data between p_inicio and p_fim
  )
  select jsonb_build_object(
    'total_valor',  (select coalesce(sum(valor), 0) from per),
    'total_litros', (select coalesce(sum(litros), 0) from per),
    'quantidade',   (select count(*) from per),
    'lista', (select coalesce(jsonb_agg(x order by x.data desc, x.criado_em desc), '[]') from (
      select id, veiculo_id, veiculo, placa, data, criado_em, km, km_anterior, km_rodados, valor, preco_litro, litros,
             case when km_rodados > 0 and litros > 0 then round(km_rodados / litros, 2) end as km_litro,
             case when km_rodados > 0 then round(valor / km_rodados, 2) end as custo_km,
             foto_painel, foto_km, observacao, usuario, usuario_id
        from per) x),
    'por_veiculo', (select coalesce(jsonb_agg(x order by x.valor desc), '[]') from (
      select veiculo_id, veiculo, placa, count(*) as abastecimentos, sum(valor) as valor, sum(litros) as litros,
             sum(km_rodados) as km_rodados,
             case when sum(km_rodados) > 0 then round(sum(km_rodados) / nullif(sum(litros) filter (where km_rodados is not null), 0), 2) end as km_litro,
             case when sum(km_rodados) > 0 then round(sum(valor) filter (where km_rodados is not null) / sum(km_rodados), 2) end as custo_km
        from per group by veiculo_id, veiculo, placa) x)
  ) into v;
  return v;
end $$;

-- ---------- fotos (Storage, pasta privada) ----------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('abastecimentos', 'abastecimentos', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = 8388608, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
    execute 'drop policy if exists abastecimentos_fotos_enviar on storage.objects';
    execute 'drop policy if exists abastecimentos_fotos_ver on storage.objects';
    execute 'drop policy if exists abastecimentos_fotos_apagar on storage.objects';
    execute $p$create policy abastecimentos_fotos_enviar on storage.objects for insert to authenticated
               with check (bucket_id = 'abastecimentos' and public.tem_perm('abastecimento'))$p$;
    execute $p$create policy abastecimentos_fotos_ver on storage.objects for select to authenticated
               using (bucket_id = 'abastecimentos' and (public.tem_perm('abastecimento') or public.tem_perm('financeiro')))$p$;
    execute $p$create policy abastecimentos_fotos_apagar on storage.objects for delete to authenticated
               using (bucket_id = 'abastecimentos' and public.tem_perm('abastecimento'))$p$;
  end if;
end $$;

revoke execute on function public.registrar_abastecimento(uuid, date, numeric, numeric, numeric, text, text, text) from public, anon;
grant execute on function public.registrar_abastecimento(uuid, date, numeric, numeric, numeric, text, text, text) to authenticated;
revoke execute on function public.apagar_abastecimento(uuid) from public, anon;
grant execute on function public.apagar_abastecimento(uuid) to authenticated;
revoke execute on function public.relatorio_abastecimentos(date, date) from public, anon;
grant execute on function public.relatorio_abastecimentos(date, date) to authenticated;

create or replace function public.versao_banco() returns integer language sql stable as $$ select 25 $$;
