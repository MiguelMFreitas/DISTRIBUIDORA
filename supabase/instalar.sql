-- =====================================================================
-- INSTALAÇÃO COMPLETA DO BANCO (cole tudo no SQL Editor do Supabase e clique em Run)
-- Gerado a partir de supabase/migrations/. Rode só uma vez, num projeto novo.
-- =====================================================================

-- >>> 20261108000001_schema.sql
-- =====================================================================
-- Sistema da Distribuidora: schema principal
-- Cadastros, pedidos, estoque, cargas (romaneio) e conferência.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Usuários (perfil ligado ao login do Supabase)
-- ---------------------------------------------------------------------
create table public.perfis (
  id            uuid primary key references auth.users (id) on delete cascade,
  nome          text not null,
  usuario       text not null unique,
  admin         boolean not null default false,
  permissoes    text[] not null default '{}',
  desconto_max  numeric(5,2) not null default 0 check (desconto_max between 0 and 100),
  telefone      text,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);

comment on column public.perfis.permissoes is
  'pedidos_criar, pedidos_ver_todos, clientes, produtos, estoque, cargas, conferencia, cadastros';

-- ---------------------------------------------------------------------
-- Cadastros auxiliares
-- ---------------------------------------------------------------------
create table public.rotas (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null unique,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

create table public.motoristas (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  telefone  text,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

create table public.veiculos (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,             -- ex.: "Caminhão 01", "VW Delivery"
  placa          text,
  capacidade_kg  numeric(10,1),
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now()
);

-- Categorias: a ORDEM define a ordem de carregamento no romaneio
create table public.categorias (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null unique,
  ordem     integer not null default 0,
  criado_em timestamptz not null default now()
);

-- Tipos de vasilhame (casco) que voltam vazios
create table public.vasilhames (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null unique,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Produtos
-- unidade: CX (caixa), FD (fardo), LT (litro), UN (unidade)
-- permite_meia: aceita meia caixa / meio fardo (quantidade em 0,5)
-- vasilhame_id + vasilhames_por_unidade: quantos cascos devem voltar
-- ---------------------------------------------------------------------
create table public.produtos (
  id                      uuid primary key default gen_random_uuid(),
  codigo                  text unique,
  nome                    text not null,
  categoria_id            uuid references public.categorias (id) on delete set null,
  unidade                 text not null default 'CX' check (unidade in ('CX','FD','LT','UN')),
  permite_meia            boolean not null default false,
  preco                   numeric(12,2) not null default 0 check (preco >= 0),
  peso_kg                 numeric(10,3) not null default 0 check (peso_kg >= 0),
  estoque                 numeric(12,1) not null default 0,
  estoque_minimo          numeric(12,1) not null default 0,
  vasilhame_id            uuid references public.vasilhames (id) on delete set null,
  vasilhames_por_unidade  numeric(8,2) not null default 1,
  ativo                   boolean not null default true,
  criado_em               timestamptz not null default now()
);
create index on public.produtos (categoria_id);

-- ---------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------
create table public.clientes (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text unique,
  razao_social        text not null,
  nome_fantasia       text,
  cpf_cnpj            text,
  inscricao_estadual  text,
  endereco            text,
  numero              text,
  bairro              text,
  cidade              text,
  cep                 text,
  referencia          text,
  telefone            text,
  telefone2           text,
  rota_id             uuid references public.rotas (id) on delete set null,
  vendedor_id         uuid references public.perfis (id) on delete set null,
  observacao          text,
  ativo               boolean not null default true,
  criado_em           timestamptz not null default now()
);
create index on public.clientes (rota_id);
create index on public.clientes (vendedor_id);

-- ---------------------------------------------------------------------
-- Cargas (um veículo saindo num turno) = base do romaneio
-- status: montando -> saiu -> conferida
-- ---------------------------------------------------------------------
create table public.cargas (
  id            uuid primary key default gen_random_uuid(),
  numero        bigint generated always as identity unique,
  data          date not null default current_date,
  turno         text not null default 'manha' check (turno in ('manha','tarde')),
  veiculo_id    uuid references public.veiculos (id) on delete set null,
  motorista_id  uuid references public.motoristas (id) on delete set null,
  status        text not null default 'montando' check (status in ('montando','saiu','conferida')),
  observacao    text,
  criado_por    uuid references public.perfis (id) on delete set null,
  criado_em     timestamptz not null default now(),
  saiu_em       timestamptz
);
create index on public.cargas (data);

-- ---------------------------------------------------------------------
-- Pedidos
-- status:
--   aguardando_aprovacao  desconto acima do limite do vendedor
--   liberado              pronto para entrar numa carga
--   carregado             a carga saiu
--   entregue              carga conferida
--   cancelado / recusado
-- client_id: gerado no celular, evita pedido duplicado no envio offline
-- ---------------------------------------------------------------------
create table public.pedidos (
  id             uuid primary key default gen_random_uuid(),
  numero         bigint generated always as identity unique,
  client_id      uuid unique,
  cliente_id     uuid not null references public.clientes (id),
  vendedor_id    uuid references public.perfis (id) on delete set null,
  status         text not null default 'liberado'
                 check (status in ('aguardando_aprovacao','liberado','carregado','entregue','cancelado','recusado')),
  carga_id       uuid references public.cargas (id) on delete set null,
  total          numeric(12,2) not null default 0,
  peso_kg        numeric(12,3) not null default 0,
  observacao     text,
  feito_em       timestamptz not null default now(),   -- hora em que o vendedor fez (pode ser offline)
  criado_em      timestamptz not null default now(),   -- hora em que chegou no sistema
  aprovado_por   uuid references public.perfis (id) on delete set null,
  aprovado_em    timestamptz,
  impresso_em    timestamptz
);
create index on public.pedidos (status);
create index on public.pedidos (carga_id);
create index on public.pedidos (vendedor_id, criado_em);
create index on public.pedidos (cliente_id);

create table public.pedido_itens (
  id            uuid primary key default gen_random_uuid(),
  pedido_id     uuid not null references public.pedidos (id) on delete cascade,
  produto_id    uuid not null references public.produtos (id),
  quantidade    numeric(12,1) not null check (quantidade > 0),
  preco_tabela  numeric(12,2) not null,
  desconto_pct  numeric(5,2) not null default 0 check (desconto_pct between 0 and 100),
  preco_unit    numeric(12,2) not null,
  total         numeric(12,2) not null,
  peso_kg       numeric(12,3) not null default 0
);
create index on public.pedido_itens (pedido_id);
create index on public.pedido_itens (produto_id);

-- ---------------------------------------------------------------------
-- Estoque: todo movimento fica registrado
-- quantidade positiva = entrou, negativa = saiu
-- ---------------------------------------------------------------------
create table public.estoque_movimentos (
  id           uuid primary key default gen_random_uuid(),
  produto_id   uuid not null references public.produtos (id) on delete cascade,
  tipo         text not null check (tipo in ('entrada','venda','cancelamento','devolucao','ajuste')),
  quantidade   numeric(12,1) not null,
  saldo        numeric(12,1) not null,
  pedido_id    uuid references public.pedidos (id) on delete set null,
  carga_id     uuid references public.cargas (id) on delete set null,
  usuario_id   uuid references public.perfis (id) on delete set null,
  observacao   text,
  criado_em    timestamptz not null default now()
);
create index on public.estoque_movimentos (produto_id, criado_em desc);

-- ---------------------------------------------------------------------
-- Conferência de retorno da carga
-- tipo: vasilhame (casco vazio), devolvido (voltou cheio, volta ao estoque),
--       troca (avaria)
-- ---------------------------------------------------------------------
create table public.conferencias (
  carga_id       uuid primary key references public.cargas (id) on delete cascade,
  usuario_id     uuid references public.perfis (id) on delete set null,
  observacao     text,
  finalizada_em  timestamptz not null default now()
);

create table public.conferencia_itens (
  id            uuid primary key default gen_random_uuid(),
  carga_id      uuid not null references public.conferencias (carga_id) on delete cascade,
  tipo          text not null check (tipo in ('vasilhame','devolvido','troca')),
  produto_id    uuid references public.produtos (id),
  vasilhame_id  uuid references public.vasilhames (id),
  quantidade    numeric(12,1) not null check (quantidade > 0),
  check ((tipo = 'vasilhame') = (vasilhame_id is not null)),
  check ((tipo = 'vasilhame') = (produto_id is null))
);
create index on public.conferencia_itens (carga_id);

-- >>> 20261108000002_seguranca_e_funcoes.sql
-- =====================================================================
-- Permissões (RLS) e regras de negócio
-- Tudo que mexe em estoque, pedido, carga ou conferência passa por uma
-- função aqui, dentro de uma transação. O navegador nunca altera estoque
-- direto.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ajudantes de permissão
-- ---------------------------------------------------------------------
create or replace function public.eh_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select admin and ativo from perfis where id = auth.uid()), false)
$$;

create or replace function public.tem_perm(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select ativo and (admin or p = any(permissoes)) from perfis where id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.perfis              enable row level security;
alter table public.rotas               enable row level security;
alter table public.motoristas          enable row level security;
alter table public.veiculos            enable row level security;
alter table public.categorias          enable row level security;
alter table public.vasilhames          enable row level security;
alter table public.produtos            enable row level security;
alter table public.clientes            enable row level security;
alter table public.cargas              enable row level security;
alter table public.pedidos             enable row level security;
alter table public.pedido_itens        enable row level security;
alter table public.estoque_movimentos  enable row level security;
alter table public.conferencias        enable row level security;
alter table public.conferencia_itens   enable row level security;

-- Visitante sem login não vê nada
revoke all on all tables in schema public from anon;

-- Perfis: todos logados leem (nomes dos vendedores); só o servidor (admin) grava
create policy perfis_ler on public.perfis for select to authenticated using (true);
revoke insert, update, delete on public.perfis from authenticated;

-- Cadastros simples
create policy rotas_ler      on public.rotas      for select to authenticated using (true);
create policy rotas_gravar   on public.rotas      for all    to authenticated using (tem_perm('cadastros')) with check (tem_perm('cadastros'));
create policy motoristas_ler    on public.motoristas for select to authenticated using (true);
create policy motoristas_gravar on public.motoristas for all    to authenticated using (tem_perm('cadastros')) with check (tem_perm('cadastros'));
create policy veiculos_ler    on public.veiculos for select to authenticated using (true);
create policy veiculos_gravar on public.veiculos for all    to authenticated using (tem_perm('cadastros')) with check (tem_perm('cadastros'));

create policy categorias_ler    on public.categorias for select to authenticated using (true);
create policy categorias_gravar on public.categorias for all    to authenticated using (tem_perm('produtos')) with check (tem_perm('produtos'));
create policy vasilhames_ler    on public.vasilhames for select to authenticated using (true);
create policy vasilhames_gravar on public.vasilhames for all    to authenticated using (tem_perm('produtos')) with check (tem_perm('produtos'));

-- Produtos: o estoque só muda pelas funções
create policy produtos_ler    on public.produtos for select to authenticated using (true);
create policy produtos_gravar on public.produtos for all    to authenticated using (tem_perm('produtos')) with check (tem_perm('produtos'));
revoke insert, update on public.produtos from authenticated;
grant insert (codigo, nome, categoria_id, unidade, permite_meia, preco, peso_kg, estoque_minimo,
              vasilhame_id, vasilhames_por_unidade, ativo) on public.produtos to authenticated;
grant update (codigo, nome, categoria_id, unidade, permite_meia, preco, peso_kg, estoque_minimo,
              vasilhame_id, vasilhames_por_unidade, ativo) on public.produtos to authenticated;

create policy clientes_ler    on public.clientes for select to authenticated using (true);
create policy clientes_gravar on public.clientes for all    to authenticated using (tem_perm('clientes')) with check (tem_perm('clientes'));

-- Cargas: dados básicos editáveis enquanto monta; status só pelas funções
create policy cargas_ler on public.cargas for select to authenticated
  using (tem_perm('cargas') or tem_perm('conferencia') or tem_perm('pedidos_ver_todos'));
create policy cargas_criar on public.cargas for insert to authenticated with check (tem_perm('cargas'));
create policy cargas_editar on public.cargas for update to authenticated
  using (tem_perm('cargas') and status = 'montando') with check (tem_perm('cargas') and status = 'montando');
create policy cargas_apagar on public.cargas for delete to authenticated
  using (tem_perm('cargas') and status = 'montando');
revoke insert, update on public.cargas from authenticated;
grant insert (data, turno, veiculo_id, motorista_id, observacao) on public.cargas to authenticated;
grant update (data, turno, veiculo_id, motorista_id, observacao) on public.cargas to authenticated;

-- Pedidos: vendedor vê os seus; escritório vê todos. Gravação só por função.
create policy pedidos_ler on public.pedidos for select to authenticated
  using (vendedor_id = auth.uid() or tem_perm('pedidos_ver_todos') or tem_perm('cargas') or tem_perm('conferencia'));
create policy pedido_itens_ler on public.pedido_itens for select to authenticated
  using (exists (select 1 from public.pedidos p where p.id = pedido_id));
revoke insert, update, delete on public.pedidos, public.pedido_itens from authenticated;

create policy movimentos_ler on public.estoque_movimentos for select to authenticated using (tem_perm('estoque'));
revoke insert, update, delete on public.estoque_movimentos from authenticated;

create policy conferencias_ler on public.conferencias for select to authenticated
  using (tem_perm('conferencia') or tem_perm('cargas'));
create policy conferencia_itens_ler on public.conferencia_itens for select to authenticated
  using (tem_perm('conferencia') or tem_perm('cargas'));
revoke insert, update, delete on public.conferencias, public.conferencia_itens from authenticated;

-- ---------------------------------------------------------------------
-- Ajudantes internos
-- ---------------------------------------------------------------------
create or replace function public._exigir(p text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not tem_perm(p) then
    raise exception 'Você não tem permissão para isso (%).', p using errcode = '42501';
  end if;
end $$;

create or replace function public._quantidade_valida(p_prod public.produtos, p_qtd numeric)
returns boolean language sql immutable as $$
  select p_qtd > 0 and case when p_prod.permite_meia then (p_qtd * 2) = trunc(p_qtd * 2)
                            else p_qtd = trunc(p_qtd) end
$$;

create or replace function public._mover_estoque(
  p_produto uuid, p_qtd numeric, p_tipo text,
  p_pedido uuid default null, p_carga uuid default null, p_obs text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_saldo numeric;
begin
  update produtos set estoque = estoque + p_qtd where id = p_produto returning estoque into v_saldo;
  insert into estoque_movimentos (produto_id, tipo, quantidade, saldo, pedido_id, carga_id, usuario_id, observacao)
  values (p_produto, p_tipo, p_qtd, v_saldo, p_pedido, p_carga, auth.uid(), p_obs);
  return v_saldo;
end $$;

create or replace function public._devolver_estoque_pedido(p_pedido uuid, p_tipo text, p_obs text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select produto_id, quantidade from pedido_itens where pedido_id = p_pedido order by produto_id loop
    perform _mover_estoque(r.produto_id, r.quantidade, p_tipo, p_pedido, null, p_obs);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- PEDIDOS
-- p_itens: [{"produto_id": "...", "quantidade": 2.5, "desconto_pct": 3}]
-- Se faltar estoque, nada é gravado e o erro traz a lista do que faltou.
-- ---------------------------------------------------------------------
create or replace function public.criar_pedido(
  p_client_id uuid, p_cliente_id uuid, p_itens jsonb,
  p_observacao text default null, p_feito_em timestamptz default null)
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
begin
  select * into v_perfil from perfis where id = auth.uid() and ativo;
  if not found or not (v_perfil.admin or 'pedidos_criar' = any (v_perfil.permissoes)) then
    raise exception 'Você não tem permissão para fazer pedidos.' using errcode = '42501';
  end if;

  -- Já recebido antes (reenvio do celular)? Devolve o mesmo pedido.
  if p_client_id is not null then
    select * into v_pedido from pedidos where client_id = p_client_id;
    if found then
      return jsonb_build_object('id', v_pedido.id, 'numero', v_pedido.numero, 'status', v_pedido.status, 'duplicado', true);
    end if;
  end if;

  if not exists (select 1 from clientes where id = p_cliente_id and ativo) then
    raise exception 'Cliente não encontrado ou inativo.';
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
           coalesce((e->>'desconto_pct')::numeric, 0) as desconto
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
    if v_item.desconto > v_perfil.desconto_max and not v_perfil.admin then
      v_aprovar := true;
    end if;
    if v_prod.estoque < v_item.qtd then
      v_faltas := v_faltas || jsonb_build_object(
        'produto_id', v_prod.id, 'produto', v_prod.nome,
        'pedido', v_item.qtd, 'disponivel', greatest(v_prod.estoque, 0));
    end if;
  end loop;

  if jsonb_array_length(v_faltas) > 0 then
    raise exception 'ESTOQUE_INSUFICIENTE' using detail = v_faltas::text;
  end if;

  insert into pedidos (client_id, cliente_id, vendedor_id, status, observacao, feito_em)
  values (p_client_id, p_cliente_id, v_perfil.id,
          case when v_aprovar then 'aguardando_aprovacao' else 'liberado' end,
          nullif(trim(p_observacao), ''), coalesce(p_feito_em, now()))
  returning * into v_pedido;

  for v_item in
    select (e->>'produto_id')::uuid as produto_id,
           (e->>'quantidade')::numeric as qtd,
           coalesce((e->>'desconto_pct')::numeric, 0) as desconto
      from jsonb_array_elements(p_itens) e
  loop
    select * into v_prod from produtos where id = v_item.produto_id;
    v_unit := round(v_prod.preco * (1 - v_item.desconto / 100), 2);
    insert into pedido_itens (pedido_id, produto_id, quantidade, preco_tabela, desconto_pct, preco_unit, total, peso_kg)
    values (v_pedido.id, v_prod.id, v_item.qtd, v_prod.preco, v_item.desconto, v_unit,
            round(v_unit * v_item.qtd, 2), v_prod.peso_kg * v_item.qtd);
    v_total := v_total + round(v_unit * v_item.qtd, 2);
    v_peso  := v_peso + v_prod.peso_kg * v_item.qtd;
    perform _mover_estoque(v_prod.id, -v_item.qtd, 'venda', v_pedido.id, null, null);
  end loop;

  update pedidos set total = v_total, peso_kg = v_peso where id = v_pedido.id;

  return jsonb_build_object('id', v_pedido.id, 'numero', v_pedido.numero, 'status', v_pedido.status, 'duplicado', false);
end $$;

create or replace function public.aprovar_pedido(p_pedido uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not eh_admin() then raise exception 'Só administradores aprovam pedidos.' using errcode = '42501'; end if;
  update pedidos set status = 'liberado', aprovado_por = auth.uid(), aprovado_em = now()
   where id = p_pedido and status = 'aguardando_aprovacao';
  if not found then raise exception 'Pedido não está aguardando aprovação.'; end if;
end $$;

create or replace function public.recusar_pedido(p_pedido uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not eh_admin() then raise exception 'Só administradores recusam pedidos.' using errcode = '42501'; end if;
  update pedidos set status = 'recusado', aprovado_por = auth.uid(), aprovado_em = now()
   where id = p_pedido and status = 'aguardando_aprovacao';
  if not found then raise exception 'Pedido não está aguardando aprovação.'; end if;
  perform _devolver_estoque_pedido(p_pedido, 'cancelamento', 'Pedido recusado');
end $$;

-- Escritório cancela qualquer pedido que ainda não saiu.
-- Vendedor cancela o próprio pedido enquanto não estiver numa carga.
create or replace function public.cancelar_pedido(p_pedido uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v pedidos; v_carga_status text;
begin
  select * into v from pedidos where id = p_pedido for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if not (tem_perm('pedidos_ver_todos') or (v.vendedor_id = auth.uid() and v.carga_id is null)) then
    raise exception 'Você não pode cancelar este pedido.' using errcode = '42501';
  end if;
  if v.status not in ('aguardando_aprovacao', 'liberado') then
    raise exception 'Só dá para cancelar pedido que ainda não saiu para entrega.';
  end if;
  if v.carga_id is not null then
    select status into v_carga_status from cargas where id = v.carga_id;
    if v_carga_status <> 'montando' then raise exception 'A carga deste pedido já saiu.'; end if;
  end if;
  update pedidos set status = 'cancelado', carga_id = null where id = p_pedido;
  perform _devolver_estoque_pedido(p_pedido, 'cancelamento', 'Pedido cancelado');
end $$;

create or replace function public.marcar_pedidos_impressos(p_pedidos uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (tem_perm('pedidos_ver_todos') or tem_perm('cargas')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  update pedidos set impresso_em = now() where id = any (p_pedidos);
end $$;

-- ---------------------------------------------------------------------
-- CARGAS
-- ---------------------------------------------------------------------
-- Define exatamente quais pedidos estão na carga (adiciona e remove)
create or replace function public.definir_pedidos_carga(p_carga uuid, p_pedidos uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_invalidos int;
begin
  perform _exigir('cargas');
  select status into v_status from cargas where id = p_carga for update;
  if not found then raise exception 'Carga não encontrada.'; end if;
  if v_status <> 'montando' then raise exception 'Esta carga já saiu. Reabra para mudar os pedidos.'; end if;

  select count(*) into v_invalidos from pedidos
   where id = any (p_pedidos)
     and (status <> 'liberado' or (carga_id is not null and carga_id <> p_carga));
  if v_invalidos > 0 then
    raise exception '% pedido(s) não estão disponíveis (já estão em outra carga, cancelados ou aguardando aprovação).', v_invalidos;
  end if;

  update pedidos set carga_id = null where carga_id = p_carga and not (id = any (p_pedidos));
  update pedidos set carga_id = p_carga where id = any (p_pedidos);
end $$;

create or replace function public.saida_carga(p_carga uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _exigir('cargas');
  if not exists (select 1 from pedidos where carga_id = p_carga) then
    raise exception 'A carga não tem pedidos.';
  end if;
  update cargas set status = 'saiu', saiu_em = now() where id = p_carga and status = 'montando';
  if not found then raise exception 'A carga não está em montagem.'; end if;
  update pedidos set status = 'carregado' where carga_id = p_carga and status = 'liberado';
end $$;

create or replace function public.reabrir_carga(p_carga uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _exigir('cargas');
  update cargas set status = 'montando', saiu_em = null where id = p_carga and status = 'saiu';
  if not found then raise exception 'Só dá para reabrir carga que saiu e ainda não foi conferida.'; end if;
  update pedidos set status = 'liberado' where carga_id = p_carga and status = 'carregado';
end $$;

-- Romaneio: produtos somados, na ordem das categorias
create or replace function public.romaneio_itens(p_carga uuid)
returns table (
  categoria_id uuid, categoria text, categoria_ordem int,
  produto_id uuid, codigo text, produto text, unidade text,
  quantidade numeric, peso_kg numeric, valor numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (tem_perm('cargas') or tem_perm('conferencia')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return query
  select c.id, coalesce(c.nome, 'Sem categoria'), coalesce(c.ordem, 999999),
         pr.id, pr.codigo, pr.nome, pr.unidade,
         sum(i.quantidade), sum(i.peso_kg), sum(i.total)
    from pedidos p
    join pedido_itens i on i.pedido_id = p.id
    join produtos pr on pr.id = i.produto_id
    left join categorias c on c.id = pr.categoria_id
   where p.carga_id = p_carga and p.status in ('liberado', 'carregado', 'entregue')
   group by c.id, c.nome, c.ordem, pr.id, pr.codigo, pr.nome, pr.unidade
   order by coalesce(c.ordem, 999999), coalesce(c.nome, 'Sem categoria'), pr.nome;
end $$;

-- Quantos cascos devem voltar, pelo que foi vendido de retornável
create or replace function public.vasilhames_esperados(p_carga uuid)
returns table (vasilhame_id uuid, vasilhame text, quantidade numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (tem_perm('cargas') or tem_perm('conferencia')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return query
  select v.id, v.nome, sum(i.quantidade * pr.vasilhames_por_unidade)
    from pedidos p
    join pedido_itens i on i.pedido_id = p.id
    join produtos pr on pr.id = i.produto_id
    join vasilhames v on v.id = pr.vasilhame_id
   where p.carga_id = p_carga and p.status in ('liberado', 'carregado', 'entregue')
   group by v.id, v.nome
   order by v.nome;
end $$;

-- ---------------------------------------------------------------------
-- CONFERÊNCIA (retorno do caminhão)
-- p_itens: [{"tipo":"vasilhame","vasilhame_id":"...","quantidade":10},
--           {"tipo":"devolvido","produto_id":"...","quantidade":2},
--           {"tipo":"troca","produto_id":"...","quantidade":1}]
-- "devolvido" volta para o estoque.
-- ---------------------------------------------------------------------
create or replace function public.finalizar_conferencia(p_carga uuid, p_itens jsonb, p_observacao text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; r record; v_prod produtos;
begin
  perform _exigir('conferencia');
  select status into v_status from cargas where id = p_carga for update;
  if not found then raise exception 'Carga não encontrada.'; end if;
  if v_status <> 'saiu' then raise exception 'Só dá para conferir carga que saiu e ainda não foi conferida.'; end if;

  insert into conferencias (carga_id, usuario_id, observacao)
  values (p_carga, auth.uid(), nullif(trim(p_observacao), ''));

  for r in
    select e->>'tipo' as tipo,
           nullif(e->>'produto_id', '')::uuid as produto_id,
           nullif(e->>'vasilhame_id', '')::uuid as vasilhame_id,
           (e->>'quantidade')::numeric as qtd
      from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
     order by e->>'produto_id'
  loop
    if r.qtd is null or r.qtd <= 0 then continue; end if;
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
      perform _mover_estoque(r.produto_id, r.qtd, 'devolucao', null, p_carga, 'Voltou na conferência');
    end if;
  end loop;

  update pedidos set status = 'entregue' where carga_id = p_carga and status = 'carregado';
  update cargas set status = 'conferida' where id = p_carga;
end $$;

-- ---------------------------------------------------------------------
-- ESTOQUE
-- ---------------------------------------------------------------------
create or replace function public.entrada_estoque(p_produto uuid, p_quantidade numeric, p_observacao text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_prod produtos;
begin
  perform _exigir('estoque');
  select * into v_prod from produtos where id = p_produto for update;
  if not found then raise exception 'Produto não encontrado.'; end if;
  if not _quantidade_valida(v_prod, p_quantidade) then
    raise exception 'Quantidade inválida: %', p_quantidade;
  end if;
  return _mover_estoque(p_produto, p_quantidade, 'entrada', null, null, nullif(trim(p_observacao), ''));
end $$;

create or replace function public.ajustar_estoque(p_produto uuid, p_novo_saldo numeric, p_observacao text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_atual numeric;
begin
  perform _exigir('estoque');
  select estoque into v_atual from produtos where id = p_produto for update;
  if not found then raise exception 'Produto não encontrado.'; end if;
  if p_novo_saldo < 0 then raise exception 'O estoque não pode ficar negativo.'; end if;
  if p_novo_saldo = v_atual then return v_atual; end if;
  return _mover_estoque(p_produto, p_novo_saldo - v_atual, 'ajuste', null, null,
                        coalesce(nullif(trim(p_observacao), ''), 'Ajuste manual'));
end $$;

-- ---------------------------------------------------------------------
-- RANKING DOS VENDEDORES (só administradores)
-- ---------------------------------------------------------------------
create or replace function public.ranking_vendedores(p_inicio date, p_fim date)
returns table (vendedor_id uuid, vendedor text, pedidos bigint, clientes bigint, itens numeric, valor numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not eh_admin() then raise exception 'Só administradores veem o ranking.' using errcode = '42501'; end if;
  return query
  select pf.id, pf.nome,
         count(distinct p.id), count(distinct p.cliente_id),
         coalesce(sum(i.quantidade), 0), coalesce(sum(i.total), 0)
    from pedidos p
    join perfis pf on pf.id = p.vendedor_id
    join pedido_itens i on i.pedido_id = p.id
   where p.status not in ('cancelado', 'recusado')
     and p.feito_em >= p_inicio::timestamptz
     and p.feito_em <  (p_fim + 1)::timestamptz
   group by pf.id, pf.nome;
end $$;

-- ---------------------------------------------------------------------
-- Execução das funções: só usuários logados; ajudantes internos fechados
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.eh_admin(), public.tem_perm(text),
  public.criar_pedido(uuid, uuid, jsonb, text, timestamptz),
  public.aprovar_pedido(uuid), public.recusar_pedido(uuid), public.cancelar_pedido(uuid),
  public.marcar_pedidos_impressos(uuid[]),
  public.definir_pedidos_carga(uuid, uuid[]), public.saida_carga(uuid), public.reabrir_carga(uuid),
  public.romaneio_itens(uuid), public.vasilhames_esperados(uuid),
  public.finalizar_conferencia(uuid, jsonb, text),
  public.entrada_estoque(uuid, numeric, text), public.ajustar_estoque(uuid, numeric, text),
  public.ranking_vendedores(date, date)
to authenticated;
-- tem_perm/eh_admin são usados nas políticas
grant execute on function public._quantidade_valida(public.produtos, numeric) to authenticated;

-- >>> 20261109000003_escritorio_faz_pedidos.sql
-- =====================================================================
-- O escritório também faz pedidos (no próprio nome ou no de um vendedor).
-- O limite de desconto que vale é o de quem lança o pedido.
-- =====================================================================

drop function if exists public.criar_pedido(uuid, uuid, jsonb, text, timestamptz);

create or replace function public.criar_pedido(
  p_client_id uuid, p_cliente_id uuid, p_itens jsonb,
  p_observacao text default null, p_feito_em timestamptz default null,
  p_vendedor_id uuid default null)
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
begin
  select * into v_perfil from perfis where id = auth.uid() and ativo;
  if not found or not (v_perfil.admin or 'pedidos_criar' = any (v_perfil.permissoes)
                       or 'pedidos_ver_todos' = any (v_perfil.permissoes)) then
    raise exception 'Você não tem permissão para fazer pedidos.' using errcode = '42501';
  end if;

  -- Pedido lançado pelo escritório no nome de um vendedor (cliente ligou, por exemplo)
  v_vendedor := coalesce(p_vendedor_id, v_perfil.id);
  if v_vendedor <> v_perfil.id then
    if not (v_perfil.admin or 'pedidos_ver_todos' = any (v_perfil.permissoes)) then
      raise exception 'Você só pode lançar pedidos no seu próprio nome.' using errcode = '42501';
    end if;
    if not exists (select 1 from perfis where id = v_vendedor and ativo) then
      raise exception 'Vendedor não encontrado ou inativo.';
    end if;
  end if;

  -- Já recebido antes (reenvio do celular)? Devolve o mesmo pedido.
  if p_client_id is not null then
    select * into v_pedido from pedidos where client_id = p_client_id;
    if found then
      return jsonb_build_object('id', v_pedido.id, 'numero', v_pedido.numero, 'status', v_pedido.status, 'duplicado', true);
    end if;
  end if;

  if not exists (select 1 from clientes where id = p_cliente_id and ativo) then
    raise exception 'Cliente não encontrado ou inativo.';
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
           coalesce((e->>'desconto_pct')::numeric, 0) as desconto
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
    if v_item.desconto > v_perfil.desconto_max and not v_perfil.admin then
      v_aprovar := true;
    end if;
    if v_prod.estoque < v_item.qtd then
      v_faltas := v_faltas || jsonb_build_object(
        'produto_id', v_prod.id, 'produto', v_prod.nome,
        'pedido', v_item.qtd, 'disponivel', greatest(v_prod.estoque, 0));
    end if;
  end loop;

  if jsonb_array_length(v_faltas) > 0 then
    raise exception 'ESTOQUE_INSUFICIENTE' using detail = v_faltas::text;
  end if;

  insert into pedidos (client_id, cliente_id, vendedor_id, status, observacao, feito_em)
  values (p_client_id, p_cliente_id, v_vendedor,
          case when v_aprovar then 'aguardando_aprovacao' else 'liberado' end,
          nullif(trim(p_observacao), ''), coalesce(p_feito_em, now()))
  returning * into v_pedido;

  for v_item in
    select (e->>'produto_id')::uuid as produto_id,
           (e->>'quantidade')::numeric as qtd,
           coalesce((e->>'desconto_pct')::numeric, 0) as desconto
      from jsonb_array_elements(p_itens) e
  loop
    select * into v_prod from produtos where id = v_item.produto_id;
    v_unit := round(v_prod.preco * (1 - v_item.desconto / 100), 2);
    insert into pedido_itens (pedido_id, produto_id, quantidade, preco_tabela, desconto_pct, preco_unit, total, peso_kg)
    values (v_pedido.id, v_prod.id, v_item.qtd, v_prod.preco, v_item.desconto, v_unit,
            round(v_unit * v_item.qtd, 2), v_prod.peso_kg * v_item.qtd);
    v_total := v_total + round(v_unit * v_item.qtd, 2);
    v_peso  := v_peso + v_prod.peso_kg * v_item.qtd;
    perform _mover_estoque(v_prod.id, -v_item.qtd, 'venda', v_pedido.id, null, null);
  end loop;

  update pedidos set total = v_total, peso_kg = v_peso where id = v_pedido.id;

  return jsonb_build_object('id', v_pedido.id, 'numero', v_pedido.numero, 'status', v_pedido.status, 'duplicado', false);
end $$;

revoke execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid) from public, anon;
grant execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid) to authenticated;

-- >>> 20261109000004_nome_da_carga.sql
-- =====================================================================
-- Nome da carga (ex.: "Rota Serra", "Centro + Zona Norte"), sai no romaneio
-- =====================================================================
alter table public.cargas add column if not exists nome text;
grant insert (nome) on public.cargas to authenticated;
grant update (nome) on public.cargas to authenticated;

-- >>> 20261109000005_financeiro.sql
-- =====================================================================
-- Financeiro: valor em cada entrada e saída de estoque, custo do produto,
-- saída manual (avaria, perda, uso próprio) e relatório semanal.
-- =====================================================================

-- Custo de compra do produto (atualizado a cada entrada)
alter table public.produtos add column if not exists custo numeric(12,2) not null default 0 check (custo >= 0);
grant insert (custo) on public.produtos to authenticated;
grant update (custo) on public.produtos to authenticated;

-- Custo na hora da venda (para calcular o lucro mesmo se o custo mudar depois)
alter table public.pedido_itens add column if not exists custo_unit numeric(12,2) not null default 0;

-- Valores em cada movimento de estoque
alter table public.estoque_movimentos add column if not exists valor_unit numeric(12,2);
alter table public.estoque_movimentos add column if not exists desconto numeric(12,2) not null default 0;
alter table public.estoque_movimentos add column if not exists valor_total numeric(12,2);
alter table public.estoque_movimentos add column if not exists motivo text;
alter table public.estoque_movimentos drop constraint if exists estoque_movimentos_tipo_check;
alter table public.estoque_movimentos add constraint estoque_movimentos_tipo_check
  check (tipo in ('entrada','venda','cancelamento','devolucao','ajuste','saida'));

-- Nova permissão "financeiro" (administradores já têm tudo)
comment on column public.perfis.permissoes is
  'pedidos_criar, pedidos_ver_todos, clientes, produtos, estoque, cargas, conferencia, cadastros, financeiro';
drop policy if exists movimentos_ler on public.estoque_movimentos;
create policy movimentos_ler on public.estoque_movimentos for select to authenticated
  using (tem_perm('estoque') or tem_perm('financeiro'));

-- ---------------------------------------------------------------------
-- Movimento de estoque com valor
-- valor_total = quantidade × valor_unit − desconto (sempre positivo)
-- ---------------------------------------------------------------------
drop function if exists public._mover_estoque(uuid, numeric, text, uuid, uuid, text);
create or replace function public._mover_estoque(
  p_produto uuid, p_qtd numeric, p_tipo text,
  p_pedido uuid default null, p_carga uuid default null, p_obs text default null,
  p_valor_unit numeric default null, p_desconto numeric default 0, p_motivo text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_saldo numeric;
begin
  update produtos set estoque = estoque + p_qtd where id = p_produto returning estoque into v_saldo;
  insert into estoque_movimentos (produto_id, tipo, quantidade, saldo, pedido_id, carga_id, usuario_id, observacao,
                                  valor_unit, desconto, valor_total, motivo)
  values (p_produto, p_tipo, p_qtd, v_saldo, p_pedido, p_carga, auth.uid(), p_obs,
          p_valor_unit, coalesce(p_desconto, 0),
          case when p_valor_unit is null then null
               else round(abs(p_qtd) * p_valor_unit - coalesce(p_desconto, 0), 2) end,
          p_motivo);
  return v_saldo;
end $$;
revoke execute on function public._mover_estoque(uuid, numeric, text, uuid, uuid, text, numeric, numeric, text) from public, anon, authenticated;

-- Cancelamento devolve o estoque pelo mesmo valor da venda
create or replace function public._devolver_estoque_pedido(p_pedido uuid, p_tipo text, p_obs text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select produto_id, quantidade, preco_tabela, total from pedido_itens where pedido_id = p_pedido order by produto_id loop
    perform _mover_estoque(r.produto_id, r.quantidade, p_tipo, p_pedido, null, p_obs,
                           r.preco_tabela, round(r.preco_tabela * r.quantidade - r.total, 2));
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Pedido guarda o custo de cada item e o valor da saída
-- ---------------------------------------------------------------------
create or replace function public.criar_pedido(
  p_client_id uuid, p_cliente_id uuid, p_itens jsonb,
  p_observacao text default null, p_feito_em timestamptz default null,
  p_vendedor_id uuid default null)
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
begin
  select * into v_perfil from perfis where id = auth.uid() and ativo;
  if not found or not (v_perfil.admin or 'pedidos_criar' = any (v_perfil.permissoes)
                       or 'pedidos_ver_todos' = any (v_perfil.permissoes)) then
    raise exception 'Você não tem permissão para fazer pedidos.' using errcode = '42501';
  end if;

  -- Pedido lançado pelo escritório no nome de um vendedor (cliente ligou, por exemplo)
  v_vendedor := coalesce(p_vendedor_id, v_perfil.id);
  if v_vendedor <> v_perfil.id then
    if not (v_perfil.admin or 'pedidos_ver_todos' = any (v_perfil.permissoes)) then
      raise exception 'Você só pode lançar pedidos no seu próprio nome.' using errcode = '42501';
    end if;
    if not exists (select 1 from perfis where id = v_vendedor and ativo) then
      raise exception 'Vendedor não encontrado ou inativo.';
    end if;
  end if;

  -- Já recebido antes (reenvio do celular)? Devolve o mesmo pedido.
  if p_client_id is not null then
    select * into v_pedido from pedidos where client_id = p_client_id;
    if found then
      return jsonb_build_object('id', v_pedido.id, 'numero', v_pedido.numero, 'status', v_pedido.status, 'duplicado', true);
    end if;
  end if;

  if not exists (select 1 from clientes where id = p_cliente_id and ativo) then
    raise exception 'Cliente não encontrado ou inativo.';
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
           coalesce((e->>'desconto_pct')::numeric, 0) as desconto
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
    if v_item.desconto > v_perfil.desconto_max and not v_perfil.admin then
      v_aprovar := true;
    end if;
    if v_prod.estoque < v_item.qtd then
      v_faltas := v_faltas || jsonb_build_object(
        'produto_id', v_prod.id, 'produto', v_prod.nome,
        'pedido', v_item.qtd, 'disponivel', greatest(v_prod.estoque, 0));
    end if;
  end loop;

  if jsonb_array_length(v_faltas) > 0 then
    raise exception 'ESTOQUE_INSUFICIENTE' using detail = v_faltas::text;
  end if;

  insert into pedidos (client_id, cliente_id, vendedor_id, status, observacao, feito_em)
  values (p_client_id, p_cliente_id, v_vendedor,
          case when v_aprovar then 'aguardando_aprovacao' else 'liberado' end,
          nullif(trim(p_observacao), ''), coalesce(p_feito_em, now()))
  returning * into v_pedido;

  for v_item in
    select (e->>'produto_id')::uuid as produto_id,
           (e->>'quantidade')::numeric as qtd,
           coalesce((e->>'desconto_pct')::numeric, 0) as desconto
      from jsonb_array_elements(p_itens) e
  loop
    select * into v_prod from produtos where id = v_item.produto_id;
    v_unit := round(v_prod.preco * (1 - v_item.desconto / 100), 2);
    insert into pedido_itens (pedido_id, produto_id, quantidade, preco_tabela, desconto_pct, preco_unit, total, peso_kg, custo_unit)
    values (v_pedido.id, v_prod.id, v_item.qtd, v_prod.preco, v_item.desconto, v_unit,
            round(v_unit * v_item.qtd, 2), v_prod.peso_kg * v_item.qtd, v_prod.custo);
    v_total := v_total + round(v_unit * v_item.qtd, 2);
    v_peso  := v_peso + v_prod.peso_kg * v_item.qtd;
    perform _mover_estoque(v_prod.id, -v_item.qtd, 'venda', v_pedido.id, null, null,
                           v_prod.preco, round((v_prod.preco - v_unit) * v_item.qtd, 2));
  end loop;

  update pedidos set total = v_total, peso_kg = v_peso where id = v_pedido.id;

  return jsonb_build_object('id', v_pedido.id, 'numero', v_pedido.numero, 'status', v_pedido.status, 'duplicado', false);
end $$;

-- ---------------------------------------------------------------------
-- Conferência: devolução registrada com valor
-- ---------------------------------------------------------------------
create or replace function public.finalizar_conferencia(p_carga uuid, p_itens jsonb, p_observacao text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; r record; v_prod produtos; v_preco numeric;
begin
  perform _exigir('conferencia');
  select status into v_status from cargas where id = p_carga for update;
  if not found then raise exception 'Carga não encontrada.'; end if;
  if v_status <> 'saiu' then raise exception 'Só dá para conferir carga que saiu e ainda não foi conferida.'; end if;

  insert into conferencias (carga_id, usuario_id, observacao)
  values (p_carga, auth.uid(), nullif(trim(p_observacao), ''));

  for r in
    select e->>'tipo' as tipo,
           nullif(e->>'produto_id', '')::uuid as produto_id,
           nullif(e->>'vasilhame_id', '')::uuid as vasilhame_id,
           (e->>'quantidade')::numeric as qtd
      from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
     order by e->>'produto_id'
  loop
    if r.qtd is null or r.qtd <= 0 then continue; end if;
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

-- ---------------------------------------------------------------------
-- Entrada de mercadoria com valor de compra e desconto do fornecedor
-- p_valor_unit: preço de compra de 1 unidade; p_desconto: desconto em R$ no total
-- ---------------------------------------------------------------------
drop function if exists public.entrada_estoque(uuid, numeric, text);
create or replace function public.entrada_estoque(
  p_produto uuid, p_quantidade numeric, p_observacao text default null,
  p_valor_unit numeric default null, p_desconto numeric default 0)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_prod produtos; v_custo numeric;
begin
  perform _exigir('estoque');
  select * into v_prod from produtos where id = p_produto for update;
  if not found then raise exception 'Produto não encontrado.'; end if;
  if not _quantidade_valida(v_prod, p_quantidade) then
    raise exception 'Quantidade inválida: %', p_quantidade;
  end if;
  if p_valor_unit is not null and p_valor_unit < 0 then raise exception 'Valor de compra inválido.'; end if;
  if coalesce(p_desconto, 0) < 0 then raise exception 'Desconto inválido.'; end if;
  if p_valor_unit is not null and coalesce(p_desconto, 0) > p_quantidade * p_valor_unit then
    raise exception 'O desconto é maior que o valor da entrada.';
  end if;
  -- custo real de 1 unidade, já com o desconto do fornecedor
  if p_valor_unit is not null then
    v_custo := round((p_quantidade * p_valor_unit - coalesce(p_desconto, 0)) / p_quantidade, 2);
    update produtos set custo = v_custo where id = p_produto;
  end if;
  return _mover_estoque(p_produto, p_quantidade, 'entrada', null, null, nullif(trim(p_observacao), ''),
                        p_valor_unit, coalesce(p_desconto, 0));
end $$;

-- ---------------------------------------------------------------------
-- Saída manual: avaria, perda, vencido, uso próprio, bonificação, outro
-- O valor é o custo do produto (o que a distribuidora perdeu)
-- ---------------------------------------------------------------------
create or replace function public.saida_estoque(
  p_produto uuid, p_quantidade numeric, p_motivo text, p_observacao text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_prod produtos;
begin
  perform _exigir('estoque');
  select * into v_prod from produtos where id = p_produto for update;
  if not found then raise exception 'Produto não encontrado.'; end if;
  if not _quantidade_valida(v_prod, p_quantidade) then
    raise exception 'Quantidade inválida: %', p_quantidade;
  end if;
  if v_prod.estoque < p_quantidade then
    raise exception 'Só tem % em estoque.', v_prod.estoque;
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da saída.'; end if;
  return _mover_estoque(p_produto, -p_quantidade, 'saida', null, null, nullif(trim(p_observacao), ''),
                        v_prod.custo, 0, trim(p_motivo));
end $$;

-- ---------------------------------------------------------------------
-- Relatório financeiro do período (normalmente uma semana)
-- Vendas = pedidos liberados, carregados ou entregues feitos no período.
-- ---------------------------------------------------------------------
create or replace function public.relatorio_financeiro(p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ini timestamptz := p_inicio::timestamptz;
  v_fim timestamptz := (p_fim + 1)::timestamptz;
  v jsonb;
begin
  if not tem_perm('financeiro') then
    raise exception 'Você não tem permissão para ver o financeiro.' using errcode = '42501';
  end if;

  with ped as (
    select p.*, c.razao_social, pf.nome as vendedor
      from pedidos p join clientes c on c.id = p.cliente_id left join perfis pf on pf.id = p.vendedor_id
     where p.feito_em >= v_ini and p.feito_em < v_fim and p.status in ('liberado','carregado','entregue')
  ), it as (
    select i.*, ped.feito_em from pedido_itens i join ped on ped.id = i.pedido_id
  ), mov as (
    select m.*, pr.nome as produto, pr.unidade, pf.nome as usuario
      from estoque_movimentos m join produtos pr on pr.id = m.produto_id left join perfis pf on pf.id = m.usuario_id
     where m.criado_em >= v_ini and m.criado_em < v_fim
  ), dias as (
    select d::date as dia from generate_series(p_inicio, p_fim, interval '1 day') d
  )
  select jsonb_build_object(
    'resumo', jsonb_build_object(
      'pedidos',        (select count(*) from ped),
      'clientes',       (select count(distinct cliente_id) from ped),
      'vendas_bruto',   (select coalesce(sum(preco_tabela * quantidade), 0) from it),
      'descontos',      (select coalesce(sum(preco_tabela * quantidade - total), 0) from it),
      'vendas_liquido', (select coalesce(sum(total), 0) from it),
      'custo_vendido',  (select coalesce(sum(custo_unit * quantidade), 0) from it),
      'devolucoes',     (select coalesce(sum(valor_total), 0) from mov where tipo = 'devolucao'),
      'compras',        (select coalesce(sum(valor_total), 0) from mov where tipo = 'entrada'),
      'descontos_compra', (select coalesce(sum(desconto), 0) from mov where tipo = 'entrada'),
      'saidas_manuais', (select coalesce(sum(valor_total), 0) from mov where tipo = 'saida'),
      'itens_sem_custo', (select count(*) from it where custo_unit = 0)
    ),
    'por_dia', (select coalesce(jsonb_agg(x order by x.dia), '[]') from (
      select d.dia,
             (select count(*) from ped where ped.feito_em::date = d.dia) as pedidos,
             (select coalesce(sum(total), 0) from it where it.feito_em::date = d.dia) as vendas,
             (select coalesce(sum(preco_tabela * quantidade - total), 0) from it where it.feito_em::date = d.dia) as descontos,
             (select coalesce(sum(valor_total), 0) from mov where tipo = 'entrada' and mov.criado_em::date = d.dia) as compras
        from dias d) x),
    'pedidos', (select coalesce(jsonb_agg(x order by x.numero), '[]') from (
      select ped.id, ped.numero, ped.feito_em, ped.razao_social as cliente, ped.vendedor, ped.status, ped.observacao,
             (select sum(preco_tabela * quantidade) from it where it.pedido_id = ped.id) as bruto,
             (select sum(preco_tabela * quantidade - total) from it where it.pedido_id = ped.id) as desconto,
             ped.total as liquido,
             (select max(desconto_pct) from it where it.pedido_id = ped.id) as maior_desconto
        from ped) x),
    'produtos', (select coalesce(jsonb_agg(x order by x.faturamento desc), '[]') from (
      select pr.nome as produto, pr.unidade, sum(it.quantidade) as quantidade,
             sum(it.total) as faturamento, sum(it.custo_unit * it.quantidade) as custo,
             sum(it.total) - sum(it.custo_unit * it.quantidade) as lucro,
             sum(it.preco_tabela * it.quantidade - it.total) as descontos,
             bool_or(it.custo_unit = 0) as sem_custo
        from it join produtos pr on pr.id = it.produto_id
       group by pr.nome, pr.unidade) x),
    'entradas', (select coalesce(jsonb_agg(x order by x.criado_em), '[]') from (
      select criado_em, produto, unidade, quantidade, valor_unit, desconto, valor_total, observacao, usuario
        from mov where tipo = 'entrada') x),
    'saidas', (select coalesce(jsonb_agg(x order by x.criado_em), '[]') from (
      select criado_em, produto, unidade, -quantidade as quantidade, valor_unit, valor_total, motivo, observacao, usuario
        from mov where tipo = 'saida') x),
    'devolucoes', (select coalesce(jsonb_agg(x order by x.criado_em), '[]') from (
      select criado_em, produto, unidade, quantidade, valor_unit, valor_total, observacao, usuario
        from mov where tipo = 'devolucao') x)
  ) into v;
  return v;
end $$;

revoke execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid) from public, anon;
grant execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid) to authenticated;
revoke execute on function public.entrada_estoque(uuid, numeric, text, numeric, numeric) from public, anon;
grant execute on function public.entrada_estoque(uuid, numeric, text, numeric, numeric) to authenticated;
revoke execute on function public.saida_estoque(uuid, numeric, text, text) from public, anon;
grant execute on function public.saida_estoque(uuid, numeric, text, text) to authenticated;
revoke execute on function public.relatorio_financeiro(date, date) from public, anon;
grant execute on function public.relatorio_financeiro(date, date) to authenticated;
revoke execute on function public._devolver_estoque_pedido(uuid, text, text) from public, anon, authenticated;

-- >>> 20261109000006_recibos.sql
-- =====================================================================
-- Recibos: "Recebemos de ... a importância de R$ ... referente a ..."
-- Ficam numerados e entram no relatório financeiro como recebimentos.
-- =====================================================================
create table if not exists public.recibos (
  id            uuid primary key default gen_random_uuid(),
  numero        bigint generated always as identity unique,
  data          date not null default current_date,
  valor         numeric(12,2) not null check (valor > 0),
  recebemos_de  text not null,
  documento     text,                       -- CPF/CNPJ de quem pagou (opcional)
  cliente_id    uuid references public.clientes (id) on delete set null,
  referente     text,
  observacao    text,
  cancelado     boolean not null default false,
  criado_por    uuid references public.perfis (id) on delete set null default auth.uid(),
  criado_em     timestamptz not null default now()
);
create index if not exists recibos_data_idx on public.recibos (data);

alter table public.recibos enable row level security;
revoke all on public.recibos from anon;
create policy recibos_ler on public.recibos for select to authenticated
  using (tem_perm('pedidos_ver_todos') or tem_perm('financeiro'));
create policy recibos_criar on public.recibos for insert to authenticated
  with check (tem_perm('pedidos_ver_todos') or tem_perm('financeiro'));
-- só cancelar (nunca apagar), e só administrador
create policy recibos_cancelar on public.recibos for update to authenticated
  using (eh_admin()) with check (eh_admin());
revoke insert, update, delete on public.recibos from authenticated;
grant insert (data, valor, recebemos_de, documento, cliente_id, referente, observacao) on public.recibos to authenticated;
grant update (cancelado) on public.recibos to authenticated;

-- Relatório financeiro passa a mostrar os recebimentos (recibos)
create or replace function public.relatorio_financeiro(p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ini timestamptz := p_inicio::timestamptz;
  v_fim timestamptz := (p_fim + 1)::timestamptz;
  v jsonb;
begin
  if not tem_perm('financeiro') then
    raise exception 'Você não tem permissão para ver o financeiro.' using errcode = '42501';
  end if;

  with ped as (
    select p.*, c.razao_social, pf.nome as vendedor
      from pedidos p join clientes c on c.id = p.cliente_id left join perfis pf on pf.id = p.vendedor_id
     where p.feito_em >= v_ini and p.feito_em < v_fim and p.status in ('liberado','carregado','entregue')
  ), it as (
    select i.*, ped.feito_em from pedido_itens i join ped on ped.id = i.pedido_id
  ), mov as (
    select m.*, pr.nome as produto, pr.unidade, pf.nome as usuario
      from estoque_movimentos m join produtos pr on pr.id = m.produto_id left join perfis pf on pf.id = m.usuario_id
     where m.criado_em >= v_ini and m.criado_em < v_fim
  ), dias as (
    select d::date as dia from generate_series(p_inicio, p_fim, interval '1 day') d
  )
  select jsonb_build_object(
    'resumo', jsonb_build_object(
      'pedidos',        (select count(*) from ped),
      'clientes',       (select count(distinct cliente_id) from ped),
      'vendas_bruto',   (select coalesce(sum(preco_tabela * quantidade), 0) from it),
      'descontos',      (select coalesce(sum(preco_tabela * quantidade - total), 0) from it),
      'vendas_liquido', (select coalesce(sum(total), 0) from it),
      'custo_vendido',  (select coalesce(sum(custo_unit * quantidade), 0) from it),
      'devolucoes',     (select coalesce(sum(valor_total), 0) from mov where tipo = 'devolucao'),
      'compras',        (select coalesce(sum(valor_total), 0) from mov where tipo = 'entrada'),
      'descontos_compra', (select coalesce(sum(desconto), 0) from mov where tipo = 'entrada'),
      'saidas_manuais', (select coalesce(sum(valor_total), 0) from mov where tipo = 'saida'),
      'itens_sem_custo', (select count(*) from it where custo_unit = 0),
      'recebimentos',   (select coalesce(sum(valor), 0) from recibos where data between p_inicio and p_fim and not cancelado)
    ),
    'recibos', (select coalesce(jsonb_agg(x order by x.numero), '[]') from (
      select r.numero, r.data, r.valor, r.recebemos_de, r.referente, r.observacao, pf.nome as usuario
        from recibos r left join perfis pf on pf.id = r.criado_por
       where r.data between p_inicio and p_fim and not r.cancelado) x),
    'por_dia', (select coalesce(jsonb_agg(x order by x.dia), '[]') from (
      select d.dia,
             (select count(*) from ped where ped.feito_em::date = d.dia) as pedidos,
             (select coalesce(sum(total), 0) from it where it.feito_em::date = d.dia) as vendas,
             (select coalesce(sum(preco_tabela * quantidade - total), 0) from it where it.feito_em::date = d.dia) as descontos,
             (select coalesce(sum(valor_total), 0) from mov where tipo = 'entrada' and mov.criado_em::date = d.dia) as compras
        from dias d) x),
    'pedidos', (select coalesce(jsonb_agg(x order by x.numero), '[]') from (
      select ped.id, ped.numero, ped.feito_em, ped.razao_social as cliente, ped.vendedor, ped.status, ped.observacao,
             (select sum(preco_tabela * quantidade) from it where it.pedido_id = ped.id) as bruto,
             (select sum(preco_tabela * quantidade - total) from it where it.pedido_id = ped.id) as desconto,
             ped.total as liquido,
             (select max(desconto_pct) from it where it.pedido_id = ped.id) as maior_desconto
        from ped) x),
    'produtos', (select coalesce(jsonb_agg(x order by x.faturamento desc), '[]') from (
      select pr.nome as produto, pr.unidade, sum(it.quantidade) as quantidade,
             sum(it.total) as faturamento, sum(it.custo_unit * it.quantidade) as custo,
             sum(it.total) - sum(it.custo_unit * it.quantidade) as lucro,
             sum(it.preco_tabela * it.quantidade - it.total) as descontos,
             bool_or(it.custo_unit = 0) as sem_custo
        from it join produtos pr on pr.id = it.produto_id
       group by pr.nome, pr.unidade) x),
    'entradas', (select coalesce(jsonb_agg(x order by x.criado_em), '[]') from (
      select criado_em, produto, unidade, quantidade, valor_unit, desconto, valor_total, observacao, usuario
        from mov where tipo = 'entrada') x),
    'saidas', (select coalesce(jsonb_agg(x order by x.criado_em), '[]') from (
      select criado_em, produto, unidade, -quantidade as quantidade, valor_unit, valor_total, motivo, observacao, usuario
        from mov where tipo = 'saida') x),
    'devolucoes', (select coalesce(jsonb_agg(x order by x.criado_em), '[]') from (
      select criado_em, produto, unidade, quantidade, valor_unit, valor_total, observacao, usuario
        from mov where tipo = 'devolucao') x)
  ) into v;
  return v;
end $$;

-- >>> 20261109000007_desempenho_vendedores.sql
-- =====================================================================
-- Desempenho dos vendedores no período (dia, semana ou mês):
-- pedidos, clientes atendidos, quantidade por unidade (CX/FD/LT/UN),
-- valor vendido e quanto cada um vendeu de cada produto.
-- Conta pedidos liberados, carregados, entregues e aguardando aprovação
-- (igual ao ranking); não conta cancelados nem recusados.
-- =====================================================================
create or replace function public.desempenho_vendedores(p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not eh_admin() then
    raise exception 'Só administradores veem o desempenho dos vendedores.' using errcode = '42501';
  end if;

  with ped as (
    select p.* from pedidos p
     where p.status not in ('cancelado', 'recusado')
       and p.vendedor_id is not null
       and p.feito_em >= p_inicio::timestamptz and p.feito_em < (p_fim + 1)::timestamptz
  ), it as (
    select i.*, ped.vendedor_id, ped.cliente_id, pr.nome as produto, pr.codigo, pr.unidade
      from pedido_itens i join ped on ped.id = i.pedido_id join produtos pr on pr.id = i.produto_id
  )
  select jsonb_build_object(
    'vendedores', (select coalesce(jsonb_agg(x order by x.valor desc), '[]') from (
      select pf.id as vendedor_id, pf.nome,
             (select count(*) from ped where ped.vendedor_id = pf.id) as pedidos,
             (select count(distinct cliente_id) from ped where ped.vendedor_id = pf.id) as clientes,
             coalesce((select sum(quantidade) from it where it.vendedor_id = pf.id), 0) as itens,
             coalesce((select sum(quantidade) from it where it.vendedor_id = pf.id and unidade = 'CX'), 0) as caixas,
             coalesce((select sum(quantidade) from it where it.vendedor_id = pf.id and unidade = 'FD'), 0) as fardos,
             coalesce((select sum(quantidade) from it where it.vendedor_id = pf.id and unidade = 'LT'), 0) as litros,
             coalesce((select sum(quantidade) from it where it.vendedor_id = pf.id and unidade = 'UN'), 0) as unidades,
             coalesce((select sum(total) from ped where ped.vendedor_id = pf.id), 0) as valor
        from perfis pf
       where pf.id in (select vendedor_id from ped)
          or (pf.ativo and 'pedidos_criar' = any (pf.permissoes))
    ) x),
    'produtos', (select coalesce(jsonb_agg(x order by x.produto, x.vendedor_id), '[]') from (
      select vendedor_id, produto_id, produto, codigo, unidade,
             sum(quantidade) as quantidade, sum(total) as valor, count(distinct cliente_id) as clientes
        from it group by vendedor_id, produto_id, produto, codigo, unidade
    ) x)
  ) into v;
  return v;
end $$;

revoke execute on function public.desempenho_vendedores(date, date) from public, anon;
grant execute on function public.desempenho_vendedores(date, date) to authenticated;

-- >>> 20261110000008_numero_da_carga_por_dia.sql
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

-- >>> 20261110000009_impressao_automatica.sql
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

-- >>> 20261110000010_roteiro_de_visitas.sql
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

-- >>> 20261110000011_alerta_clientes_sem_pedido.sql
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

-- >>> 20261110000012_ranking_clientes.sql
-- =====================================================================
-- Ranking dos clientes no período (semana ou mês): quantas vezes
-- compraram (pedidos), quantos itens e quanto em reais.
-- Mesma regra do ranking dos vendedores: não conta cancelados e recusados.
-- =====================================================================
create or replace function public.ranking_clientes(p_inicio date, p_fim date)
returns table (cliente_id uuid, cliente text, fantasia text, bairro text, rota text, vendedor text,
               pedidos bigint, itens numeric, caixas numeric, valor numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not eh_admin() then raise exception 'Só administradores veem o ranking.' using errcode = '42501'; end if;
  return query
  with ped as (
    select p.id, p.cliente_id, p.total from pedidos p
     where p.status not in ('cancelado', 'recusado')
       and p.feito_em >= p_inicio::timestamptz and p.feito_em < (p_fim + 1)::timestamptz
  ), it as (
    select ped.cliente_id, sum(i.quantidade) as itens,
           sum(case when pr.unidade = 'CX' then i.quantidade else 0 end) as caixas
      from ped join pedido_itens i on i.pedido_id = ped.id join produtos pr on pr.id = i.produto_id
     group by ped.cliente_id
  )
  select c.id, c.razao_social, c.nome_fantasia, c.bairro, r.nome, pf.nome,
         count(ped.id), coalesce(max(it.itens), 0), coalesce(max(it.caixas), 0), coalesce(sum(ped.total), 0)
    from ped
    join clientes c on c.id = ped.cliente_id
    left join rotas r on r.id = c.rota_id
    left join perfis pf on pf.id = c.vendedor_id
    left join it on it.cliente_id = c.id
   group by c.id, c.razao_social, c.nome_fantasia, c.bairro, r.nome, pf.nome;
end $$;

revoke execute on function public.ranking_clientes(date, date) from public, anon;
grant execute on function public.ranking_clientes(date, date) to authenticated;

-- >>> 20261110000013_carteira_de_clientes.sql
-- =====================================================================
-- Carteira de clientes: cada cliente é de um vendedor.
--  * todo cliente novo (ou alterado) precisa ter vendedor
--  * o vendedor só enxerga os clientes dele
--  * pedido só pode ser do vendedor dono do cliente; o escritório lança
--    automaticamente no nome do dono
-- =====================================================================

-- Vendedor obrigatório. "not valid": vale para cadastros novos e alterações;
-- os clientes antigos sem vendedor continuam lá até alguém editar
-- (a tela Clientes mostra o filtro "Sem vendedor").
alter table public.clientes drop constraint if exists clientes_vendedor_obrigatorio;
alter table public.clientes add constraint clientes_vendedor_obrigatorio check (vendedor_id is not null) not valid;

-- Quem só vende (sem acesso ao escritório) vê apenas os próprios clientes
drop policy if exists clientes_ler on public.clientes;
create policy clientes_ler on public.clientes for select to authenticated
  using (
    vendedor_id = auth.uid()
    or tem_perm('clientes') or tem_perm('pedidos_ver_todos') or tem_perm('cargas')
    or tem_perm('conferencia') or tem_perm('financeiro') or tem_perm('cadastros')
  );

create or replace function public.criar_pedido(
  p_client_id uuid, p_cliente_id uuid, p_itens jsonb,
  p_observacao text default null, p_feito_em timestamptz default null,
  p_vendedor_id uuid default null)
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

  select vendedor_id into v_dono from clientes where id = p_cliente_id and ativo;
  if not found then
    raise exception 'Cliente não encontrado ou inativo.';
  end if;

  -- Cada cliente é de um vendedor. O vendedor só faz pedido para os clientes dele.
  -- O escritório (admin ou "ver todos os pedidos") lança no nome do dono do cliente.
  v_escritorio := v_perfil.admin or 'pedidos_ver_todos' = any (v_perfil.permissoes);
  v_vendedor := coalesce(p_vendedor_id, case when v_escritorio and v_dono is not null then v_dono else v_perfil.id end);
  if v_vendedor <> v_perfil.id and not v_escritorio then
    raise exception 'Você só pode lançar pedidos no seu próprio nome.' using errcode = '42501';
  end if;
  if v_vendedor <> v_perfil.id and not exists (select 1 from perfis where id = v_vendedor and ativo) then
    raise exception 'Vendedor não encontrado ou inativo.';
  end if;
  if v_dono is null and not v_escritorio then
    raise exception 'Este cliente ainda não tem vendedor. Peça ao escritório para colocar o cliente na sua carteira.' using errcode = '42501';
  end if;
  if v_dono is not null and v_vendedor <> v_dono then
    raise exception 'Este cliente é do vendedor %. Só ele pode ter pedidos para este cliente.',
      (select nome from perfis where id = v_dono) using errcode = '42501';
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
           coalesce((e->>'desconto_pct')::numeric, 0) as desconto
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
    if v_item.desconto > v_perfil.desconto_max and not v_perfil.admin then
      v_aprovar := true;
    end if;
    if v_prod.estoque < v_item.qtd then
      v_faltas := v_faltas || jsonb_build_object(
        'produto_id', v_prod.id, 'produto', v_prod.nome,
        'pedido', v_item.qtd, 'disponivel', greatest(v_prod.estoque, 0));
    end if;
  end loop;

  if jsonb_array_length(v_faltas) > 0 then
    raise exception 'ESTOQUE_INSUFICIENTE' using detail = v_faltas::text;
  end if;

  insert into pedidos (client_id, cliente_id, vendedor_id, status, observacao, feito_em)
  values (p_client_id, p_cliente_id, v_vendedor,
          case when v_aprovar then 'aguardando_aprovacao' else 'liberado' end,
          nullif(trim(p_observacao), ''), coalesce(p_feito_em, now()))
  returning * into v_pedido;

  for v_item in
    select (e->>'produto_id')::uuid as produto_id,
           (e->>'quantidade')::numeric as qtd,
           coalesce((e->>'desconto_pct')::numeric, 0) as desconto
      from jsonb_array_elements(p_itens) e
  loop
    select * into v_prod from produtos where id = v_item.produto_id;
    v_unit := round(v_prod.preco * (1 - v_item.desconto / 100), 2);
    insert into pedido_itens (pedido_id, produto_id, quantidade, preco_tabela, desconto_pct, preco_unit, total, peso_kg, custo_unit)
    values (v_pedido.id, v_prod.id, v_item.qtd, v_prod.preco, v_item.desconto, v_unit,
            round(v_unit * v_item.qtd, 2), v_prod.peso_kg * v_item.qtd, v_prod.custo);
    v_total := v_total + round(v_unit * v_item.qtd, 2);
    v_peso  := v_peso + v_prod.peso_kg * v_item.qtd;
    perform _mover_estoque(v_prod.id, -v_item.qtd, 'venda', v_pedido.id, null, null,
                           v_prod.preco, round((v_prod.preco - v_unit) * v_item.qtd, 2));
  end loop;

  update pedidos set total = v_total, peso_kg = v_peso where id = v_pedido.id;

  return jsonb_build_object('id', v_pedido.id, 'numero', v_pedido.numero, 'status', v_pedido.status, 'duplicado', false);
end $$;

revoke execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid) from public, anon;
grant execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid) to authenticated;

-- >>> 20261110000014_venda_do_administrador.sql
-- =====================================================================
-- Pedido feito por administrador conta para o administrador
-- (quem fez a venda), mesmo que o cliente seja da carteira de outro.
-- =====================================================================
create or replace function public.criar_pedido(
  p_client_id uuid, p_cliente_id uuid, p_itens jsonb,
  p_observacao text default null, p_feito_em timestamptz default null,
  p_vendedor_id uuid default null)
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

  select vendedor_id into v_dono from clientes where id = p_cliente_id and ativo;
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
  if v_dono is null and not v_escritorio then
    raise exception 'Este cliente ainda não tem vendedor. Peça ao escritório para colocar o cliente na sua carteira.' using errcode = '42501';
  end if;
  if v_dono is not null and v_vendedor <> v_dono and not (v_perfil.admin and v_vendedor = v_perfil.id) then
    raise exception 'Este cliente é do vendedor %. Só ele pode ter pedidos para este cliente.',
      (select nome from perfis where id = v_dono) using errcode = '42501';
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
           coalesce((e->>'desconto_pct')::numeric, 0) as desconto
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
    if v_item.desconto > v_perfil.desconto_max and not v_perfil.admin then
      v_aprovar := true;
    end if;
    if v_prod.estoque < v_item.qtd then
      v_faltas := v_faltas || jsonb_build_object(
        'produto_id', v_prod.id, 'produto', v_prod.nome,
        'pedido', v_item.qtd, 'disponivel', greatest(v_prod.estoque, 0));
    end if;
  end loop;

  if jsonb_array_length(v_faltas) > 0 then
    raise exception 'ESTOQUE_INSUFICIENTE' using detail = v_faltas::text;
  end if;

  insert into pedidos (client_id, cliente_id, vendedor_id, status, observacao, feito_em)
  values (p_client_id, p_cliente_id, v_vendedor,
          case when v_aprovar then 'aguardando_aprovacao' else 'liberado' end,
          nullif(trim(p_observacao), ''), coalesce(p_feito_em, now()))
  returning * into v_pedido;

  for v_item in
    select (e->>'produto_id')::uuid as produto_id,
           (e->>'quantidade')::numeric as qtd,
           coalesce((e->>'desconto_pct')::numeric, 0) as desconto
      from jsonb_array_elements(p_itens) e
  loop
    select * into v_prod from produtos where id = v_item.produto_id;
    v_unit := round(v_prod.preco * (1 - v_item.desconto / 100), 2);
    insert into pedido_itens (pedido_id, produto_id, quantidade, preco_tabela, desconto_pct, preco_unit, total, peso_kg, custo_unit)
    values (v_pedido.id, v_prod.id, v_item.qtd, v_prod.preco, v_item.desconto, v_unit,
            round(v_unit * v_item.qtd, 2), v_prod.peso_kg * v_item.qtd, v_prod.custo);
    v_total := v_total + round(v_unit * v_item.qtd, 2);
    v_peso  := v_peso + v_prod.peso_kg * v_item.qtd;
    perform _mover_estoque(v_prod.id, -v_item.qtd, 'venda', v_pedido.id, null, null,
                           v_prod.preco, round((v_prod.preco - v_unit) * v_item.qtd, 2));
  end loop;

  update pedidos set total = v_total, peso_kg = v_peso where id = v_pedido.id;

  return jsonb_build_object('id', v_pedido.id, 'numero', v_pedido.numero, 'status', v_pedido.status, 'duplicado', false);
end $$;

revoke execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid) from public, anon;
grant execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid) to authenticated;

-- >>> 20261110000015_administrador_pode_tudo.sql
-- =====================================================================
-- Administrador pode tudo: faz pedido para qualquer cliente e credita a
-- venda a quem quiser (ele mesmo, o dono do cliente ou outro vendedor).
-- Vendedor continua só com os próprios clientes.
-- =====================================================================
create or replace function public.criar_pedido(
  p_client_id uuid, p_cliente_id uuid, p_itens jsonb,
  p_observacao text default null, p_feito_em timestamptz default null,
  p_vendedor_id uuid default null)
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

  select vendedor_id into v_dono from clientes where id = p_cliente_id and ativo;
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
  if v_dono is null and not v_escritorio then
    raise exception 'Este cliente ainda não tem vendedor. Peça ao escritório para colocar o cliente na sua carteira.' using errcode = '42501';
  end if;
  -- administrador pode tudo: qualquer cliente, qualquer vendedor
  if v_dono is not null and v_vendedor <> v_dono and not v_perfil.admin then
    raise exception 'Este cliente é do vendedor %. Só ele pode ter pedidos para este cliente.',
      (select nome from perfis where id = v_dono) using errcode = '42501';
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
           coalesce((e->>'desconto_pct')::numeric, 0) as desconto
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
    if v_item.desconto > v_perfil.desconto_max and not v_perfil.admin then
      v_aprovar := true;
    end if;
    if v_prod.estoque < v_item.qtd then
      v_faltas := v_faltas || jsonb_build_object(
        'produto_id', v_prod.id, 'produto', v_prod.nome,
        'pedido', v_item.qtd, 'disponivel', greatest(v_prod.estoque, 0));
    end if;
  end loop;

  if jsonb_array_length(v_faltas) > 0 then
    raise exception 'ESTOQUE_INSUFICIENTE' using detail = v_faltas::text;
  end if;

  insert into pedidos (client_id, cliente_id, vendedor_id, status, observacao, feito_em)
  values (p_client_id, p_cliente_id, v_vendedor,
          case when v_aprovar then 'aguardando_aprovacao' else 'liberado' end,
          nullif(trim(p_observacao), ''), coalesce(p_feito_em, now()))
  returning * into v_pedido;

  for v_item in
    select (e->>'produto_id')::uuid as produto_id,
           (e->>'quantidade')::numeric as qtd,
           coalesce((e->>'desconto_pct')::numeric, 0) as desconto
      from jsonb_array_elements(p_itens) e
  loop
    select * into v_prod from produtos where id = v_item.produto_id;
    v_unit := round(v_prod.preco * (1 - v_item.desconto / 100), 2);
    insert into pedido_itens (pedido_id, produto_id, quantidade, preco_tabela, desconto_pct, preco_unit, total, peso_kg, custo_unit)
    values (v_pedido.id, v_prod.id, v_item.qtd, v_prod.preco, v_item.desconto, v_unit,
            round(v_unit * v_item.qtd, 2), v_prod.peso_kg * v_item.qtd, v_prod.custo);
    v_total := v_total + round(v_unit * v_item.qtd, 2);
    v_peso  := v_peso + v_prod.peso_kg * v_item.qtd;
    perform _mover_estoque(v_prod.id, -v_item.qtd, 'venda', v_pedido.id, null, null,
                           v_prod.preco, round((v_prod.preco - v_unit) * v_item.qtd, 2));
  end loop;

  update pedidos set total = v_total, peso_kg = v_peso where id = v_pedido.id;

  return jsonb_build_object('id', v_pedido.id, 'numero', v_pedido.numero, 'status', v_pedido.status, 'duplicado', false);
end $$;

revoke execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid) from public, anon;
grant execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid) to authenticated;

-- >>> 20261111000016_agenda_de_visitas.sql
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

-- >>> 20261111000017_bairro_compartilhado.sql
-- =====================================================================
-- Bairro (rota) compartilhado: dois ou mais vendedores podem trabalhar
-- na mesma rota. Quem tem a rota na agenda (ou é o responsável por ela)
-- vê e vende para TODOS os clientes dela, não só os da sua carteira.
-- A venda conta para quem fez o pedido.
-- =====================================================================

-- Rotas em que o vendedor trabalha: as que ele é responsável + as da agenda dele
create or replace function public.rotas_do_vendedor(p_vendedor uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct id), '{}') from (
    select id from rotas where vendedor_id = p_vendedor
    union
    select rota_id from agenda_visitas where vendedor_id = p_vendedor
  ) x
$$;
revoke execute on function public.rotas_do_vendedor(uuid) from public, anon;
grant execute on function public.rotas_do_vendedor(uuid) to authenticated;

-- Vendedor vê os clientes da carteira dele e os das rotas em que trabalha
drop policy if exists clientes_ler on public.clientes;
create policy clientes_ler on public.clientes for select to authenticated
  using (
    vendedor_id = auth.uid()
    or rota_id = any (rotas_do_vendedor(auth.uid()))
    or tem_perm('clientes') or tem_perm('pedidos_ver_todos') or tem_perm('cargas')
    or tem_perm('conferencia') or tem_perm('financeiro') or tem_perm('cadastros')
  );

create or replace function public.criar_pedido(
  p_client_id uuid, p_cliente_id uuid, p_itens jsonb,
  p_observacao text default null, p_feito_em timestamptz default null,
  p_vendedor_id uuid default null)
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
           coalesce((e->>'desconto_pct')::numeric, 0) as desconto
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
    if v_item.desconto > v_perfil.desconto_max and not v_perfil.admin then
      v_aprovar := true;
    end if;
    if v_prod.estoque < v_item.qtd then
      v_faltas := v_faltas || jsonb_build_object(
        'produto_id', v_prod.id, 'produto', v_prod.nome,
        'pedido', v_item.qtd, 'disponivel', greatest(v_prod.estoque, 0));
    end if;
  end loop;

  if jsonb_array_length(v_faltas) > 0 then
    raise exception 'ESTOQUE_INSUFICIENTE' using detail = v_faltas::text;
  end if;

  insert into pedidos (client_id, cliente_id, vendedor_id, status, observacao, feito_em)
  values (p_client_id, p_cliente_id, v_vendedor,
          case when v_aprovar then 'aguardando_aprovacao' else 'liberado' end,
          nullif(trim(p_observacao), ''), coalesce(p_feito_em, now()))
  returning * into v_pedido;

  for v_item in
    select (e->>'produto_id')::uuid as produto_id,
           (e->>'quantidade')::numeric as qtd,
           coalesce((e->>'desconto_pct')::numeric, 0) as desconto
      from jsonb_array_elements(p_itens) e
  loop
    select * into v_prod from produtos where id = v_item.produto_id;
    v_unit := round(v_prod.preco * (1 - v_item.desconto / 100), 2);
    insert into pedido_itens (pedido_id, produto_id, quantidade, preco_tabela, desconto_pct, preco_unit, total, peso_kg, custo_unit)
    values (v_pedido.id, v_prod.id, v_item.qtd, v_prod.preco, v_item.desconto, v_unit,
            round(v_unit * v_item.qtd, 2), v_prod.peso_kg * v_item.qtd, v_prod.custo);
    v_total := v_total + round(v_unit * v_item.qtd, 2);
    v_peso  := v_peso + v_prod.peso_kg * v_item.qtd;
    perform _mover_estoque(v_prod.id, -v_item.qtd, 'venda', v_pedido.id, null, null,
                           v_prod.preco, round((v_prod.preco - v_unit) * v_item.qtd, 2));
  end loop;

  update pedidos set total = v_total, peso_kg = v_peso where id = v_pedido.id;

  return jsonb_build_object('id', v_pedido.id, 'numero', v_pedido.numero, 'status', v_pedido.status, 'duplicado', false);
end $$;

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
    end if;  -- rota de outro vendedor: fica compartilhada (os dois vendem nela)
  end loop;

  delete from agenda_visitas where vendedor_id = p_vendedor;
  insert into agenda_visitas (vendedor_id, dia_semana, turno, rota_id)
  select p_vendedor, (e->>'dia')::smallint, e->>'turno', (e->>'rota_id')::uuid
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
   where nullif(e->>'rota_id', '') is not null;
end $$;

create or replace function public.clientes_do_roteiro_com_pedido(p_dia date)
returns setof uuid language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Faça login.' using errcode = '42501'; end if;
  return query
  select distinct p.cliente_id
    from pedidos p
    join clientes c on c.id = p.cliente_id
    join rotas r on r.id = c.rota_id
   where r.id = any (rotas_do_vendedor(auth.uid()))
     and c.ordem_visita is not null
     and p.status not in ('cancelado', 'recusado')
     and p.feito_em >= p_dia::timestamptz and p.feito_em < (p_dia + 1)::timestamptz;
end $$;

revoke execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid) from public, anon;
grant execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid) to authenticated;

-- >>> 20261111000018_pedidos_do_roteiro.sql
-- =====================================================================
-- Para o celular mostrar QUEM tirou pedido de cada cliente do roteiro
-- (dois vendedores podem tirar pedido do mesmo cliente no mesmo dia).
-- Só clientes das rotas em que o vendedor trabalha.
-- =====================================================================
create or replace function public.pedidos_do_roteiro(p_dia date)
returns table (cliente_id uuid, numero bigint, vendedor text, meu boolean, total numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Faça login.' using errcode = '42501'; end if;
  return query
  select p.cliente_id, p.numero, pf.nome, p.vendedor_id = auth.uid(), p.total
    from pedidos p
    join clientes c on c.id = p.cliente_id
    left join perfis pf on pf.id = p.vendedor_id
   where c.rota_id = any (rotas_do_vendedor(auth.uid()))
     and p.status not in ('cancelado', 'recusado')
     and p.feito_em >= p_dia::timestamptz and p.feito_em < (p_dia + 1)::timestamptz
   order by p.numero;
end $$;
revoke execute on function public.pedidos_do_roteiro(date) from public, anon;
grant execute on function public.pedidos_do_roteiro(date) to authenticated;

-- >>> 20261111000019_bairros.sql
-- =====================================================================
-- Bairros: a "rota" passa a ser o BAIRRO do cliente (nas telas aparece
-- "Bairro"). Ao escolher o bairro no cadastro do cliente, o campo de
-- texto do endereço (bairro) é preenchido sozinho com o nome dele; se o
-- bairro for renomeado, os clientes acompanham.
-- =====================================================================
create or replace function public._bairro_do_cliente()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rota_id is not null then
    select nome into new.bairro from rotas where id = new.rota_id;
  end if;
  return new;
end $$;
revoke execute on function public._bairro_do_cliente() from public, anon, authenticated;
drop trigger if exists bairro_do_cliente on public.clientes;
create trigger bairro_do_cliente before insert or update of rota_id, bairro on public.clientes
  for each row execute function public._bairro_do_cliente();

create or replace function public._renomear_bairro()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.nome is distinct from old.nome then
    -- clientes antigos ainda sem vendedor ficam para quando forem editados
    -- (a regra "vendedor obrigatório" vale para toda alteração)
    update clientes set bairro = new.nome where rota_id = new.id and vendedor_id is not null;
  end if;
  return new;
end $$;
revoke execute on function public._renomear_bairro() from public, anon, authenticated;
drop trigger if exists renomear_bairro on public.rotas;
create trigger renomear_bairro after update of nome on public.rotas
  for each row execute function public._renomear_bairro();

-- clientes que já têm bairro (rota) escolhido: acerta o texto do endereço
update public.clientes c set bairro = r.nome from public.rotas r
 where r.id = c.rota_id and c.bairro is distinct from r.nome and c.vendedor_id is not null;

-- Roteiro: se o bairro tiver cliente antigo sem vendedor, explica em vez de dar erro técnico
create or replace function public.salvar_ordem_visitas(p_rota uuid, p_clientes uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_sem text;
begin
  if not (tem_perm('clientes') or tem_perm('cadastros')) then
    raise exception 'Você não tem permissão para mudar o roteiro.' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(p_clientes) c(id) left join clientes k on k.id = c.id where k.id is null or k.rota_id is distinct from p_rota) then
    raise exception 'Há cliente na lista que não é desta rota.';
  end if;
  select string_agg(razao_social, ', ' order by razao_social) into v_sem from clientes where rota_id = p_rota and vendedor_id is null;
  if v_sem is not null then
    raise exception 'Estes clientes do bairro estão sem vendedor: %. Defina o vendedor no cadastro de Clientes e salve de novo.', v_sem;
  end if;
  update clientes set ordem_visita = array_position(p_clientes, id) where rota_id = p_rota;
end $$;

-- >>> 20261115000020_versao_do_banco.sql
-- =====================================================================
-- Versão do banco: o painel compara com a versão que o site espera e
-- avisa os administradores quando falta rodar alguma atualização.
-- Toda atualização nova a partir daqui troca o número abaixo.
-- =====================================================================
create or replace function public.versao_banco()
returns integer language sql stable as $$ select 20 $$;
revoke execute on function public.versao_banco() from public, anon;
grant execute on function public.versao_banco() to authenticated;

-- >>> 20261115000021_desconto_por_preco.sql
-- =====================================================================
-- Desconto por PREÇO e aprovação produto por produto
--  * o vendedor digita o preço de venda; o sistema calcula a %
--    (o limite de % do vendedor continua valendo: abaixo do preço mínimo,
--     aquele produto fica "precisa de aprovação")
--  * o administrador aprova, edita ou recusa CADA produto; recusar apaga só
--    aquele produto (devolve o estoque) e o resto do pedido segue normal
-- =====================================================================
alter table public.pedido_itens add column if not exists precisa_aprovacao boolean not null default false;

-- preço mínimo cadastrado no produto (vazio = só vale o limite de % do vendedor)
alter table public.produtos add column if not exists preco_minimo numeric(12,2) check (preco_minimo is null or preco_minimo >= 0);
grant insert (preco_minimo), update (preco_minimo) on public.produtos to authenticated;

-- preço mínimo de um produto para um vendedor:
--   o maior entre o preço mínimo do cadastro e o limite de % do vendedor (administrador: só o do cadastro)
create or replace function public.preco_minimo_para(p_prod produtos, p_perfil perfis)
returns numeric language sql immutable as $$
  select greatest(coalesce(p_prod.preco_minimo, 0),
                  case when p_perfil.admin then 0 else round(p_prod.preco * (1 - p_perfil.desconto_max / 100), 2) end)
$$;

-- pedidos que já estão aguardando: marca os produtos acima do limite do vendedor
update public.pedido_itens i set precisa_aprovacao = true
  from public.pedidos p join public.perfis pf on pf.id = p.vendedor_id
 where p.id = i.pedido_id and p.status = 'aguardando_aprovacao' and i.desconto_pct > pf.desconto_max;

create or replace function public.criar_pedido(
  p_client_id uuid, p_cliente_id uuid, p_itens jsonb,
  p_observacao text default null, p_feito_em timestamptz default null,
  p_vendedor_id uuid default null)
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
    if v_unit < preco_minimo_para(v_prod, v_perfil) and not v_perfil.admin then
      v_aprovar := true;
    end if;
    if v_prod.estoque < v_item.qtd then
      v_faltas := v_faltas || jsonb_build_object(
        'produto_id', v_prod.id, 'produto', v_prod.nome,
        'pedido', v_item.qtd, 'disponivel', greatest(v_prod.estoque, 0));
    end if;
  end loop;

  if jsonb_array_length(v_faltas) > 0 then
    raise exception 'ESTOQUE_INSUFICIENTE' using detail = v_faltas::text;
  end if;

  insert into pedidos (client_id, cliente_id, vendedor_id, status, observacao, feito_em)
  values (p_client_id, p_cliente_id, v_vendedor,
          case when v_aprovar then 'aguardando_aprovacao' else 'liberado' end,
          nullif(trim(p_observacao), ''), coalesce(p_feito_em, now()))
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
    insert into pedido_itens (pedido_id, produto_id, quantidade, preco_tabela, desconto_pct, preco_unit, total, peso_kg, custo_unit, precisa_aprovacao)
    values (v_pedido.id, v_prod.id, v_item.qtd, v_prod.preco,
            case when v_prod.preco > 0 then least(100, greatest(0, round((v_prod.preco - v_unit) / v_prod.preco * 100, 2))) else 0 end,
            v_unit, round(v_unit * v_item.qtd, 2), v_prod.peso_kg * v_item.qtd, v_prod.custo,
            v_unit < preco_minimo_para(v_prod, v_perfil) and not v_perfil.admin);
    v_total := v_total + round(v_unit * v_item.qtd, 2);
    v_peso  := v_peso + v_prod.peso_kg * v_item.qtd;
    perform _mover_estoque(v_prod.id, -v_item.qtd, 'venda', v_pedido.id, null, null,
                           v_prod.preco, greatest(0, round((v_prod.preco - v_unit) * v_item.qtd, 2)));
  end loop;

  update pedidos set total = v_total, peso_kg = v_peso where id = v_pedido.id;

  return jsonb_build_object('id', v_pedido.id, 'numero', v_pedido.numero, 'status', v_pedido.status, 'duplicado', false);
end $$;

-- recalcula total/peso do pedido; sem produto pendente, libera; sem produto nenhum, recusa
create or replace function public._fechar_aprovacao(p_pedido uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_status text; v_itens int; v_pend int;
begin
  select count(*), count(*) filter (where precisa_aprovacao) into v_itens, v_pend from pedido_itens where pedido_id = p_pedido;
  update pedidos set total = coalesce((select sum(total) from pedido_itens where pedido_id = p_pedido), 0),
                     peso_kg = coalesce((select sum(peso_kg) from pedido_itens where pedido_id = p_pedido), 0)
   where id = p_pedido;
  select status into v_status from pedidos where id = p_pedido;
  if v_status = 'aguardando_aprovacao' then
    if v_itens = 0 then
      update pedidos set status = 'recusado', aprovado_por = auth.uid(), aprovado_em = now() where id = p_pedido;
      return 'recusado';
    elsif v_pend = 0 then
      update pedidos set status = 'liberado', aprovado_por = auth.uid(), aprovado_em = now() where id = p_pedido;
      return 'liberado';
    end if;
  end if;
  return v_status;
end $$;
revoke execute on function public._fechar_aprovacao(uuid) from public, anon, authenticated;

create or replace function public._item_editavel(p_item uuid)
returns pedido_itens language plpgsql security definer set search_path = public as $$
declare v pedido_itens; v_status text;
begin
  if not eh_admin() then raise exception 'Só administradores aprovam descontos.' using errcode = '42501'; end if;
  select * into v from pedido_itens where id = p_item for update;
  if not found then raise exception 'Produto do pedido não encontrado.'; end if;
  select status into v_status from pedidos where id = v.pedido_id for update;
  if v_status not in ('aguardando_aprovacao', 'liberado') then
    raise exception 'Este pedido já saiu para entrega e não pode mais ser alterado.';
  end if;
  return v;
end $$;
revoke execute on function public._item_editavel(uuid) from public, anon, authenticated;

-- aprova o desconto de um produto
create or replace function public.aprovar_item(p_item uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v pedido_itens;
begin
  v := _item_editavel(p_item);
  update pedido_itens set precisa_aprovacao = false where id = p_item;
  return _fechar_aprovacao(v.pedido_id);
end $$;

-- recusa um produto: sai do pedido e o estoque volta
create or replace function public.recusar_item(p_item uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v pedido_itens;
begin
  v := _item_editavel(p_item);
  perform _mover_estoque(v.produto_id, v.quantidade, 'cancelamento', v.pedido_id, null, 'Produto recusado no pedido',
                         v.preco_tabela, greatest(0, round(v.preco_tabela * v.quantidade - v.total, 2)));
  delete from pedido_itens where id = p_item;
  return _fechar_aprovacao(v.pedido_id);
end $$;

-- edita preço e/ou quantidade de um produto (e já aprova)
create or replace function public.editar_item(p_item uuid, p_quantidade numeric, p_preco_unit numeric)
returns text language plpgsql security definer set search_path = public as $$
declare v pedido_itens; v_prod produtos; v_dif numeric;
begin
  v := _item_editavel(p_item);
  select * into v_prod from produtos where id = v.produto_id for update;
  if not _quantidade_valida(v_prod, p_quantidade) then raise exception 'Quantidade inválida: %', p_quantidade; end if;
  if p_preco_unit is null or p_preco_unit <= 0 then raise exception 'Preço inválido.'; end if;
  v_dif := p_quantidade - v.quantidade;
  if v_dif > 0 and v_prod.estoque < v_dif then
    raise exception 'Só tem % de % em estoque.', v_prod.estoque, v_prod.nome;
  end if;
  if v_dif <> 0 then
    perform _mover_estoque(v.produto_id, -v_dif, case when v_dif > 0 then 'venda' else 'cancelamento' end, v.pedido_id, null,
                           'Produto editado na aprovação', round(p_preco_unit, 2), 0);
  end if;
  update pedido_itens set quantidade = p_quantidade, preco_unit = round(p_preco_unit, 2),
         desconto_pct = case when preco_tabela > 0 then least(100, greatest(0, round((preco_tabela - round(p_preco_unit, 2)) / preco_tabela * 100, 2))) else 0 end,
         total = round(round(p_preco_unit, 2) * p_quantidade, 2), peso_kg = v_prod.peso_kg * p_quantidade, precisa_aprovacao = false
   where id = p_item;
  return _fechar_aprovacao(v.pedido_id);
end $$;

-- aprovar o pedido inteiro também tira a marca dos produtos
create or replace function public.aprovar_pedido(p_pedido uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not eh_admin() then raise exception 'Só administradores aprovam pedidos.' using errcode = '42501'; end if;
  update pedidos set status = 'liberado', aprovado_por = auth.uid(), aprovado_em = now()
   where id = p_pedido and status = 'aguardando_aprovacao';
  if not found then raise exception 'Pedido não está aguardando aprovação.'; end if;
  update pedido_itens set precisa_aprovacao = false where pedido_id = p_pedido;
end $$;

grant execute on function public.preco_minimo_para(public.produtos, public.perfis) to authenticated;
revoke execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid) from public, anon;
grant execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid) to authenticated;
revoke execute on function public.aprovar_item(uuid) from public, anon;
grant execute on function public.aprovar_item(uuid) to authenticated;
revoke execute on function public.recusar_item(uuid) from public, anon;
grant execute on function public.recusar_item(uuid) to authenticated;
revoke execute on function public.editar_item(uuid, numeric, numeric) from public, anon;
grant execute on function public.editar_item(uuid, numeric, numeric) to authenticated;

create or replace function public.versao_banco() returns integer language sql stable as $$ select 21 $$;

-- >>> 20261116000022_moto_balcao_sem_desconto.sql
-- =====================================================================
-- Vendedor sem desconto, venda sem estoque, entrega de moto e balcão
--  * vendedor não dá desconto: qualquer mudança no preço espera aprovação
--  * estoque zerado: o vendedor pode vender, o produto espera aprovação
--  * cada pedido tem um tipo de entrega: caminhão (carga), moto ou balcão
--    - moto: tela simples no celular (mapa, ligar, entregue)
--    - balcão: o cliente leva na hora, o pedido já nasce entregue
-- =====================================================================
alter table public.pedidos add column if not exists entrega text not null default 'caminhao';
alter table public.pedidos drop constraint if exists pedidos_entrega_check;
alter table public.pedidos add constraint pedidos_entrega_check check (entrega in ('caminhao', 'moto', 'balcao'));
alter table public.pedidos add column if not exists entregue_em timestamptz;
alter table public.pedido_itens add column if not exists motivo_aprovacao text;
create index if not exists pedidos_entrega_pendente on public.pedidos (entrega) where status = 'liberado' and carga_id is null;

-- quem tem a permissão "moto" vê os pedidos de moto e os clientes
drop policy if exists pedidos_ler on public.pedidos;
create policy pedidos_ler on public.pedidos for select to authenticated
  using (vendedor_id = auth.uid() or tem_perm('pedidos_ver_todos') or tem_perm('cargas') or tem_perm('conferencia')
         or (entrega = 'moto' and tem_perm('moto')));
drop policy if exists clientes_ler on public.clientes;
create policy clientes_ler on public.clientes for select to authenticated
  using (
    vendedor_id = auth.uid()
    or rota_id = any (rotas_do_vendedor(auth.uid()))
    or tem_perm('clientes') or tem_perm('pedidos_ver_todos') or tem_perm('cargas')
    or tem_perm('conferencia') or tem_perm('financeiro') or tem_perm('cadastros') or tem_perm('moto')
  );

drop function if exists public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid);
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

  update pedidos set total = v_total, peso_kg = v_peso where id = v_pedido.id;

  return jsonb_build_object('id', v_pedido.id, 'numero', v_pedido.numero, 'status', v_pedido.status, 'duplicado', false);
end $$;

create or replace function public._fechar_aprovacao(p_pedido uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_status text; v_itens int; v_pend int;
begin
  select count(*), count(*) filter (where precisa_aprovacao) into v_itens, v_pend from pedido_itens where pedido_id = p_pedido;
  update pedidos set total = coalesce((select sum(total) from pedido_itens where pedido_id = p_pedido), 0),
                     peso_kg = coalesce((select sum(peso_kg) from pedido_itens where pedido_id = p_pedido), 0)
   where id = p_pedido;
  select status into v_status from pedidos where id = p_pedido;
  if v_status = 'aguardando_aprovacao' then
    if v_itens = 0 then
      update pedidos set status = 'recusado', aprovado_por = auth.uid(), aprovado_em = now() where id = p_pedido;
      return 'recusado';
    elsif v_pend = 0 then
      update pedidos set status = case when entrega = 'balcao' then 'entregue' else 'liberado' end,
             entregue_em = case when entrega = 'balcao' then now() end,
             aprovado_por = auth.uid(), aprovado_em = now() where id = p_pedido
      returning status into v_status;
      return v_status;
    end if;
  end if;
  return v_status;
end $$;
revoke execute on function public._fechar_aprovacao(uuid) from public, anon, authenticated;

create or replace function public.aprovar_pedido(p_pedido uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not eh_admin() then raise exception 'Só administradores aprovam pedidos.' using errcode = '42501'; end if;
  update pedidos set status = case when entrega = 'balcao' then 'entregue' else 'liberado' end,
         entregue_em = case when entrega = 'balcao' then now() end,
         aprovado_por = auth.uid(), aprovado_em = now()
   where id = p_pedido and status = 'aguardando_aprovacao';
  if not found then raise exception 'Pedido não está aguardando aprovação.'; end if;
  update pedido_itens set precisa_aprovacao = false where pedido_id = p_pedido;
end $$;

-- muda o tipo de entrega (antes de ir para uma carga)
create or replace function public.mudar_entrega(p_pedido uuid, p_entrega text)
returns text language plpgsql security definer set search_path = public as $$
declare v pedidos;
begin
  if not (tem_perm('pedidos_ver_todos') or tem_perm('cargas')) then
    raise exception 'Sem permissão para mudar a entrega.' using errcode = '42501';
  end if;
  if p_entrega not in ('caminhao', 'moto', 'balcao') then raise exception 'Tipo de entrega inválido.'; end if;
  select * into v from pedidos where id = p_pedido for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v.carga_id is not null then raise exception 'Este pedido já está numa carga. Tire da carga primeiro.'; end if;
  if v.status not in ('aguardando_aprovacao', 'liberado') then
    raise exception 'Só dá para mudar a entrega de pedido liberado ou aguardando aprovação.';
  end if;
  update pedidos set entrega = p_entrega,
         status = case when status = 'liberado' and p_entrega = 'balcao' then 'entregue' else status end,
         entregue_em = case when status = 'liberado' and p_entrega = 'balcao' then now() end
   where id = p_pedido returning status into v.status;
  return v.status;
end $$;

-- entrega de moto: marca como entregue (ou volta para "a entregar")
create or replace function public.entregar_moto(p_pedido uuid, p_entregue boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (tem_perm('moto') or tem_perm('pedidos_ver_todos')) then
    raise exception 'Sem permissão para entregas de moto.' using errcode = '42501';
  end if;
  if p_entregue then
    update pedidos set status = 'entregue', entregue_em = now()
     where id = p_pedido and entrega = 'moto' and status = 'liberado';
    if not found then raise exception 'Este pedido não está esperando entrega de moto.'; end if;
  else
    update pedidos set status = 'liberado', entregue_em = null
     where id = p_pedido and entrega = 'moto' and status = 'entregue' and carga_id is null;
    if not found then raise exception 'Não deu para desfazer.'; end if;
  end if;
end $$;

-- cliente "CONSUMIDOR BALCÃO" para vendas rápidas no balcão (cria se não existir)
create or replace function public.cliente_balcao()
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not tem_perm('pedidos_ver_todos') then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select id into v from clientes where razao_social = 'CONSUMIDOR BALCÃO' order by ativo desc limit 1;
  if v is null then
    insert into clientes (razao_social, vendedor_id, observacao)
    values ('CONSUMIDOR BALCÃO', auth.uid(), 'Vendas rápidas no balcão')
    returning id into v;
  else
    update clientes set ativo = true where id = v and not ativo;
  end if;
  return v;
end $$;

revoke execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid, text) from public, anon;
grant execute on function public.criar_pedido(uuid, uuid, jsonb, text, timestamptz, uuid, text) to authenticated;
revoke execute on function public.aprovar_pedido(uuid) from public, anon;
grant execute on function public.aprovar_pedido(uuid) to authenticated;
revoke execute on function public.mudar_entrega(uuid, text) from public, anon;
grant execute on function public.mudar_entrega(uuid, text) to authenticated;
revoke execute on function public.entregar_moto(uuid, boolean) from public, anon;
grant execute on function public.entregar_moto(uuid, boolean) to authenticated;
revoke execute on function public.cliente_balcao() from public, anon;
grant execute on function public.cliente_balcao() to authenticated;

create or replace function public.versao_banco() returns integer language sql stable as $$ select 22 $$;

-- >>> 20261116000023_varios_bairros_por_periodo.sql
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
