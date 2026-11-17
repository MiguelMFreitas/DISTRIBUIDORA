-- =====================================================================
-- Combustível
--  * cada carro diz o que aceita: etanol, gasolina, diesel e/ou gás (GNV)
--    (carro flex: etanol e gasolina)
--  * no abastecimento escolhe o combustível
--  * valor pago, preço do litro e litros: põe dois, o terceiro é calculado
-- =====================================================================
alter table public.veiculos add column if not exists combustiveis text[] not null default '{}';
alter table public.veiculos drop constraint if exists veiculos_combustiveis_check;
alter table public.veiculos add constraint veiculos_combustiveis_check
  check (combustiveis <@ array['etanol', 'gasolina', 'diesel', 'gnv']::text[]);

alter table public.abastecimentos add column if not exists combustivel text;
alter table public.abastecimentos drop constraint if exists abastecimentos_combustivel_check;
alter table public.abastecimentos add constraint abastecimentos_combustivel_check
  check (combustivel is null or combustivel in ('etanol', 'gasolina', 'diesel', 'gnv'));

-- litros deixa de ser sempre calculado: pode ser o valor que a bomba mostrou
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'abastecimentos' and column_name = 'litros' and is_generated = 'ALWAYS') then
    alter table public.abastecimentos alter column litros drop expression;
  end if;
end $$;
alter table public.abastecimentos alter column litros set not null;
alter table public.abastecimentos drop constraint if exists abastecimentos_litros_check;
alter table public.abastecimentos add constraint abastecimentos_litros_check check (litros > 0);

drop function if exists public.registrar_abastecimento(uuid, date, numeric, numeric, numeric, text, text, text);
-- p_valor, p_preco_litro, p_litros: precisa de pelo menos dois; o que faltar é calculado.
-- Se vierem os três, vale o valor pago e os litros (o que a bomba mostra) e o preço é recalculado.
create or replace function public.registrar_abastecimento(
  p_veiculo uuid, p_data date, p_km numeric, p_valor numeric, p_preco_litro numeric, p_litros numeric,
  p_combustivel text, p_foto_painel text, p_foto_km text default null, p_observacao text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v veiculos; v_ult numeric; v_id uuid;
        v_valor numeric := nullif(p_valor, 0); v_preco numeric := nullif(p_preco_litro, 0); v_litros numeric := nullif(p_litros, 0);
begin
  if not tem_perm('abastecimento') then
    raise exception 'Você não tem permissão para lançar abastecimento.' using errcode = '42501';
  end if;
  select * into v from veiculos where id = p_veiculo and ativo;
  if not found then raise exception 'Carro não encontrado ou inativo.'; end if;
  if p_data is null or p_data > current_date + 1 or p_data < current_date - 60 then
    raise exception 'Data inválida.';
  end if;

  -- combustível
  if p_combustivel is not null and p_combustivel not in ('etanol', 'gasolina', 'diesel', 'gnv') then
    raise exception 'Combustível inválido.';
  end if;
  if cardinality(v.combustiveis) > 0 then
    if p_combustivel is null then raise exception 'Escolha o combustível.'; end if;
    if not p_combustivel = any (v.combustiveis) then
      raise exception 'O % não está cadastrado para usar esse combustível. Arrume no cadastro do carro.', v.nome;
    end if;
  end if;

  -- dois dos três; o terceiro é calculado
  if (v_valor is not null)::int + (v_preco is not null)::int + (v_litros is not null)::int < 2 then
    raise exception 'Preencha dois destes: valor pago, preço do litro ou litros.';
  end if;
  if v_valor < 0 or v_preco < 0 or v_litros < 0 then raise exception 'Valores não podem ser negativos.'; end if;
  if v_valor is not null and v_litros is not null then
    v_preco := round(v_valor / v_litros, 3);
  elsif v_valor is not null then
    v_litros := round(v_valor / v_preco, 3);
  else
    v_valor := round(v_preco * v_litros, 2);
  end if;
  if v_valor > 10000 then raise exception 'Valor muito alto: confira.'; end if;
  if v_preco > 50 or v_preco < 0.5 then raise exception 'O preço do litro deu R$ %: confira os números.', to_char(v_preco, 'FM990D000'); end if;
  if v_litros > 1000 then raise exception 'Deu mais de 1.000 litros: confira os números.'; end if;

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

  insert into abastecimentos (veiculo_id, data, km, valor, preco_litro, litros, combustivel, foto_painel, foto_km, observacao, usuario_id)
  values (p_veiculo, p_data, case when v.marca_km then round(p_km) end, round(v_valor, 2), round(v_preco, 3), round(v_litros, 3),
          p_combustivel, p_foto_painel, case when v.marca_km then p_foto_km end, nullif(trim(p_observacao), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- relatório com o combustível
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
      select id, veiculo_id, veiculo, placa, data, criado_em, km, km_anterior, km_rodados, valor, preco_litro, litros, combustivel,
             case when km_rodados > 0 and litros > 0 then round(km_rodados / litros, 2) end as km_litro,
             case when km_rodados > 0 then round(valor / km_rodados, 2) end as custo_km,
             foto_painel, foto_km, observacao, usuario, usuario_id
        from per) x),
    'por_veiculo', (select coalesce(jsonb_agg(x order by x.valor desc), '[]') from (
      select veiculo_id, veiculo, placa, count(*) as abastecimentos, sum(valor) as valor, sum(litros) as litros,
             sum(km_rodados) as km_rodados,
             case when sum(km_rodados) > 0 then round(sum(km_rodados) / nullif(sum(litros) filter (where km_rodados is not null), 0), 2) end as km_litro,
             case when sum(km_rodados) > 0 then round(sum(valor) filter (where km_rodados is not null) / sum(km_rodados), 2) end as custo_km
        from per group by veiculo_id, veiculo, placa) x),
    'por_combustivel', (select coalesce(jsonb_agg(x order by x.valor desc), '[]') from (
      select coalesce(combustivel, 'nao_informado') as combustivel, count(*) as abastecimentos, sum(valor) as valor, sum(litros) as litros,
             round(sum(valor) / nullif(sum(litros), 0), 3) as preco_medio
        from per group by coalesce(combustivel, 'nao_informado')) x)
  ) into v;
  return v;
end $$;

revoke execute on function public.registrar_abastecimento(uuid, date, numeric, numeric, numeric, numeric, text, text, text, text) from public, anon;
grant execute on function public.registrar_abastecimento(uuid, date, numeric, numeric, numeric, numeric, text, text, text, text) to authenticated;

create or replace function public.versao_banco() returns integer language sql stable as $$ select 26 $$;
