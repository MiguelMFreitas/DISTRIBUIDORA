-- =====================================================================
-- DADOS DE TESTE  (cole tudo no SQL Editor do Supabase e clique em Run)
-- Cria: 2 vendedores, 2 rotas, 15 clientes, 12 produtos (com estoque e
-- custo), 2 veículos, 2 motoristas, agenda e 10 pedidos nesta semana.
-- Tudo marcado com TESTE. Para apagar: apagar-dados-de-teste.sql
--
-- Logins dos vendedores de teste (senha: teste123):
--   vendedor1   (Carlos Teste)    - 8 clientes, rota TESTE ROTA NORTE
--   vendedor2   (Paula Teste)     - 7 clientes, rota TESTE ROTA SUL
-- Precisa já ter rodado todas as atualizações (01 a 16).
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

do $$
declare
  v1 uuid; v2 uuid; adm uuid;
  r_norte uuid; r_sul uuid; vas uuid;
  cat_vas uuid; cat_2l uuid; cat_agua uuid; cat_lata uuid; cat_litro uuid; cat_cereal uuid;
  cli uuid[]; p record; i int; dono uuid;
  prod jsonb := '{}';
  e text;
begin
  if exists (select 1 from perfis where usuario in ('vendedor1', 'vendedor2')) then
    raise exception 'Os dados de teste já existem. Rode apagar-dados-de-teste.sql antes de criar de novo.';
  end if;

  -- ---------- vendedores (login + perfil) ----------
  foreach e in array array['vendedor1', 'vendedor2'] loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
            e || '@usuarios.distribuidora.app', extensions.crypt('teste123', extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
    returning id into dono;
    insert into auth.identities (user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (dono, dono::text, 'email',
            jsonb_build_object('sub', dono::text, 'email', e || '@usuarios.distribuidora.app', 'email_verified', true),
            now(), now(), now());
    insert into perfis (id, nome, usuario, admin, permissoes, desconto_max)
    values (dono, case e when 'vendedor1' then 'Carlos Teste' else 'Paula Teste' end, e, false, '{pedidos_criar}', 5);
    if e = 'vendedor1' then v1 := dono; else v2 := dono; end if;
  end loop;

  -- ---------- cadastros de apoio ----------
  insert into rotas (nome, vendedor_id) values ('TESTE ROTA NORTE', v1) returning id into r_norte;
  insert into rotas (nome, vendedor_id) values ('TESTE ROTA SUL', v2) returning id into r_sul;
  insert into motoristas (nome, telefone) values ('TESTE MOTORISTA JOSÉ', '(85) 90000-0001'), ('TESTE MOTORISTA ANTÔNIO', '(85) 90000-0002');
  insert into veiculos (nome, placa, capacidade_kg) values ('TESTE CAMINHÃO GRANDE', 'TST1A11', 8000), ('TESTE VAN PEQUENA', 'TST2B22', 1500);
  insert into vasilhames (nome) values ('TESTE ENGRADADO 600ML') returning id into vas;

  -- categorias (usa as que já existem com o mesmo nome)
  insert into categorias (nome, ordem) values ('Caixas de vasilhame', 1), ('Refrigerante 2L', 2), ('Água', 3), ('Latinha', 5), ('Litros de bebidas', 8), ('Cereais', 9)
    on conflict (nome) do nothing;
  select id into cat_vas from categorias where nome = 'Caixas de vasilhame';
  select id into cat_2l from categorias where nome = 'Refrigerante 2L';
  select id into cat_agua from categorias where nome = 'Água';
  select id into cat_lata from categorias where nome = 'Latinha';
  select id into cat_litro from categorias where nome = 'Litros de bebidas';
  select id into cat_cereal from categorias where nome = 'Cereais';

  -- ---------- produtos (código TST..., estoque entra pela função, com valor) ----------
  for p in select * from (values
    ('TST01', 'TESTE CERVEJA BRAHMA 600ML RET', cat_vas, 'CX', true, 92.00, 21.5, 74.00, 200, 20, true),
    ('TST02', 'TESTE CERVEJA SKOL 600ML RET', cat_vas, 'CX', true, 89.00, 21.5, 71.00, 150, 20, true),
    ('TST03', 'TESTE REFRI COLA 2L C/6', cat_2l, 'FD', false, 54.00, 12.6, 41.00, 120, 15, false),
    ('TST04', 'TESTE REFRI GUARANÁ 2L C/6', cat_2l, 'FD', false, 42.00, 12.6, 31.50, 100, 15, false),
    ('TST05', 'TESTE ÁGUA MINERAL 500ML C/12', cat_agua, 'FD', false, 15.00, 6.3, 9.80, 200, 30, false),
    ('TST06', 'TESTE ÁGUA MINERAL 1,5L C/6', cat_agua, 'FD', false, 16.50, 9.2, 11.00, 8, 20, false),
    ('TST07', 'TESTE CERVEJA SKOL LATA 350ML C/12', cat_lata, 'FD', false, 38.90, 4.4, 31.00, 300, 40, false),
    ('TST08', 'TESTE REFRI COLA LATA 350ML C/6', cat_lata, 'FD', false, 22.00, 2.2, 16.00, 140, 20, false),
    ('TST09', 'TESTE CACHAÇA 51 965ML', cat_litro, 'LT', false, 15.90, 1.5, 11.20, 96, 12, false),
    ('TST10', 'TESTE WHISKY RED LABEL 1L', cat_litro, 'LT', false, 109.00, 1.6, 84.00, 24, 6, false),
    ('TST11', 'TESTE ARROZ TIPO 1 5KG C/6', cat_cereal, 'FD', false, 152.00, 30.4, 128.00, 45, 10, false),
    ('TST12', 'TESTE FEIJÃO CARIOCA 1KG C/10', cat_cereal, 'FD', false, 79.00, 10.2, 63.00, 0, 8, false)
  ) x(cod, nome, cat, un, meia, preco, peso, custo, est, minimo, ret)
  loop
    insert into produtos (codigo, nome, categoria_id, unidade, permite_meia, preco, peso_kg, estoque_minimo, vasilhame_id)
    values (p.cod, p.nome, p.cat, p.un, p.meia, p.preco, p.peso, p.minimo, case when p.ret then vas end)
    returning id into dono;
    prod := prod || jsonb_build_object(p.cod, dono);
    -- entrada de estoque com valor de compra, como se fosse lançada por um administrador
    select id into adm from perfis where admin and ativo order by criado_em limit 1;
    if p.est > 0 then
      perform set_config('request.jwt.claim.sub', coalesce(adm, v1)::text, true);
      if adm is not null then
        perform entrada_estoque(dono, p.est, 'TESTE - NF 0001 - Fornecedor Teste', p.custo, 0);
      else
        update produtos set estoque = p.est, custo = p.custo where id = dono;
      end if;
    end if;
  end loop;

  -- ---------- 15 clientes: 8 do vendedor1 (rota norte), 7 do vendedor2 (rota sul) ----------
  cli := array[]::uuid[];
  for p in select * from (values
    (1, 'TESTE BAR DO ZÉ LTDA', 'BAR DO ZÉ', 'RUA DAS FLORES', '120', 'MONTESE', '(85) 3333-0001', 1),
    (2, 'TESTE MERCADINHO BOM PREÇO', 'BOM PREÇO', 'AV. JOÃO PESSOA', '1500', 'MONTESE', '(85) 3333-0002', 1),
    (3, 'TESTE LANCHONETE SABOR DA CASA', 'SABOR DA CASA', 'RUA 7 DE SETEMBRO', '45', 'MONTESE', '(85) 3333-0003', 1),
    (4, 'TESTE MERCEARIA DO ZEZINHO', 'ZEZINHO', 'RUA CENTRAL', '88', 'MONTESE', '(85) 3333-0004', 1),
    (5, 'TESTE BAR DA MARIA', 'BAR DA MARIA', 'RUA DO CAMPO', '9', 'PARANGABA', '(85) 3333-0005', 1),
    (6, 'TESTE ADEGA DO PORTUGUÊS', 'ADEGA PORTUGUÊS', 'RUA LISBOA', '33', 'PARANGABA', '(85) 3333-0006', 1),
    (7, 'TESTE DEPÓSITO NORTE', 'DEPÓSITO NORTE', 'AV. NORTE', '880', 'PARANGABA', '(85) 3333-0007', 1),
    (8, 'TESTE BAR DO TIÃO', 'BAR DO TIÃO', 'TRAVESSA DAS PALMEIRAS', '12', 'ITAPERI', '(85) 3333-0008', 1),
    (9, 'TESTE SUPERMERCADO FAMÍLIA', 'SUPER FAMÍLIA', 'AV. SUL', '2100', 'MESSEJANA', '(85) 3333-0009', 2),
    (10, 'TESTE BAR DA ESQUINA', 'BAR DA ESQUINA', 'RUA DO SOL', '5', 'MESSEJANA', '(85) 3333-0010', 2),
    (11, 'TESTE EMPÓRIO SERRANO', 'EMPÓRIO SERRANO', 'ESTRADA DA SERRA', 'KM 12', 'MESSEJANA', '(85) 3333-0011', 2),
    (12, 'TESTE CONVENIÊNCIA 24H', 'CONVENIÊNCIA 24H', 'AV. WASHINGTON SOARES', '3000', 'CAMBEBA', '(85) 3333-0012', 2),
    (13, 'TESTE BOTECO DO ARMANDO', 'BOTECO DO ARMANDO', 'RUA DOS PESCADORES', '77', 'CAMBEBA', '(85) 3333-0013', 2),
    (14, 'TESTE PADARIA PÃO QUENTE', 'PÃO QUENTE', 'RUA DA PADARIA', '10', 'LAGOA REDONDA', '(85) 3333-0014', 2),
    (15, 'TESTE RESTAURANTE SABOR NORDESTINO', 'SABOR NORDESTINO', 'AV. DO CONTORNO', '450', 'LAGOA REDONDA', '(85) 3333-0015', 2)
  ) x(n, razao, fantasia, ende, num, bairro, tel, vend)
  loop
    insert into clientes (codigo, razao_social, nome_fantasia, endereco, numero, bairro, cidade, telefone, rota_id, vendedor_id, ordem_visita)
    values ('TST-C' || lpad(p.n::text, 2, '0'), p.razao, p.fantasia, p.ende, p.num, p.bairro, 'FORTALEZA', p.tel,
            case p.vend when 1 then r_norte else r_sul end, case p.vend when 1 then v1 else v2 end,
            case p.vend when 1 then p.n else p.n - 8 end)
    returning id into dono;
    cli := cli || dono;
  end loop;

  -- ---------- agenda: vendedor1 rota norte de manhã, vendedor2 rota sul de tarde (seg a sáb) ----------
  insert into agenda_visitas (vendedor_id, dia_semana, turno, rota_id)
  select v1, d, 'manha', r_norte from generate_series(1, 6) d
  union all
  select v2, d, 'tarde', r_sul from generate_series(1, 6) d;

  -- ---------- 10 pedidos nesta semana, feitos pelos próprios vendedores ----------
  for p in select * from (values
    -- cliente, vendedor, horas atrás, itens
    (1, 1, 50, '[{"c":"TST01","q":5,"d":3},{"c":"TST07","q":4,"d":0},{"c":"TST09","q":6,"d":0}]', 'Entregar depois das 14h'),
    (2, 1, 48, '[{"c":"TST03","q":10,"d":0},{"c":"TST05","q":8,"d":2},{"c":"TST11","q":2,"d":0}]', null),
    (3, 1, 30, '[{"c":"TST04","q":4,"d":10}]', 'Cliente pediu desconto especial'),
    (4, 1, 26, '[{"c":"TST02","q":2.5,"d":0},{"c":"TST08","q":3,"d":0}]', null),
    (6, 1, 5, '[{"c":"TST10","q":2,"d":0},{"c":"TST09","q":12,"d":5},{"c":"TST07","q":5,"d":0}]', null),
    (9, 2, 52, '[{"c":"TST01","q":20,"d":2},{"c":"TST08","q":10,"d":0},{"c":"TST11","q":3,"d":0}]', 'Pagamento no boleto'),
    (10, 2, 47, '[{"c":"TST02","q":6,"d":0},{"c":"TST03","q":4,"d":0}]', null),
    (12, 2, 28, '[{"c":"TST07","q":15,"d":5},{"c":"TST05","q":10,"d":0}]', null),
    (13, 2, 6, '[{"c":"TST01","q":3.5,"d":0},{"c":"TST09","q":6,"d":0}]', 'Faltou casco na última entrega'),
    (15, 2, 3, '[{"c":"TST04","q":5,"d":0},{"c":"TST10","q":1,"d":0},{"c":"TST11","q":1,"d":0}]', null)
  ) x(cli_n, vend, horas, itens, obs)
  loop
    perform set_config('request.jwt.claim.sub', (case p.vend when 1 then v1 else v2 end)::text, true);
    perform criar_pedido(gen_random_uuid(), cli[p.cli_n],
      (select jsonb_agg(jsonb_build_object('produto_id', prod ->> (it->>'c'), 'quantidade', (it->>'q')::numeric, 'desconto_pct', (it->>'d')::numeric))
         from jsonb_array_elements(p.itens::jsonb) it),
      p.obs, now() - make_interval(hours => p.horas));
  end loop;

  perform set_config('request.jwt.claim.sub', '', true);
  raise notice 'Dados de teste criados: 2 vendedores (vendedor1 e vendedor2, senha teste123), 15 clientes, 12 produtos, 10 pedidos.';
end $$;
