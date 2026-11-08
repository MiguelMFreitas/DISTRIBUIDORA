\set ON_ERROR_STOP on
\set QUIET on
-- ---------- dados ----------
insert into auth.users (id) values
 ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'), ('00000000-0000-0000-0000-00000000000c');
insert into perfis (id, nome, usuario, admin, permissoes, desconto_max) values
 ('00000000-0000-0000-0000-00000000000a', 'Miguel', 'miguel', true, '{}', 0),
 ('00000000-0000-0000-0000-00000000000b', 'João Vendedor', 'joao', false, '{pedidos_criar}', 5),
 ('00000000-0000-0000-0000-00000000000c', 'Ana Vendedora', 'ana', false, '{pedidos_criar}', 3);
insert into categorias (id, nome, ordem) values
 ('10000000-0000-0000-0000-000000000001', 'Caixas de vasilhame', 1),
 ('10000000-0000-0000-0000-000000000002', 'Refrigerante 2L', 2),
 ('10000000-0000-0000-0000-000000000009', 'Cereais', 9);
insert into vasilhames (id, nome) values ('20000000-0000-0000-0000-000000000001', 'Engradado 600ml');
insert into produtos (id, nome, categoria_id, unidade, permite_meia, preco, peso_kg, estoque, vasilhame_id) values
 ('30000000-0000-0000-0000-000000000001', 'Cerveja 600ml retornável', '10000000-0000-0000-0000-000000000001', 'CX', true, 100, 20, 50, '20000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000002', 'Refri Cola 2L', '10000000-0000-0000-0000-000000000002', 'FD', false, 40, 12.5, 10, null),
 ('30000000-0000-0000-0000-000000000003', 'Arroz 5kg', '10000000-0000-0000-0000-000000000009', 'FD', false, 150, 30, 5, null);
insert into clientes (id, razao_social) values ('40000000-0000-0000-0000-000000000001', 'Bar do Zé'), ('40000000-0000-0000-0000-000000000002', 'Mercado Bom Preço');

create function pg_temp.como(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false) $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond then raise notice 'OK   %', msg; else raise exception 'FALHOU: %', msg; end if; end $$;

set role authenticated;

-- ---------- 1. pedido normal ----------
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select criar_pedido('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
  '[{"produto_id":"30000000-0000-0000-0000-000000000001","quantidade":2.5,"desconto_pct":5},
    {"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":3}]') ->> 'status' as st \gset
select pg_temp.ok(:'st' = 'liberado', 'pedido com desconto dentro do limite fica liberado');
select pg_temp.ok((select estoque from produtos where id='30000000-0000-0000-0000-000000000001') = 47.5, 'estoque baixou 2,5 (meia caixa)');
select pg_temp.ok((select total from pedidos where client_id='50000000-0000-0000-0000-000000000001') = 2.5*95 + 3*40, 'total calculado com desconto');

-- ---------- 2. reenvio (offline) não duplica ----------
select pg_temp.ok((criar_pedido('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
  '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":1}]') ->> 'duplicado')::boolean, 'reenvio devolve o mesmo pedido');
select pg_temp.ok((select estoque from produtos where id='30000000-0000-0000-0000-000000000002') = 7, 'reenvio não baixa estoque de novo');

-- ---------- 3. desconto acima do limite ----------
select criar_pedido('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002',
  '[{"produto_id":"30000000-0000-0000-0000-000000000003","quantidade":1,"desconto_pct":10}]') ->> 'status' as st \gset
select pg_temp.ok(:'st' = 'aguardando_aprovacao', 'desconto acima do limite aguarda aprovação');

-- ---------- 4. falta de estoque ----------
do $$ begin
  perform criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000001',
    '[{"produto_id":"30000000-0000-0000-0000-000000000003","quantidade":99}]');
  raise exception 'FALHOU: deveria bloquear sem estoque';
exception when others then
  if sqlerrm <> 'ESTOQUE_INSUFICIENTE' then raise; end if;
  raise notice 'OK   pedido sem estoque é bloqueado';
end $$;
select pg_temp.ok((select estoque from produtos where id='30000000-0000-0000-0000-000000000003') = 4, 'pedido bloqueado não mexe no estoque');

-- ---------- 5. meia caixa só onde é permitido ----------
do $$ begin
  perform criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000001',
    '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":1.5}]');
  raise exception 'FALHOU: meio fardo não permitido';
exception when others then
  if sqlerrm not like 'Quantidade inválida%' then raise; end if;
  raise notice 'OK   meio fardo bloqueado em produto sem meia';
end $$;

-- ---------- 6. vendedor não mexe direto no banco ----------
do $$ begin
  update produtos set estoque = 999;
  raise exception 'FALHOU: vendedor alterou estoque';
exception when insufficient_privilege then raise notice 'OK   vendedor não altera estoque direto';
end $$;
do $$ begin
  insert into pedidos (cliente_id) values ('40000000-0000-0000-0000-000000000001');
  raise exception 'FALHOU: vendedor inseriu pedido direto';
exception when insufficient_privilege then raise notice 'OK   vendedor não insere pedido direto';
end $$;

-- ---------- 7. vendedora só vê os próprios pedidos ----------
select pg_temp.como('00000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from pedidos) = 0, 'Ana não vê pedidos do João');
select criar_pedido('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000002',
  '[{"produto_id":"30000000-0000-0000-0000-000000000001","quantidade":4}]') ->> 'status' as st \gset
select pg_temp.ok((select count(*) from pedidos) = 1, 'Ana vê o pedido dela');

-- ---------- 8. aprovação ----------
do $$ begin
  perform aprovar_pedido((select id from pedidos limit 1));
  raise exception 'FALHOU: vendedora aprovou';
exception when insufficient_privilege then raise notice 'OK   vendedor não aprova pedido';
end $$;
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select count(*) from pedidos) = 3, 'admin vê todos os pedidos');
select aprovar_pedido((select id from pedidos where client_id='50000000-0000-0000-0000-000000000002'));
select pg_temp.ok((select status from pedidos where client_id='50000000-0000-0000-0000-000000000002') = 'liberado', 'admin aprova');

-- ---------- 9. carga e romaneio ----------
insert into cargas (turno) values ('manha') returning id as carga \gset
select definir_pedidos_carga(:'carga', array(select id from pedidos));
select pg_temp.ok((select count(*) from pedidos where carga_id = :'carga') = 3, '3 pedidos na carga');
select pg_temp.ok((select string_agg(produto, ' | ' order by categoria_ordem, produto) from romaneio_itens(:'carga'))
  = 'Cerveja 600ml retornável | Refri Cola 2L | Arroz 5kg', 'romaneio na ordem das categorias');
select pg_temp.ok((select quantidade from romaneio_itens(:'carga') where produto like 'Cerveja%') = 6.5, 'romaneio soma 2,5 + 4 = 6,5 cx');
select pg_temp.ok((select sum(peso_kg) from romaneio_itens(:'carga')) = 6.5*20 + 3*12.5 + 1*30, 'peso total da carga');
select pg_temp.ok((select quantidade from vasilhames_esperados(:'carga')) = 6.5, 'vasilhames esperados');

-- ---------- 10. saída e conferência ----------
select saida_carga(:'carga');
select pg_temp.ok((select count(*) from pedidos where status='carregado') = 3, 'pedidos ficam carregados');
do $$ begin
  perform cancelar_pedido((select id from pedidos limit 1));
  raise exception 'FALHOU: cancelou pedido carregado';
exception when others then
  if sqlerrm not like 'Só dá para cancelar%' then raise; end if;
  raise notice 'OK   não cancela pedido que já saiu';
end $$;
select finalizar_conferencia(:'carga',
  '[{"tipo":"vasilhame","vasilhame_id":"20000000-0000-0000-0000-000000000001","quantidade":6},
    {"tipo":"devolvido","produto_id":"30000000-0000-0000-0000-000000000002","quantidade":1},
    {"tipo":"troca","produto_id":"30000000-0000-0000-0000-000000000001","quantidade":1}]', 'faltou meio casco');
select pg_temp.ok((select estoque from produtos where id='30000000-0000-0000-0000-000000000002') = 8, 'devolvido volta ao estoque');
select pg_temp.ok((select count(*) from pedidos where status='entregue') = 3, 'pedidos entregues após conferência');
select pg_temp.ok((select status from cargas where id=:'carga') = 'conferida', 'carga conferida');

-- ---------- 11. cancelamento devolve estoque ----------
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000001',
  '[{"produto_id":"30000000-0000-0000-0000-000000000003","quantidade":2}]') ->> 'id' as pid \gset
select cancelar_pedido(:'pid');
select pg_temp.ok((select estoque from produtos where id='30000000-0000-0000-0000-000000000003') = 4, 'cancelar devolve estoque');

-- ---------- 12. ranking ----------
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select clientes from ranking_vendedores(current_date - 6, current_date) where vendedor = 'João Vendedor') = 2, 'ranking: João atendeu 2 clientes');
select pg_temp.ok((select valor from ranking_vendedores(current_date - 6, current_date) where vendedor = 'Ana Vendedora') = 400, 'ranking: Ana vendeu R$ 400');

-- ---------- 13. entrada e ajuste ----------
select entrada_estoque('30000000-0000-0000-0000-000000000003', 10, 'NF 123');
select ajustar_estoque('30000000-0000-0000-0000-000000000003', 12, 'contagem');
select pg_temp.ok((select estoque from produtos where id='30000000-0000-0000-0000-000000000003') = 12, 'entrada e ajuste de estoque');
select pg_temp.ok((select count(*) from estoque_movimentos where produto_id='30000000-0000-0000-0000-000000000003') = 5, 'histórico registra cada movimento');


-- ---------- 14. escritório lança pedido no nome do vendedor ----------
reset role;
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000d');
insert into perfis (id, nome, usuario, admin, permissoes, desconto_max) values
 ('00000000-0000-0000-0000-00000000000d', 'Escritório', 'escritorio', false, '{pedidos_ver_todos}', 0);
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000002',
  '[{"produto_id":"30000000-0000-0000-0000-000000000003","quantidade":1}]', null, null,
  '00000000-0000-0000-0000-00000000000b') ->> 'id' as pid \gset
select pg_temp.ok((select vendedor_id from pedidos where id = :'pid') = '00000000-0000-0000-0000-00000000000b', 'escritório lança pedido no nome do João');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok((criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000002',
  '[{"produto_id":"30000000-0000-0000-0000-000000000003","quantidade":1,"desconto_pct":20}]') ->> 'status') = 'liberado', 'administrador faz pedido com qualquer desconto');
select pg_temp.como('00000000-0000-0000-0000-00000000000c');
do $$ begin
  perform criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000002',
    '[{"produto_id":"30000000-0000-0000-0000-000000000003","quantidade":1}]', null, null, '00000000-0000-0000-0000-00000000000b');
  raise exception 'FALHOU: vendedora lançou no nome de outro';
exception when insufficient_privilege then raise notice 'OK   vendedor não lança pedido no nome de outro';
end $$;

\warn '>>> TODOS OS TESTES PASSARAM'
