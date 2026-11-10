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
insert into clientes (id, razao_social, vendedor_id) values
 ('40000000-0000-0000-0000-000000000001', 'Bar do Zé', '00000000-0000-0000-0000-00000000000b'),
 ('40000000-0000-0000-0000-000000000002', 'Mercado Bom Preço', '00000000-0000-0000-0000-00000000000b'),
 ('40000000-0000-0000-0000-000000000003', 'Adega da Ana', '00000000-0000-0000-0000-00000000000c');

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
select criar_pedido('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003',
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


-- ---------- 15. financeiro ----------
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform _mover_estoque('30000000-0000-0000-0000-000000000001', 999, 'ajuste');
  raise exception 'FALHOU: vendedor chamou função interna de estoque';
exception when insufficient_privilege then raise notice 'OK   vendedor não chama a função interna de estoque';
end $$;
do $$ begin
  perform relatorio_financeiro(current_date - 6, current_date);
  raise exception 'FALHOU: vendedor viu o financeiro';
exception when insufficient_privilege then raise notice 'OK   vendedor não vê o financeiro';
end $$;
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
-- entrada: 10 fardos de arroz a R$ 100, com R$ 50 de desconto -> custo 95
select entrada_estoque('30000000-0000-0000-0000-000000000003', 10, 'NF 555 - Fornecedor X', 100, 50);
select pg_temp.ok((select custo from produtos where id='30000000-0000-0000-0000-000000000003') = 95, 'entrada com desconto: custo de 1 un = R$ 95');
select pg_temp.ok((select valor_total from estoque_movimentos where observacao = 'NF 555 - Fornecedor X') = 950, 'entrada registra o valor total R$ 950');
-- venda guarda o custo
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000001',
  '[{"produto_id":"30000000-0000-0000-0000-000000000003","quantidade":2,"desconto_pct":10}]') ->> 'id' as pfin \gset
select pg_temp.ok((select custo_unit from pedido_itens where pedido_id = :'pfin') = 95, 'venda guarda o custo do item');
select pg_temp.ok((select valor_total from estoque_movimentos where pedido_id = :'pfin' and tipo = 'venda') = 270, 'saída por venda registra R$ 270 (2 × 135)');
-- saída manual por avaria, pelo custo
select saida_estoque('30000000-0000-0000-0000-000000000003', 1, 'Avaria', 'Saco rasgado');
select pg_temp.ok((select valor_total from estoque_movimentos where motivo = 'Avaria') = 95, 'saída manual registra o valor pelo custo');
-- relatório
select relatorio_financeiro(current_date - 6, current_date) as rel \gset
select pg_temp.ok((:'rel'::jsonb #>> '{resumo,descontos}')::numeric > 0, 'relatório soma os descontos dados');
select pg_temp.ok((:'rel'::jsonb #>> '{resumo,compras}')::numeric >= 950, 'relatório soma as compras');
select pg_temp.ok((:'rel'::jsonb #>> '{resumo,saidas_manuais}')::numeric = 95, 'relatório soma as saídas manuais');
select pg_temp.ok(jsonb_array_length(:'rel'::jsonb -> 'por_dia') = 7, 'relatório tem os 7 dias da semana');
select pg_temp.ok((select (x->>'lucro')::numeric from jsonb_array_elements(:'rel'::jsonb -> 'produtos') x where x->>'produto' = 'Arroz 5kg')
  = (select sum(i.total - i.custo_unit * i.quantidade) from pedido_itens i join pedidos p on p.id = i.pedido_id
     where i.produto_id = '30000000-0000-0000-0000-000000000003' and p.status in ('liberado','carregado','entregue')), 'lucro por produto = venda − custo');


-- ---------- 16. recibos ----------
insert into recibos (valor, recebemos_de, referente) values (350.50, 'BAR DO ZÉ', 'Pedido 1') returning numero as rec \gset
select pg_temp.ok(:'rec'::int >= 1, 'admin emite recibo numerado');
select pg_temp.ok(((relatorio_financeiro(current_date - 6, current_date)) #>> '{resumo,recebimentos}')::numeric = 350.50, 'recibo entra no relatório como recebimento');
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
do $$ begin
  insert into recibos (valor, recebemos_de) values (10, 'X');
  raise exception 'FALHOU: vendedor emitiu recibo';
exception when insufficient_privilege then raise notice 'OK   vendedor não emite recibo';
end $$;
select pg_temp.ok((select count(*) from recibos) = 0, 'vendedor não vê recibos');


-- ---------- 17. desempenho dos vendedores ----------
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select desempenho_vendedores(current_date, current_date) as des \gset
select pg_temp.ok((select (x->>'caixas')::numeric from jsonb_array_elements(:'des'::jsonb -> 'vendedores') x where x->>'nome' = 'Ana Vendedora') = 4, 'desempenho: Ana vendeu 4 caixas hoje');
select pg_temp.ok((select (x->>'clientes')::int from jsonb_array_elements(:'des'::jsonb -> 'vendedores') x where x->>'nome' = 'João Vendedor') = 2, 'desempenho: João atendeu 2 clientes');
select pg_temp.ok((select sum((x->>'quantidade')::numeric) from jsonb_array_elements(:'des'::jsonb -> 'produtos') x
  where x->>'produto' = 'Cerveja 600ml retornável' and x->>'vendedor_id' = '00000000-0000-0000-0000-00000000000c') = 4, 'desempenho por produto: Ana, 4 cx de cerveja');
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform desempenho_vendedores(current_date, current_date);
  raise exception 'FALHOU: vendedor viu o desempenho de todos';
exception when insufficient_privilege then raise notice 'OK   vendedor não vê o desempenho dos outros';
end $$;


-- ---------- 18. número da carga recomeça por dia ----------
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
insert into cargas (data, turno) values (current_date + 10, 'manha'), (current_date + 10, 'tarde'), (current_date + 11, 'manha');
select pg_temp.ok((select array_agg(numero_dia order by numero) from cargas where data = current_date + 10) = '{1,2}', 'cargas do mesmo dia: 1 e 2');
select pg_temp.ok((select numero_dia from cargas where data = current_date + 11) = 1, 'dia seguinte começa na carga 1');


-- ---------- 19. impressão automática ----------
reset role;
update pedidos set impresso_em = null where status = 'liberado';
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select count(*) as livres from pedidos where status = 'liberado' \gset
select pg_temp.ok((select count(*) from pegar_pedidos_para_imprimir(now() - interval '1 day')) = :livres, 'pega todos os liberados sem imprimir');
select pg_temp.ok((select count(*) from pegar_pedidos_para_imprimir(now() - interval '1 day')) = 0, 'na segunda vez não pega de novo (não imprime duas vezes)');
select pg_temp.ok(pedidos_sem_imprimir(now() - interval '1 day') = 0, 'nenhum esperando depois de pegar');
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform pegar_pedidos_para_imprimir(now());
  raise exception 'FALHOU: vendedor pegou pedidos para imprimir';
exception when insufficient_privilege then raise notice 'OK   vendedor não usa a impressão automática';
end $$;


-- ---------- 20. roteiro de visitas ----------
reset role;
insert into rotas (id, nome) values ('60000000-0000-0000-0000-000000000001', 'MONTESE');
insert into clientes (id, razao_social, rota_id, vendedor_id) values
 ('40000000-0000-0000-0000-000000000011', 'Cliente A', '60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c'),
 ('40000000-0000-0000-0000-000000000012', 'Cliente B', '60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c'),
 ('40000000-0000-0000-0000-000000000013', 'Cliente C', '60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c');
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select salvar_ordem_visitas('60000000-0000-0000-0000-000000000001',
  array['40000000-0000-0000-0000-000000000013','40000000-0000-0000-0000-000000000011','40000000-0000-0000-0000-000000000012']::uuid[]);
select pg_temp.ok((select string_agg(razao_social, ',' order by ordem_visita) from clientes where rota_id = '60000000-0000-0000-0000-000000000001') = 'Cliente C,Cliente A,Cliente B', 'roteiro salvo na ordem escolhida');
select definir_vendedor_rota('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', true);
select pg_temp.ok((select vendedor_id from rotas where id = '60000000-0000-0000-0000-000000000001') = '00000000-0000-0000-0000-00000000000b', 'rota passa para o João');
select pg_temp.ok((select count(*) from clientes where rota_id = '60000000-0000-0000-0000-000000000001' and vendedor_id = '00000000-0000-0000-0000-00000000000b') = 3, 'clientes da rota vão para a carteira do João');
select definir_vendedor_rota('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', false);
select pg_temp.ok((select string_agg(razao_social, ',' order by ordem_visita) from clientes where rota_id = '60000000-0000-0000-0000-000000000001') = 'Cliente C,Cliente A,Cliente B', 'novo vendedor segue a mesma ordem');
do $$ begin
  perform salvar_ordem_visitas('60000000-0000-0000-0000-000000000001', array['40000000-0000-0000-0000-000000000001']::uuid[]);
  raise exception 'FALHOU: aceitou cliente de outra rota';
exception when others then
  if sqlerrm not like 'Há cliente%' then raise; end if;
  raise notice 'OK   não aceita cliente de outra rota no roteiro';
end $$;
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform salvar_ordem_visitas('60000000-0000-0000-0000-000000000001', array[]::uuid[]);
  raise exception 'FALHOU: vendedor mudou o roteiro';
exception when insufficient_privilege then raise notice 'OK   vendedor não muda o roteiro';
end $$;


-- ---------- 21. alerta de clientes sem pedido ----------
-- a rota MONTESE está com a Ana (teste 20); o admin lança pedido para o Cliente A
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000011',
  '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":1}]') ->> 'id' as palerta \gset
select pg_temp.como('00000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select array_agg(x) from clientes_do_roteiro_com_pedido(current_date) x) = array['40000000-0000-0000-0000-000000000011']::uuid[],
  'Ana vê que o Cliente A tem pedido (lançado pelo escritório)');
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from clientes_do_roteiro_com_pedido(current_date)) = 0, 'João não recebe clientes de rota que não é dele');


-- ---------- 22. ranking de clientes ----------
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select pedidos from ranking_clientes(current_date - 6, current_date) where cliente_id = '40000000-0000-0000-0000-000000000001')
  = (select count(*) from pedidos where cliente_id = '40000000-0000-0000-0000-000000000001' and status not in ('cancelado','recusado')), 'ranking de clientes: vezes que o Bar do Zé comprou');
select pg_temp.ok((select valor from ranking_clientes(current_date - 6, current_date) where cliente_id = '40000000-0000-0000-0000-000000000002')
  = (select sum(total) from pedidos where cliente_id = '40000000-0000-0000-0000-000000000002' and status not in ('cancelado','recusado')), 'ranking de clientes: valor do Mercado');
select pg_temp.ok((select itens from ranking_clientes(current_date - 6, current_date) where cliente_id = '40000000-0000-0000-0000-000000000002')
  = (select sum(i.quantidade) from pedido_itens i join pedidos p on p.id = i.pedido_id where p.cliente_id = '40000000-0000-0000-0000-000000000002' and p.status not in ('cancelado','recusado')), 'ranking de clientes: itens do Mercado');
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform ranking_clientes(current_date, current_date);
  raise exception 'FALHOU: vendedor viu ranking de clientes';
exception when insufficient_privilege then raise notice 'OK   vendedor não vê o ranking de clientes';
end $$;


-- ---------- 23. carteira de clientes ----------
select pg_temp.como('00000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from clientes where vendedor_id <> '00000000-0000-0000-0000-00000000000c'
  and not (rota_id = any (rotas_do_vendedor('00000000-0000-0000-0000-00000000000c')))) = 0, 'Ana só enxerga os clientes dela e os das rotas em que trabalha');
select pg_temp.ok((select count(*) from clientes where id = '40000000-0000-0000-0000-000000000001') = 0, 'Ana não enxerga cliente do João fora das rotas dela');
do $$ begin
  perform criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000001',
    '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":1}]');
  raise exception 'FALHOU: Ana vendeu para cliente do João';
exception when insufficient_privilege then
  if sqlerrm not like 'Este cliente é do vendedor%' then raise; end if;
  raise notice 'OK   vendedor não faz pedido para cliente de outro vendedor';
end $$;
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000003',
  '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":1}]') ->> 'id' as pesc \gset
select pg_temp.ok((select vendedor_id from pedidos where id = :'pesc') = '00000000-0000-0000-0000-00000000000a', 'administrador vende para cliente da Ana e a venda é dele');
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000003',
  '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":1}]', null, null, '00000000-0000-0000-0000-00000000000c') ->> 'id' as pdono \gset
select pg_temp.ok((select vendedor_id from pedidos where id = :'pdono') = '00000000-0000-0000-0000-00000000000c', 'administrador pode creditar ao dono do cliente (Ana)');
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000003',
  '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":1}]', null, null, '00000000-0000-0000-0000-00000000000b') ->> 'id' as pterc \gset
select pg_temp.ok((select vendedor_id from pedidos where id = :'pterc') = '00000000-0000-0000-0000-00000000000b', 'administrador pode creditar a qualquer vendedor (cliente da Ana para o João)');
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000003',
  '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":1}]') ->> 'id' as pesc2 \gset
select pg_temp.ok((select vendedor_id from pedidos where id = :'pesc2') = '00000000-0000-0000-0000-00000000000c', 'escritório (não admin) lança no nome do dono do cliente');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
do $$ begin
  perform criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000003',
    '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":1}]', null, null, '00000000-0000-0000-0000-00000000000b');
  raise exception 'FALHOU: escritório (não admin) lançou cliente da Ana no nome do João';
exception when insufficient_privilege then raise notice 'OK   escritório (não admin) não lança cliente da Ana no nome do João';
end $$;
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
do $$ begin
  insert into clientes (razao_social) values ('Sem dono');
  raise exception 'FALHOU: cadastrou cliente sem vendedor';
exception when check_violation then raise notice 'OK   não cadastra cliente sem vendedor';
end $$;


-- ---------- 24. agenda de visitas ----------
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
reset role;
insert into rotas (id, nome) values ('60000000-0000-0000-0000-000000000002', 'CENTRO TESTE');
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
-- MONTESE é da Ana (teste 20); CENTRO TESTE não tem vendedor
select salvar_agenda('00000000-0000-0000-0000-00000000000c', '[
  {"dia":1,"turno":"manha","rota_id":"60000000-0000-0000-0000-000000000001"},
  {"dia":1,"turno":"tarde","rota_id":"60000000-0000-0000-0000-000000000002"},
  {"dia":2,"turno":"manha","rota_id":"60000000-0000-0000-0000-000000000001"}]');
select pg_temp.ok((select count(*) from agenda_visitas where vendedor_id = '00000000-0000-0000-0000-00000000000c') = 3, 'agenda da Ana salva (3 períodos)');
select pg_temp.ok((select vendedor_id from rotas where id = '60000000-0000-0000-0000-000000000002') = '00000000-0000-0000-0000-00000000000c', 'rota sem vendedor passa a ser da Ana');
-- MONTESE é da Ana; agora o João também trabalha nela (bairro compartilhado)
select salvar_agenda('00000000-0000-0000-0000-00000000000b', '[{"dia":3,"turno":"manha","rota_id":"60000000-0000-0000-0000-000000000001"}]');
select pg_temp.ok((select vendedor_id from rotas where id = '60000000-0000-0000-0000-000000000001') = '00000000-0000-0000-0000-00000000000c', 'rota compartilhada continua com a Ana como responsável');
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from clientes where rota_id = '60000000-0000-0000-0000-000000000001') = 3, 'João vê todos os clientes da MONTESE (bairro compartilhado)');
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000012',
  '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":1}]') ->> 'id' as pcomp \gset
select pg_temp.ok((select vendedor_id from pedidos where id = :'pcomp') = '00000000-0000-0000-0000-00000000000b', 'João vende para cliente da MONTESE e a venda é dele');
select pg_temp.como('00000000-0000-0000-0000-00000000000c');
select pg_temp.ok('40000000-0000-0000-0000-000000000012'::uuid in (select clientes_do_roteiro_com_pedido(current_date)), 'para a Ana, o cliente que comprou com o João já tem pedido');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select salvar_agenda('00000000-0000-0000-0000-00000000000c', '[{"dia":5,"turno":"tarde","rota_id":"60000000-0000-0000-0000-000000000001"}]');
select pg_temp.ok((select count(*) from agenda_visitas where vendedor_id = '00000000-0000-0000-0000-00000000000c') = 1, 'salvar de novo substitui a semana inteira');
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform salvar_agenda('00000000-0000-0000-0000-00000000000b', '[]');
  raise exception 'FALHOU: vendedor mudou a agenda';
exception when insufficient_privilege then raise notice 'OK   vendedor não muda a agenda';
end $$;


-- ---------- 25. dois vendedores, mesmo cliente, mesmo dia ----------
select pg_temp.como('00000000-0000-0000-0000-00000000000c');
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000012',
  '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":1}]') ->> 'id' as pdois \gset
select pg_temp.ok((select count(distinct vendedor) from pedidos_do_roteiro(current_date) where cliente_id = '40000000-0000-0000-0000-000000000012') = 2,
  'Cliente B tem pedido do João e da Ana no mesmo dia, cada um no seu nome');
select pg_temp.ok((select bool_or(meu) and not bool_and(meu) from pedidos_do_roteiro(current_date) where cliente_id = '40000000-0000-0000-0000-000000000012'),
  'a Ana sabe qual pedido é dela e qual é do João');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');

\warn '>>> TODOS OS TESTES PASSARAM'
