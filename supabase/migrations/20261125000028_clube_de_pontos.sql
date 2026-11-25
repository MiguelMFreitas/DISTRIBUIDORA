-- =====================================================================
-- Clube de pontos (parte 1: no sistema)
--  * só pedidos feitos pelo robô do WhatsApp (origem 'whatsapp') ganham pontos
--  * 1 ponto a cada R$ 1 PAGO × multiplicador do nível (Bronze, Prata, Ouro)
--  * os pontos entram quando o escritório marca o pedido como pago (Recebimentos);
--    itens que voltaram (na conferência ou no recebimento) não contam
--  * cada lote de pontos vence 3 meses depois de entrar; usa primeiro os mais antigos
--  * prêmios: o cliente troca pontos por produto, que vai de graça no próximo pedido
--  * desafios: comprar X fardos/caixas de certos produtos no período = pontos extras
--  * níveis: calculados todo mês pelas compras do mês anterior (metas: rota, produtos,
--    quantidade e volume); o nível dá mais pontos por real
-- =====================================================================

-- ---------------- produtos e clientes ----------------
alter table public.produtos add column if not exists litros numeric(10,2) check (litros is null or litros >= 0);
alter table public.produtos add column if not exists apelidos text[] not null default '{}';
grant insert (litros, apelidos), update (litros, apelidos) on public.produtos to authenticated;

alter table public.clientes add column if not exists whatsapp text;
create unique index if not exists clientes_whatsapp_unico on public.clientes (whatsapp) where whatsapp is not null;
-- WhatsApp sempre só com números e com o 55 do Brasil (ex.: 5585999998888)
create or replace function public._normalizar_whatsapp()
returns trigger language plpgsql set search_path = public as $$
declare d text := regexp_replace(coalesce(new.whatsapp, ''), '\D', '', 'g');
begin
  if d = '' then new.whatsapp := null; return new; end if;
  if length(d) in (10, 11) then d := '55' || d; end if;
  if length(d) not between 12 and 13 then raise exception 'WhatsApp inválido: use DDD + número (ex.: 85 99999-8888).'; end if;
  new.whatsapp := d;
  return new;
end $$;
drop trigger if exists normalizar_whatsapp on public.clientes;
create trigger normalizar_whatsapp before insert or update of whatsapp on public.clientes
  for each row execute function public._normalizar_whatsapp();

-- ---------------- pedidos: pagamento, devolução e pontos ----------------
alter table public.pedidos drop constraint if exists pedidos_origem_check;
alter table public.pedidos add constraint pedidos_origem_check check (origem in ('sistema', 'link', 'whatsapp'));
alter table public.pedidos add column if not exists pago_em timestamptz;
alter table public.pedidos add column if not exists pago_forma text;
alter table public.pedidos drop constraint if exists pedidos_pago_forma_check;
alter table public.pedidos add constraint pedidos_pago_forma_check check (pago_forma is null or pago_forma in ('dinheiro', 'pix', 'cartao', 'boleto', 'outro'));
alter table public.pedidos add column if not exists valor_pago numeric(12,2);
alter table public.pedidos add column if not exists recebido_por uuid references public.perfis (id) on delete set null;
alter table public.pedidos add column if not exists total_devolvido numeric(12,2) not null default 0;
alter table public.pedidos add column if not exists pontos_ganhos integer not null default 0;
create index if not exists pedidos_a_receber on public.pedidos (feito_em) where pago_em is null;

alter table public.pedido_itens add column if not exists devolvido numeric(12,1) not null default 0;
alter table public.pedido_itens drop constraint if exists pedido_itens_devolvido_check;
alter table public.pedido_itens add constraint pedido_itens_devolvido_check check (devolvido >= 0 and devolvido <= quantidade);
alter table public.pedido_itens add column if not exists troca_id uuid;
alter table public.conferencia_itens add column if not exists pedido_id uuid references public.pedidos (id) on delete set null;

-- ---------------- tabelas do clube ----------------
create table if not exists public.premios (
  id          uuid primary key default gen_random_uuid(),
  produto_id  uuid not null references public.produtos (id),
  quantidade  numeric(12,1) not null default 1 check (quantidade > 0),
  pontos      integer not null check (pontos > 0),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

create table if not exists public.trocas_pontos (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes (id) on delete cascade,
  premio_id   uuid references public.premios (id) on delete set null,
  produto_id  uuid not null references public.produtos (id),
  quantidade  numeric(12,1) not null,
  pontos      integer not null,
  status      text not null default 'pendente' check (status in ('pendente', 'no_pedido', 'entregue', 'cancelada')),
  pedido_id   uuid references public.pedidos (id) on delete set null,
  debito_id   uuid,
  usuario_id  uuid references public.perfis (id) on delete set null default auth.uid(),
  criado_em   timestamptz not null default now()
);
create index if not exists trocas_pendentes on public.trocas_pontos (cliente_id) where status = 'pendente';
alter table public.pedido_itens drop constraint if exists pedido_itens_troca_fk;
alter table public.pedido_itens add constraint pedido_itens_troca_fk foreign key (troca_id) references public.trocas_pontos (id) on delete set null;

create table if not exists public.desafios (
  id          uuid primary key default gen_random_uuid(),
  titulo      text not null,
  descricao   text,
  inicio      date not null,
  fim         date not null,
  produtos    uuid[] not null,
  meta        numeric(12,1) not null check (meta > 0),
  bonus       integer not null check (bonus > 0),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  check (fim >= inicio),
  check (cardinality(produtos) > 0)
);

-- extrato: créditos (lotes que vencem) e débitos
create table if not exists public.pontos_movimentos (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes (id) on delete cascade,
  tipo        text not null check (tipo in ('compra', 'desafio', 'ajuste', 'troca', 'troca_cancelada', 'vencimento', 'estorno')),
  pontos      integer not null check (pontos <> 0),
  restante    integer not null default 0 check (restante >= 0),   -- só nos créditos: quanto ainda pode usar
  vence_em    date,                                                -- só nos créditos
  pedido_id   uuid references public.pedidos (id) on delete set null,
  desafio_id  uuid references public.desafios (id) on delete set null,
  troca_id    uuid references public.trocas_pontos (id) on delete set null,
  descricao   text,
  usuario_id  uuid references public.perfis (id) on delete set null default auth.uid(),
  criado_em   timestamptz not null default now()
);
create index if not exists pontos_cliente on public.pontos_movimentos (cliente_id, criado_em desc);
create index if not exists pontos_lotes on public.pontos_movimentos (cliente_id, vence_em) where restante > 0;

-- de quais lotes cada débito tirou (para devolver certinho quando cancela)
create table if not exists public.pontos_consumos (
  debito_id   uuid not null references public.pontos_movimentos (id) on delete cascade,
  credito_id  uuid not null references public.pontos_movimentos (id) on delete cascade,
  pontos      integer not null check (pontos > 0),
  primary key (debito_id, credito_id)
);

create table if not exists public.desafios_conquistas (
  desafio_id    uuid not null references public.desafios (id) on delete cascade,
  cliente_id    uuid not null references public.clientes (id) on delete cascade,
  pontos        integer not null,
  movimento_id  uuid references public.pontos_movimentos (id) on delete set null,
  criado_em     timestamptz not null default now(),
  primary key (desafio_id, cliente_id)
);

create table if not exists public.clube_niveis (
  cliente_id    uuid not null references public.clientes (id) on delete cascade,
  mes           date not null,          -- 1º dia do mês em que o nível vale
  nivel         text not null check (nivel in ('bronze', 'prata', 'ouro')),
  metas         jsonb not null default '{}',
  calculado_em  timestamptz not null default now(),
  primary key (cliente_id, mes)
);

-- leitura: escritório; gravação: só pelas funções (prêmios e desafios: administrador)
do $$
declare t text;
begin
  foreach t in array array['premios', 'trocas_pontos', 'desafios', 'pontos_movimentos', 'pontos_consumos', 'desafios_conquistas', 'clube_niveis'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
    execute format($p$create policy %I on public.%I for select to authenticated
                    using (tem_perm('pedidos_ver_todos') or tem_perm('clientes') or tem_perm('financeiro'))$p$, t || '_ler', t);
  end loop;
  foreach t in array array['premios', 'desafios'] loop
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_gravar', t);
    execute format('create policy %I on public.%I for all to authenticated using (eh_admin()) with check (eh_admin())', t || '_gravar', t);
  end loop;
end $$;

-- ---------------- regras (Clube de pontos → Níveis, no sistema) ----------------
insert into public.configuracoes (chave, valor) values ('clube', '{}') on conflict (chave) do nothing;
create or replace function public._clube_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select '{"pontos_por_real": 1, "validade_meses": 3,
           "multiplicadores": {"bronze": 1, "prata": 1.2, "ouro": 1.5},
           "metas_prata": 2, "metas_ouro": 4,
           "meta_rota": true, "produtos_foco": [], "produtos_foco_minimo": 1,
           "quantidade_minima": 0, "volume_minimo": 0}'::jsonb
         || coalesce((select valor from configuracoes where chave = 'clube'), '{}'::jsonb)
$$;

create or replace function public._eh_cliente_generico(p uuid)
returns boolean language sql immutable as $$
  select p in ('f0000000-0000-4000-8000-00000000c11e')
$$;

-- ---------------- pontos: créditos, débitos e vencimento ----------------
create or replace function public._vencer_pontos(p_cliente uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; v_deb uuid; v_total integer := 0;
begin
  for r in select id, restante, vence_em from pontos_movimentos
            where (p_cliente is null or cliente_id = p_cliente) and restante > 0 and vence_em < current_date
            order by vence_em for update loop
    insert into pontos_movimentos (cliente_id, tipo, pontos, descricao)
    select cliente_id, 'vencimento', -r.restante, 'Pontos que venceram em ' || to_char(r.vence_em, 'DD/MM/YYYY')
      from pontos_movimentos where id = r.id
    returning id into v_deb;
    insert into pontos_consumos (debito_id, credito_id, pontos) values (v_deb, r.id, r.restante);
    update pontos_movimentos set restante = 0 where id = r.id;
    v_total := v_total + r.restante;
  end loop;
  return v_total;
end $$;

create or replace function public._saldo_pontos(p_cliente uuid)
returns integer language plpgsql security definer set search_path = public as $$
begin
  perform _vencer_pontos(p_cliente);
  return coalesce((select sum(restante) from pontos_movimentos where cliente_id = p_cliente and restante > 0), 0)::integer;
end $$;

create or replace function public._creditar_pontos(p_cliente uuid, p_pontos integer, p_tipo text, p_descricao text,
                                                   p_pedido uuid default null, p_desafio uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; v_meses integer := (_clube_config() ->> 'validade_meses')::integer;
begin
  if p_pontos is null or p_pontos <= 0 then return null; end if;
  insert into pontos_movimentos (cliente_id, tipo, pontos, restante, vence_em, pedido_id, desafio_id, descricao)
  values (p_cliente, p_tipo, p_pontos, p_pontos, current_date + make_interval(months => v_meses), p_pedido, p_desafio, p_descricao)
  returning id into v;
  return v;
end $$;

-- tira pontos dos lotes mais antigos primeiro; p_parcial: tira o que tiver (sem dar erro)
create or replace function public._debitar_pontos(p_cliente uuid, p_pontos integer, p_tipo text, p_descricao text,
                                                  p_troca uuid default null, p_pedido uuid default null, p_parcial boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_saldo integer; v_falta integer; v_deb uuid; r record; v_tira integer;
begin
  if p_pontos is null or p_pontos <= 0 then return null; end if;
  perform 1 from clientes where id = p_cliente for update;   -- um débito por vez por cliente
  v_saldo := _saldo_pontos(p_cliente);
  if v_saldo < p_pontos and not p_parcial then
    raise exception 'Pontos insuficientes: o cliente tem % e precisa de %.', v_saldo, p_pontos;
  end if;
  v_falta := least(p_pontos, v_saldo);
  if v_falta <= 0 then return null; end if;
  insert into pontos_movimentos (cliente_id, tipo, pontos, troca_id, pedido_id, descricao)
  values (p_cliente, p_tipo, -v_falta, p_troca, p_pedido, p_descricao) returning id into v_deb;
  for r in select id, restante from pontos_movimentos
            where cliente_id = p_cliente and restante > 0 order by vence_em, criado_em for update loop
    exit when v_falta <= 0;
    v_tira := least(r.restante, v_falta);
    update pontos_movimentos set restante = restante - v_tira where id = r.id;
    insert into pontos_consumos (debito_id, credito_id, pontos) values (v_deb, r.id, v_tira);
    v_falta := v_falta - v_tira;
  end loop;
  return v_deb;
end $$;

-- devolve um débito para os mesmos lotes de onde saiu (ex.: troca cancelada)
create or replace function public._devolver_debito(p_debito uuid, p_tipo text, p_descricao text)
returns void language plpgsql security definer set search_path = public as $$
declare v_total integer; v_cliente uuid;
begin
  select cliente_id into v_cliente from pontos_movimentos where id = p_debito;
  if not found then return; end if;
  update pontos_movimentos m set restante = m.restante + c.pontos
    from pontos_consumos c where c.debito_id = p_debito and m.id = c.credito_id;
  select coalesce(sum(pontos), 0) into v_total from pontos_consumos where debito_id = p_debito;
  delete from pontos_consumos where debito_id = p_debito;
  if v_total > 0 then
    insert into pontos_movimentos (cliente_id, tipo, pontos, descricao) values (v_cliente, p_tipo, v_total, p_descricao);
  end if;
  perform _vencer_pontos(v_cliente);   -- se o lote já tinha vencido, vence de novo
end $$;

-- tira pontos que foram dados por um pedido (devolução depois de pago, ou pagamento desfeito)
create or replace function public._estornar_pontos_pedido(p_pedido uuid, p_pontos integer, p_descricao text, p_parcial boolean)
returns integer language plpgsql security definer set search_path = public as $$
declare v_cliente uuid; v_falta integer := p_pontos; r record; v_tira integer; v_deb uuid; v_tirado integer := 0;
begin
  if p_pontos is null or p_pontos <= 0 then return 0; end if;
  select cliente_id into v_cliente from pedidos where id = p_pedido;
  perform _vencer_pontos(v_cliente);
  if not p_parcial and coalesce((select sum(restante) from pontos_movimentos where pedido_id = p_pedido and tipo = 'compra'), 0) < p_pontos then
    raise exception 'O cliente já usou os pontos deste pedido; não dá para desfazer o recebimento.';
  end if;
  insert into pontos_movimentos (cliente_id, tipo, pontos, pedido_id, descricao)
  values (v_cliente, 'estorno', -p_pontos, p_pedido, p_descricao) returning id into v_deb;
  -- primeiro do lote do próprio pedido, depois dos outros (mais antigos primeiro)
  for r in select id, restante from pontos_movimentos
            where cliente_id = v_cliente and restante > 0
            order by (pedido_id = p_pedido and tipo = 'compra') desc, vence_em, criado_em for update loop
    exit when v_falta <= 0;
    v_tira := least(r.restante, v_falta);
    update pontos_movimentos set restante = restante - v_tira where id = r.id;
    insert into pontos_consumos (debito_id, credito_id, pontos) values (v_deb, r.id, v_tira);
    v_falta := v_falta - v_tira;
    v_tirado := v_tirado + v_tira;
  end loop;
  if v_tirado < p_pontos then   -- não tinha tudo: o extrato mostra só o que saiu de verdade
    if v_tirado = 0 then delete from pontos_movimentos where id = v_deb;
    else update pontos_movimentos set pontos = -v_tirado where id = v_deb; end if;
  end if;
  return v_tirado;
end $$;

-- ---------------- níveis ----------------
create or replace function public._calcular_niveis(p_mes date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_mes date := date_trunc('month', p_mes)::date;
  v_ini date := (date_trunc('month', p_mes) - interval '1 month')::date;
  v_fim date := (date_trunc('month', p_mes) - interval '1 day')::date;
  c jsonb := _clube_config();
  v_foco uuid[] := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(c -> 'produtos_foco') x), '{}');
  r record; v_dias_rota integer; v_dias_compra integer; v_semanas integer; v_mix integer; v_qtd numeric; v_vol numeric;
  m_rota boolean; m_mix boolean; m_qtd boolean; m_vol boolean; v_batidas integer; v_nivel text; v_n integer := 0;
begin
  for r in select id, rota_id from clientes where ativo and not _eh_cliente_generico(id) loop
    -- dias em que a rota do bairro passou no mês (agenda de visitas)
    select count(*) into v_dias_rota from generate_series(v_ini, v_fim, interval '1 day') d
     where extract(dow from d)::int in (select dia_semana from agenda_visitas where rota_id = r.rota_id);
    with ped as (
      select p.id, p.feito_em from pedidos p
       where p.cliente_id = r.id and p.origem = 'whatsapp' and p.pago_em is not null
         and p.status not in ('cancelado', 'recusado') and p.feito_em::date between v_ini and v_fim
    ), it as (
      select i.produto_id, (i.quantidade - i.devolvido) as q, coalesce(pr.litros, 0) as litros
        from pedido_itens i join ped on ped.id = i.pedido_id join produtos pr on pr.id = i.produto_id
       where i.troca_id is null
    )
    select (select count(distinct feito_em::date) from ped), (select count(distinct date_trunc('week', feito_em)) from ped),
           (select count(distinct produto_id) from it where produto_id = any (v_foco) and q > 0),
           (select coalesce(sum(q), 0) from it), (select coalesce(sum(q * litros), 0) from it)
      into v_dias_compra, v_semanas, v_mix, v_qtd, v_vol;
    m_rota := coalesce((c ->> 'meta_rota')::boolean, true)
              and (case when v_dias_rota > 0 then v_dias_compra >= v_dias_rota else v_semanas >= 4 end);
    m_mix := cardinality(v_foco) > 0 and v_mix >= greatest(1, (c ->> 'produtos_foco_minimo')::integer);
    m_qtd := (c ->> 'quantidade_minima')::numeric > 0 and v_qtd >= (c ->> 'quantidade_minima')::numeric;
    m_vol := (c ->> 'volume_minimo')::numeric > 0 and v_vol >= (c ->> 'volume_minimo')::numeric;
    v_batidas := m_rota::int + m_mix::int + m_qtd::int + m_vol::int;
    v_nivel := case when v_batidas >= (c ->> 'metas_ouro')::integer then 'ouro'
                    when v_batidas >= (c ->> 'metas_prata')::integer then 'prata' else 'bronze' end;
    insert into clube_niveis (cliente_id, mes, nivel, metas, calculado_em)
    values (r.id, v_mes, v_nivel, jsonb_build_object(
              'rota', m_rota, 'dias_rota', v_dias_rota, 'dias_compra', v_dias_compra,
              'produtos', m_mix, 'produtos_comprados', v_mix,
              'quantidade', m_qtd, 'quantidade_comprada', v_qtd,
              'volume', m_vol, 'litros', v_vol, 'batidas', v_batidas), now())
    on conflict (cliente_id, mes) do update set nivel = excluded.nivel, metas = excluded.metas, calculado_em = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public._nivel_cliente(p_cliente uuid, p_data date)
returns text language plpgsql security definer set search_path = public as $$
declare v_mes date := date_trunc('month', p_data)::date;
begin
  if not exists (select 1 from clube_niveis where mes = v_mes) then perform _calcular_niveis(v_mes); end if;
  return coalesce((select nivel from clube_niveis where cliente_id = p_cliente and mes = v_mes), 'bronze');
end $$;

create or replace function public._multiplicador(p_nivel text)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((_clube_config() -> 'multiplicadores' ->> p_nivel)::numeric, 1)
$$;

-- ---------------- desafios ----------------
create or replace function public._progresso_desafio(p_desafio uuid, p_cliente uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(i.quantidade - i.devolvido), 0)
    from desafios d
    join pedidos p on p.cliente_id = p_cliente and p.origem = 'whatsapp' and p.pago_em is not null
                  and p.status not in ('cancelado', 'recusado') and p.feito_em::date between d.inicio and d.fim
    join pedido_itens i on i.pedido_id = p.id and i.troca_id is null and i.produto_id = any (d.produtos)
   where d.id = p_desafio
$$;

create or replace function public._checar_desafios(p_cliente uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare d record; v_mov uuid; v_n integer := 0;
begin
  for d in select * from desafios x
            where x.ativo and not exists (select 1 from desafios_conquistas k where k.desafio_id = x.id and k.cliente_id = p_cliente) loop
    if _progresso_desafio(d.id, p_cliente) >= d.meta then
      v_mov := _creditar_pontos(p_cliente, d.bonus, 'desafio', 'Desafio cumprido: ' || d.titulo, null, d.id);
      insert into desafios_conquistas (desafio_id, cliente_id, pontos, movimento_id) values (d.id, p_cliente, d.bonus, v_mov);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- ---------------- pontos do pedido (quando é pago) ----------------
create or replace function public._pontos_do_pedido(p_pedido uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare p pedidos; v_pts integer; v_desc text;
begin
  select * into p from pedidos where id = p_pedido for update;
  if p.pago_em is null or p.origem <> 'whatsapp' or _eh_cliente_generico(p.cliente_id) then return 0; end if;
  v_pts := floor(coalesce(p.valor_pago, 0) * (_clube_config() ->> 'pontos_por_real')::numeric
                 * _multiplicador(_nivel_cliente(p.cliente_id, p.pago_em::date)))::integer;
  if v_pts > p.pontos_ganhos then
    perform _creditar_pontos(p.cliente_id, v_pts - p.pontos_ganhos, 'compra', 'Pedido nº ' || p.numero, p.id);
  elsif v_pts < p.pontos_ganhos then
    v_pts := p.pontos_ganhos - _estornar_pontos_pedido(p.id, p.pontos_ganhos - v_pts, 'Itens devolvidos do pedido nº ' || p.numero, true);
  end if;
  update pedidos set pontos_ganhos = v_pts where id = p.id;
  perform _checar_desafios(p.cliente_id);
  return v_pts;
end $$;

-- ---------------- recebimentos ----------------
create or replace function public.marcar_pago(p_pedido uuid, p_forma text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p pedidos; v_pts integer;
begin
  if not (tem_perm('financeiro') or tem_perm('pedidos_ver_todos')) then
    raise exception 'Sem permissão para receber pedidos.' using errcode = '42501';
  end if;
  if p_forma not in ('dinheiro', 'pix', 'cartao', 'boleto', 'outro') then raise exception 'Forma de pagamento inválida.'; end if;
  select * into p from pedidos where id = p_pedido for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if p.status in ('cancelado', 'recusado', 'aguardando_aprovacao') then raise exception 'Este pedido não pode ser recebido (%).', p.status; end if;
  if p.pago_em is not null then raise exception 'O pedido nº % já foi recebido.', p.numero; end if;
  update pedidos set pago_em = now(), pago_forma = p_forma, valor_pago = total - total_devolvido, recebido_por = auth.uid()
   where id = p_pedido;
  v_pts := _pontos_do_pedido(p_pedido);
  return jsonb_build_object('valor', p.total - p.total_devolvido, 'pontos', v_pts);
end $$;

create or replace function public.desfazer_pago(p_pedido uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p pedidos;
begin
  if not (tem_perm('financeiro') or tem_perm('pedidos_ver_todos')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  select * into p from pedidos where id = p_pedido for update;
  if p.pago_em is null then raise exception 'Este pedido não está recebido.'; end if;
  if p.pontos_ganhos > 0 then
    perform _estornar_pontos_pedido(p.id, p.pontos_ganhos, 'Recebimento desfeito do pedido nº ' || p.numero, false);
  end if;
  update pedidos set pago_em = null, pago_forma = null, valor_pago = null, recebido_por = null, pontos_ganhos = 0 where id = p_pedido;
end $$;

-- ---------------- devolução de itens de um pedido ----------------
create or replace function public._registrar_devolucao(p_item uuid, p_qtd numeric, p_carga uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare i pedido_itens; p pedidos; v_prod produtos; v_valor numeric;
begin
  select * into i from pedido_itens where id = p_item for update;
  if not found then raise exception 'Produto do pedido não encontrado.'; end if;
  select * into p from pedidos where id = i.pedido_id for update;
  select * into v_prod from produtos where id = i.produto_id;
  if p.status in ('cancelado', 'recusado', 'aguardando_aprovacao') then raise exception 'O pedido nº % não foi entregue (%).', p.numero, p.status; end if;
  if p_qtd is null or p_qtd <= 0 or not _quantidade_valida(v_prod, p_qtd) then raise exception 'Quantidade inválida para %: %', v_prod.nome, p_qtd; end if;
  if i.devolvido + p_qtd > i.quantidade then
    raise exception 'O pedido nº % só tem % de % (já voltaram %).', p.numero, i.quantidade, v_prod.nome, i.devolvido;
  end if;
  v_valor := round(i.preco_unit * p_qtd, 2);
  update pedido_itens set devolvido = devolvido + p_qtd where id = p_item;
  update pedidos set total_devolvido = total_devolvido + v_valor,
                     valor_pago = case when pago_em is not null then total - (total_devolvido + v_valor) end
   where id = p.id;
  perform _mover_estoque(i.produto_id, p_qtd, 'devolucao', p.id, p_carga, 'Voltou na entrega (pedido nº ' || p.numero || ')', i.preco_unit, 0);
  if p.pago_em is not null then perform _pontos_do_pedido(p.id); end if;
end $$;

create or replace function public.devolver_item(p_item uuid, p_qtd numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (tem_perm('financeiro') or tem_perm('pedidos_ver_todos') or tem_perm('conferencia')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  perform _registrar_devolucao(p_item, p_qtd, null);
end $$;

-- conferência: devolução escolhendo o cliente e o produto do pedido dele
create or replace function public.finalizar_conferencia(p_carga uuid, p_itens jsonb, p_observacao text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; r record; v_prod produtos; v_preco numeric; v_item pedido_itens; v_ped pedidos;
begin
  perform _exigir('conferencia');
  select status into v_status from cargas where id = p_carga for update;
  if not found then raise exception 'Carga não encontrada.'; end if;
  if v_status <> 'saiu' then raise exception 'Só dá para conferir carga que saiu e ainda não foi conferida.'; end if;

  insert into conferencias (carga_id, usuario_id, observacao)
  values (p_carga, auth.uid(), nullif(trim(p_observacao), ''));

  for r in
    select e->>'tipo' as tipo,
           nullif(e->>'pedido_item_id', '')::uuid as item_id,
           nullif(e->>'produto_id', '')::uuid as produto_id,
           nullif(e->>'vasilhame_id', '')::uuid as vasilhame_id,
           (e->>'quantidade')::numeric as qtd
      from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
     order by e->>'produto_id'
  loop
    if r.qtd is null or r.qtd <= 0 then continue; end if;
    -- devolução de um cliente: tira do pedido dele (o valor e os pontos acompanham)
    if r.tipo = 'devolvido' and r.item_id is not null then
      select * into v_item from pedido_itens where id = r.item_id;
      if not found then raise exception 'Produto do pedido não encontrado.'; end if;
      select * into v_ped from pedidos where id = v_item.pedido_id;
      if v_ped.carga_id is distinct from p_carga then raise exception 'O pedido nº % não é desta carga.', v_ped.numero; end if;
      perform _registrar_devolucao(r.item_id, r.qtd, p_carga);
      insert into conferencia_itens (carga_id, tipo, produto_id, quantidade, pedido_id)
      values (p_carga, 'devolvido', v_item.produto_id, r.qtd, v_item.pedido_id);
      continue;
    end if;
    if r.tipo in ('devolvido', 'troca') then
      select * into v_prod from produtos where id = r.produto_id;
      if not found then raise exception 'Produto não encontrado na conferência.'; end if;
      if not _quantidade_valida(v_prod, r.qtd) then
        raise exception 'Quantidade inválida para %: %', v_prod.nome, r.qtd;
      end if;
    end if;
    insert into conferencia_itens (carga_id, tipo, produto_id, vasilhame_id, quantidade)
    values (p_carga, r.tipo, case when r.tipo = 'vasilhame' then null else r.produto_id end,
            case when r.tipo = 'vasilhame' then r.vasilhame_id end, r.qtd);
    if r.tipo = 'devolvido' then
      -- valor da devolução: preço médio que esse produto foi vendido nesta carga
      select coalesce(sum(i.total) / nullif(sum(i.quantidade), 0), v_prod.preco) into v_preco
        from pedido_itens i join pedidos p on p.id = i.pedido_id
       where p.carga_id = p_carga and i.produto_id = r.produto_id;
      perform _mover_estoque(r.produto_id, r.qtd, 'devolucao', null, p_carga, 'Voltou na conferência', round(v_preco, 2), 0);
    end if;
  end loop;

  update pedidos set status = 'entregue' where carga_id = p_carga and status = 'carregado';
  update cargas set status = 'conferida' where id = p_carga;
end $$;



-- ---------------- trocas (prêmios) ----------------
create or replace function public.trocar_pontos(p_cliente uuid, p_premio uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare pr premios; v_prod produtos; v_troca uuid; v_deb uuid;
begin
  if not (tem_perm('pedidos_ver_todos') or tem_perm('clientes')) then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into pr from premios where id = p_premio and ativo;
  if not found then raise exception 'Prêmio não encontrado ou desligado.'; end if;
  select * into v_prod from produtos where id = pr.produto_id;
  insert into trocas_pontos (cliente_id, premio_id, produto_id, quantidade, pontos)
  values (p_cliente, pr.id, pr.produto_id, pr.quantidade, pr.pontos) returning id into v_troca;
  v_deb := _debitar_pontos(p_cliente, pr.pontos, 'troca', 'Troca: ' || v_prod.nome, v_troca);
  update trocas_pontos set debito_id = v_deb where id = v_troca;
  return v_troca;
end $$;

create or replace function public.cancelar_troca(p_troca uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t trocas_pontos;
begin
  if not (tem_perm('pedidos_ver_todos') or tem_perm('clientes')) then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into t from trocas_pontos where id = p_troca for update;
  if not found then raise exception 'Troca não encontrada.'; end if;
  if t.status <> 'pendente' then raise exception 'Só dá para cancelar troca que ainda não foi para um pedido.'; end if;
  perform _devolver_debito(t.debito_id, 'troca_cancelada', 'Troca cancelada: pontos devolvidos');
  update trocas_pontos set status = 'cancelada' where id = p_troca;
end $$;

-- ajuste manual (administrador): dar ou tirar pontos com motivo
create or replace function public.ajustar_pontos(p_cliente uuid, p_pontos integer, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not eh_admin() then raise exception 'Só o administrador ajusta pontos.' using errcode = '42501'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escreva o motivo do ajuste.'; end if;
  if p_pontos > 0 then perform _creditar_pontos(p_cliente, p_pontos, 'ajuste', 'Ajuste: ' || trim(p_motivo));
  elsif p_pontos < 0 then perform _debitar_pontos(p_cliente, -p_pontos, 'ajuste', 'Ajuste: ' || trim(p_motivo));
  end if;
end $$;

-- pedido cancelado ou prêmio tirado do pedido: a troca volta a esperar o próximo pedido
create or replace function public._trocas_seguem_pedido()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('cancelado', 'recusado') and old.status not in ('cancelado', 'recusado') then
    update trocas_pontos set status = 'pendente', pedido_id = null where pedido_id = new.id and status = 'no_pedido';
  elsif new.status = 'entregue' and old.status <> 'entregue' then
    update trocas_pontos set status = 'entregue' where pedido_id = new.id and status = 'no_pedido';
  end if;
  return new;
end $$;
drop trigger if exists trocas_seguem_pedido on public.pedidos;
create trigger trocas_seguem_pedido after update of status on public.pedidos
  for each row execute function public._trocas_seguem_pedido();

create or replace function public._premio_tirado_do_pedido()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.troca_id is not null then
    update trocas_pontos set status = 'pendente', pedido_id = null where id = old.troca_id and status = 'no_pedido';
  end if;
  return old;
end $$;
drop trigger if exists premio_tirado_do_pedido on public.pedido_itens;
create trigger premio_tirado_do_pedido after delete on public.pedido_itens
  for each row execute function public._premio_tirado_do_pedido();

-- ---------------- o pedido leva os prêmios trocados ----------------
create or replace function public.criar_pedido(
  p_client_id uuid, p_cliente_id uuid, p_itens jsonb,
  p_observacao text default null, p_feito_em timestamptz default null,
  p_vendedor_id uuid default null, p_entrega text default 'caminhao')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_perfil   perfis;
  v_pedido   pedidos;
  v_prod     produtos;
  v_item     record;
  v_faltas   jsonb := '[]'::jsonb;
  v_aprovar  boolean := false;
  v_unit     numeric;
  v_total    numeric := 0;
  v_peso     numeric := 0;
  v_vendedor uuid;
  v_dono     uuid;     -- vendedor dono do cliente
  v_escritorio boolean;
  v_rota     uuid;
  v_troca    record;
begin
  select * into v_perfil from perfis where id = auth.uid() and ativo;
  if not found or not (v_perfil.admin or 'pedidos_criar' = any (v_perfil.permissoes)
                       or 'pedidos_ver_todos' = any (v_perfil.permissoes)) then
    raise exception 'Você não tem permissão para fazer pedidos.' using errcode = '42501';
  end if;

  -- Já recebido antes (reenvio do celular)? Devolve o mesmo pedido.
  if p_client_id is not null then
    select * into v_pedido from pedidos where client_id = p_client_id;
    if found then
      return jsonb_build_object('id', v_pedido.id, 'numero', v_pedido.numero, 'status', v_pedido.status, 'duplicado', true);
    end if;
  end if;

  select vendedor_id, rota_id into v_dono, v_rota from clientes where id = p_cliente_id and ativo;
  if not found then
    raise exception 'Cliente não encontrado ou inativo.';
  end if;

  -- Cada cliente é de um vendedor. O vendedor só faz pedido para os clientes dele.
  -- Administrador: a venda é de quem fez (ele mesmo), para qualquer cliente;
  --   pode escolher creditar ao dono do cliente (p_vendedor_id).
  -- Escritório sem ser administrador: lança no nome do dono do cliente.
  v_escritorio := v_perfil.admin or 'pedidos_ver_todos' = any (v_perfil.permissoes);
  v_vendedor := coalesce(p_vendedor_id,
                         case when v_perfil.admin then v_perfil.id
                              when v_escritorio and v_dono is not null then v_dono
                              else v_perfil.id end);
  if v_vendedor <> v_perfil.id and not v_escritorio then
    raise exception 'Você só pode lançar pedidos no seu próprio nome.' using errcode = '42501';
  end if;
  if v_vendedor <> v_perfil.id and not exists (select 1 from perfis where id = v_vendedor and ativo) then
    raise exception 'Vendedor não encontrado ou inativo.';
  end if;
  -- bairro/rota compartilhado: quem tem a rota na agenda (ou é o responsável) vende para todos os clientes dela
  if v_rota is not null and v_rota = any (rotas_do_vendedor(v_vendedor)) then
    v_dono := v_vendedor;
  end if;
  if v_dono is null and not v_escritorio then
    raise exception 'Este cliente ainda não tem vendedor. Peça ao escritório para colocar o cliente na sua carteira.' using errcode = '42501';
  end if;
  -- administrador pode tudo: qualquer cliente, qualquer vendedor
  if v_dono is not null and v_vendedor <> v_dono and not v_perfil.admin then
    raise exception 'Este cliente é do vendedor %. Só ele pode ter pedidos para este cliente.',
      (select nome from perfis where id = v_dono) using errcode = '42501';
  end if;
  if coalesce(p_entrega, 'caminhao') not in ('caminhao', 'moto', 'balcao') then
    raise exception 'Tipo de entrega inválido.';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'O pedido não tem itens.';
  end if;
  if (select count(*) <> count(distinct e->>'produto_id') from jsonb_array_elements(p_itens) e) then
    raise exception 'Há produto repetido no pedido.';
  end if;

  -- Trava os produtos (ordem fixa, evita deadlock) e valida tudo antes de gravar
  perform 1 from produtos
   where id in (select (e->>'produto_id')::uuid from jsonb_array_elements(p_itens) e)
   order by id for update;

  for v_item in
    select (e->>'produto_id')::uuid as produto_id,
           (e->>'quantidade')::numeric as qtd,
           coalesce((e->>'desconto_pct')::numeric, 0) as desconto,
           nullif(e->>'preco_unit', '')::numeric as preco_inf
      from jsonb_array_elements(p_itens) e
  loop
    select * into v_prod from produtos where id = v_item.produto_id;
    if not found or not v_prod.ativo then
      raise exception 'Produto não encontrado ou inativo.';
    end if;
    if not _quantidade_valida(v_prod, v_item.qtd) then
      raise exception 'Quantidade inválida para %: %', v_prod.nome, v_item.qtd;
    end if;
    if v_item.desconto < 0 or v_item.desconto > 100 then
      raise exception 'Desconto inválido para %.', v_prod.nome;
    end if;
    if v_item.preco_inf is not null and v_item.preco_inf <= 0 then
      raise exception 'Preço inválido para %.', v_prod.nome;
    end if;
    -- preço digitado pelo vendedor (ou, em versões antigas do app, a % de desconto)
    v_unit := coalesce(round(v_item.preco_inf, 2), round(v_prod.preco * (1 - v_item.desconto / 100), 2));
    -- vendedor não dá desconto: qualquer mudança no preço espera aprovação
    if v_unit <> v_prod.preco and not v_perfil.admin then
      v_aprovar := true;
    end if;
    -- sem estoque: o vendedor pode vender, mas espera aprovação; o administrador é avisado
    if v_prod.estoque < v_item.qtd and not v_perfil.admin then
      v_aprovar := true;
    elsif v_prod.estoque < v_item.qtd then
      v_faltas := v_faltas || jsonb_build_object(
        'produto_id', v_prod.id, 'produto', v_prod.nome,
        'pedido', v_item.qtd, 'disponivel', greatest(v_prod.estoque, 0));
    end if;
  end loop;

  if jsonb_array_length(v_faltas) > 0 then
    raise exception 'ESTOQUE_INSUFICIENTE' using detail = v_faltas::text;
  end if;

  insert into pedidos (client_id, cliente_id, vendedor_id, status, observacao, feito_em, entrega, entregue_em)
  values (p_client_id, p_cliente_id, v_vendedor,
          case when v_aprovar then 'aguardando_aprovacao' when p_entrega = 'balcao' then 'entregue' else 'liberado' end,
          nullif(trim(p_observacao), ''), coalesce(p_feito_em, now()), coalesce(p_entrega, 'caminhao'),
          case when not v_aprovar and p_entrega = 'balcao' then now() end)
  returning * into v_pedido;

  for v_item in
    select (e->>'produto_id')::uuid as produto_id,
           (e->>'quantidade')::numeric as qtd,
           coalesce((e->>'desconto_pct')::numeric, 0) as desconto,
           nullif(e->>'preco_unit', '')::numeric as preco_inf
      from jsonb_array_elements(p_itens) e
  loop
    select * into v_prod from produtos where id = v_item.produto_id;
    v_unit := coalesce(round(v_item.preco_inf, 2), round(v_prod.preco * (1 - v_item.desconto / 100), 2));
    insert into pedido_itens (pedido_id, produto_id, quantidade, preco_tabela, desconto_pct, preco_unit, total, peso_kg, custo_unit, precisa_aprovacao, motivo_aprovacao)
    values (v_pedido.id, v_prod.id, v_item.qtd, v_prod.preco,
            case when v_prod.preco > 0 then least(100, greatest(0, round((v_prod.preco - v_unit) / v_prod.preco * 100, 2))) else 0 end,
            v_unit, round(v_unit * v_item.qtd, 2), v_prod.peso_kg * v_item.qtd, v_prod.custo,
            not v_perfil.admin and (v_unit <> v_prod.preco or v_prod.estoque < v_item.qtd),
            case when v_perfil.admin then null
                 else nullif(concat_ws(' e ', case when v_unit <> v_prod.preco then 'preço mudado' end,
                                              case when v_prod.estoque < v_item.qtd then 'sem estoque' end), '') end);
    v_total := v_total + round(v_unit * v_item.qtd, 2);
    v_peso  := v_peso + v_prod.peso_kg * v_item.qtd;
    perform _mover_estoque(v_prod.id, -v_item.qtd, 'venda', v_pedido.id, null, null,
                           v_prod.preco, greatest(0, round((v_prod.preco - v_unit) * v_item.qtd, 2)));
  end loop;

  -- prêmios trocados com pontos vão de graça neste pedido (sem estoque: ficam para o próximo)
  for v_troca in select t.* from trocas_pontos t where t.cliente_id = p_cliente_id and t.status = 'pendente' order by t.criado_em for update loop
    select * into v_prod from produtos where id = v_troca.produto_id for update;
    if not found or v_prod.estoque < v_troca.quantidade then continue; end if;
    insert into pedido_itens (pedido_id, produto_id, quantidade, preco_tabela, desconto_pct, preco_unit, total, peso_kg, custo_unit, troca_id)
    values (v_pedido.id, v_prod.id, v_troca.quantidade, v_prod.preco, 100, 0, 0, v_prod.peso_kg * v_troca.quantidade, v_prod.custo, v_troca.id);
    v_peso := v_peso + v_prod.peso_kg * v_troca.quantidade;
    perform _mover_estoque(v_prod.id, -v_troca.quantidade, 'venda', v_pedido.id, null, 'Prêmio do clube de pontos',
                           v_prod.preco, round(v_prod.preco * v_troca.quantidade, 2));
    update trocas_pontos set status = 'no_pedido', pedido_id = v_pedido.id where id = v_troca.id;
  end loop;

  update pedidos set total = v_total, peso_kg = v_peso where id = v_pedido.id;

  return jsonb_build_object('id', v_pedido.id, 'numero', v_pedido.numero, 'status', v_pedido.status, 'duplicado', false);
end $$;


-- ---------------- telas do clube (leitura) ----------------
create or replace function public.clube_clientes()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_mes date := date_trunc('month', current_date)::date;
begin
  if not (tem_perm('pedidos_ver_todos') or tem_perm('clientes') or tem_perm('financeiro')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  perform _vencer_pontos(null);
  if not exists (select 1 from clube_niveis where mes = v_mes) then perform _calcular_niveis(v_mes); end if;
  return coalesce((select jsonb_agg(x order by x.saldo desc, x.nome) from (
    select c.id, c.codigo, coalesce(nullif(c.nome_fantasia, ''), c.razao_social) as nome, c.whatsapp,
           coalesce(n.nivel, 'bronze') as nivel, n.metas,
           coalesce((select sum(restante) from pontos_movimentos m where m.cliente_id = c.id and m.restante > 0), 0) as saldo,
           coalesce((select sum(restante) from pontos_movimentos m where m.cliente_id = c.id and m.restante > 0 and m.vence_em <= current_date + 30), 0) as a_vencer_30,
           (select min(vence_em) from pontos_movimentos m where m.cliente_id = c.id and m.restante > 0) as proximo_vencimento,
           (select count(*) from trocas_pontos t where t.cliente_id = c.id and t.status in ('pendente', 'no_pedido')) as trocas_abertas,
           (select max(criado_em) from pontos_movimentos m where m.cliente_id = c.id) as ultimo_movimento
      from clientes c left join clube_niveis n on n.cliente_id = c.id and n.mes = v_mes
     where c.ativo and not _eh_cliente_generico(c.id)
       and (c.whatsapp is not null or exists (select 1 from pontos_movimentos m where m.cliente_id = c.id))) x), '[]'::jsonb);
end $$;

create or replace function public.extrato_pontos(p_cliente uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (tem_perm('pedidos_ver_todos') or tem_perm('clientes') or tem_perm('financeiro')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'saldo', _saldo_pontos(p_cliente),
    'nivel', _nivel_cliente(p_cliente, current_date),
    'multiplicador', _multiplicador(_nivel_cliente(p_cliente, current_date)),
    'movimentos', coalesce((select jsonb_agg(x order by x.criado_em desc) from (
        select m.id, m.tipo, m.pontos, m.restante, m.vence_em, m.descricao, m.criado_em, p.numero as pedido
          from pontos_movimentos m left join pedidos p on p.id = m.pedido_id
         where m.cliente_id = p_cliente order by m.criado_em desc limit 200) x), '[]'::jsonb),
    'lotes', coalesce((select jsonb_agg(x order by x.vence_em) from (
        select vence_em, sum(restante) as pontos from pontos_movimentos
         where cliente_id = p_cliente and restante > 0 group by vence_em) x), '[]'::jsonb),
    'trocas', coalesce((select jsonb_agg(x order by x.criado_em desc) from (
        select t.id, t.status, t.pontos, t.quantidade, t.criado_em, pr.nome as produto, p.numero as pedido
          from trocas_pontos t join produtos pr on pr.id = t.produto_id left join pedidos p on p.id = t.pedido_id
         where t.cliente_id = p_cliente and t.status <> 'cancelada' order by t.criado_em desc limit 50) x), '[]'::jsonb),
    'desafios', coalesce((select jsonb_agg(x order by x.fim) from (
        select d.id, d.titulo, d.meta, d.bonus, d.inicio, d.fim, _progresso_desafio(d.id, p_cliente) as progresso,
               exists (select 1 from desafios_conquistas k where k.desafio_id = d.id and k.cliente_id = p_cliente) as cumprido
          from desafios d where d.ativo and d.fim >= current_date - 30) x), '[]'::jsonb)
  );
end $$;

create or replace function public.calcular_niveis(p_mes date default current_date)
returns integer language plpgsql security definer set search_path = public as $$
begin
  if not eh_admin() then raise exception 'Só o administrador recalcula os níveis.' using errcode = '42501'; end if;
  return _calcular_niveis(p_mes);
end $$;

create or replace function public.progresso_desafio(p_desafio uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (tem_perm('pedidos_ver_todos') or tem_perm('clientes')) then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x.progresso desc) from (
    select c.id, coalesce(nullif(c.nome_fantasia, ''), c.razao_social) as nome, _progresso_desafio(p_desafio, c.id) as progresso,
           exists (select 1 from desafios_conquistas k where k.desafio_id = p_desafio and k.cliente_id = c.id) as cumprido
      from clientes c where c.ativo and not _eh_cliente_generico(c.id)) x where x.progresso > 0), '[]'::jsonb);
end $$;

-- ---------------- permissões das funções ----------------
do $$
declare f text;
begin
  -- internas: só as próprias funções usam
  foreach f in array array[
    '_clube_config()', '_eh_cliente_generico(uuid)', '_vencer_pontos(uuid)', '_saldo_pontos(uuid)',
    '_creditar_pontos(uuid, integer, text, text, uuid, uuid)', '_debitar_pontos(uuid, integer, text, text, uuid, uuid, boolean)',
    '_devolver_debito(uuid, text, text)', '_estornar_pontos_pedido(uuid, integer, text, boolean)',
    '_calcular_niveis(date)', '_nivel_cliente(uuid, date)', '_multiplicador(text)', '_progresso_desafio(uuid, uuid)',
    '_checar_desafios(uuid)', '_pontos_do_pedido(uuid)', '_registrar_devolucao(uuid, numeric, uuid)',
    '_trocas_seguem_pedido()', '_premio_tirado_do_pedido()', '_normalizar_whatsapp()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'marcar_pago(uuid, text)', 'desfazer_pago(uuid)', 'devolver_item(uuid, numeric)', 'trocar_pontos(uuid, uuid)',
    'cancelar_troca(uuid)', 'ajustar_pontos(uuid, integer, text)', 'clube_clientes()', 'extrato_pontos(uuid)',
    'calcular_niveis(date)', 'progresso_desafio(uuid)', 'finalizar_conferencia(uuid, jsonb, text)',
    'criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid, text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

create or replace function public.versao_banco() returns integer language sql stable as $$ select 28 $$;
