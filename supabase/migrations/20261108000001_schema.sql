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
