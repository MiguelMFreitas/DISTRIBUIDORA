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
  '[{"produto_id":"30000000-0000-0000-0000-000000000001","quantidade":2.5},
    {"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":3}]') ->> 'status' as st \gset
select pg_temp.ok(:'st' = 'liberado', 'pedido no preço de tabela fica liberado');
select pg_temp.ok((select estoque from produtos where id='30000000-0000-0000-0000-000000000001') = 47.5, 'estoque baixou 2,5 (meia caixa)');
select pg_temp.ok((select total from pedidos where client_id='50000000-0000-0000-0000-000000000001') = 2.5*100 + 3*40, 'total calculado');

-- ---------- 2. reenvio (offline) não duplica ----------
select pg_temp.ok((criar_pedido('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
  '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":1}]') ->> 'duplicado')::boolean, 'reenvio devolve o mesmo pedido');
select pg_temp.ok((select estoque from produtos where id='30000000-0000-0000-0000-000000000002') = 7, 'reenvio não baixa estoque de novo');

-- ---------- 3. desconto acima do limite ----------
select criar_pedido('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002',
  '[{"produto_id":"30000000-0000-0000-0000-000000000003","quantidade":1,"desconto_pct":10}]') ->> 'status' as st \gset
select pg_temp.ok(:'st' = 'aguardando_aprovacao', 'vendedor com desconto aguarda aprovação');

-- ---------- 4. falta de estoque ----------
select pg_temp.como('00000000-0000-0000-0000-00000000000a');   -- administrador: bloqueia
do $$ begin
  perform criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000001',
    '[{"produto_id":"30000000-0000-0000-0000-000000000003","quantidade":99}]');
  raise exception 'FALHOU: deveria bloquear sem estoque';
exception when others then
  if sqlerrm <> 'ESTOQUE_INSUFICIENTE' then raise; end if;
  raise notice 'OK   pedido do administrador sem estoque é bloqueado';
end $$;
select pg_temp.ok((select estoque from produtos where id='30000000-0000-0000-0000-000000000003') = 4, 'pedido bloqueado não mexe no estoque');
select pg_temp.como('00000000-0000-0000-0000-00000000000b');   -- vendedor: vende, mas espera aprovação
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000001',
  '[{"produto_id":"30000000-0000-0000-0000-000000000003","quantidade":6}]') ->> 'id' as psem \gset
select pg_temp.ok((select status from pedidos where id = :'psem') = 'aguardando_aprovacao'
              and (select motivo_aprovacao from pedido_itens where pedido_id = :'psem') = 'sem estoque', 'vendedor vende sem estoque, aguarda aprovação (motivo: sem estoque)');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select recusar_pedido(:'psem');
select pg_temp.ok((select estoque from produtos where id='30000000-0000-0000-0000-000000000003') = 4, 'recusar o pedido sem estoque devolve o estoque');
reset role;   -- limpa para não atrapalhar os próximos testes
delete from estoque_movimentos where pedido_id = :'psem'; delete from pedido_itens where pedido_id = :'psem'; delete from pedidos where id = :'psem';
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000000b');

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


-- ---------- 26. bairros ----------
select pg_temp.ok((select bairro from clientes where id = '40000000-0000-0000-0000-000000000011') = 'MONTESE', 'cliente fica com o nome do bairro no endereço');
reset role;
update rotas set nome = 'MONTESE NOVO' where id = '60000000-0000-0000-0000-000000000001';
set role authenticated;
select pg_temp.ok((select bairro from clientes where id = '40000000-0000-0000-0000-000000000011') = 'MONTESE NOVO', 'renomear o bairro atualiza os clientes');
reset role;
insert into clientes (razao_social, rota_id, bairro) select 'Antigo sem vendedor', '60000000-0000-0000-0000-000000000001', 'X'
  where false; -- (não dá para criar sem vendedor; simula cliente antigo desligando a regra só aqui)
alter table clientes drop constraint clientes_vendedor_obrigatorio;
insert into clientes (id, razao_social, rota_id) values ('40000000-0000-0000-0000-000000000099', 'Antigo sem vendedor', '60000000-0000-0000-0000-000000000001');
alter table clientes add constraint clientes_vendedor_obrigatorio check (vendedor_id is not null) not valid;
update rotas set nome = 'MONTESE' where id = '60000000-0000-0000-0000-000000000001';
set role authenticated;
select pg_temp.ok(true, 'renomear bairro com cliente antigo sem vendedor não trava');


-- ---------- 27. desconto por preço e aprovação produto por produto ----------
reset role;
update produtos set estoque = 100 where id in ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000000b');   -- João, limite 5%
-- cerveja (tabela 100) a R$ 80 = 20% (acima do limite); refri (tabela 40) a R$ 39 = 2,5% (dentro)
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000001',
  '[{"produto_id":"30000000-0000-0000-0000-000000000001","quantidade":2,"preco_unit":80},
    {"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":3,"preco_unit":40}]') ->> 'id' as pp \gset
select pg_temp.ok((select status from pedidos where id = :'pp') = 'aguardando_aprovacao', 'preço abaixo do mínimo deixa o pedido aguardando');
select pg_temp.ok((select desconto_pct from pedido_itens where pedido_id = :'pp' and produto_id = '30000000-0000-0000-0000-000000000001') = 20, 'a % é calculada pelo preço digitado (20%)');
select pg_temp.ok((select precisa_aprovacao from pedido_itens where pedido_id = :'pp' and produto_id = '30000000-0000-0000-0000-000000000001')
              and not (select precisa_aprovacao from pedido_itens where pedido_id = :'pp' and produto_id = '30000000-0000-0000-0000-000000000002'), 'só o produto com preço mudado precisa de aprovação');
do $$ begin
  perform aprovar_item((select id from pedido_itens where precisa_aprovacao limit 1));
  raise exception 'FALHOU: vendedor aprovou produto';
exception when insufficient_privilege then raise notice 'OK   vendedor não aprova produto';
end $$;
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select recusar_item((select id from pedido_itens where pedido_id = :'pp' and produto_id = '30000000-0000-0000-0000-000000000001'));
select pg_temp.ok((select status from pedidos where id = :'pp') = 'liberado', 'recusar o único produto pendente libera o pedido');
select pg_temp.ok((select count(*) from pedido_itens where pedido_id = :'pp') = 1 and (select total from pedidos where id = :'pp') = 120, 'recusar apaga só aquele produto e recalcula o total (3 × 40)');
select pg_temp.ok((select estoque from produtos where id = '30000000-0000-0000-0000-000000000001') = 100, 'estoque do produto recusado voltou');
-- dois produtos pendentes: edita um, aprova o outro
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000001',
  '[{"produto_id":"30000000-0000-0000-0000-000000000001","quantidade":2,"preco_unit":70},
    {"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":3,"preco_unit":30}]') ->> 'id' as pq \gset
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok(editar_item((select id from pedido_itens where pedido_id = :'pq' and produto_id = '30000000-0000-0000-0000-000000000001'), 3, 96) = 'aguardando_aprovacao', 'editar um produto: pedido segue aguardando o outro');
select pg_temp.ok((select estoque from produtos where id = '30000000-0000-0000-0000-000000000001') = 97, 'editar a quantidade ajusta o estoque (2 → 3)');
select pg_temp.ok(aprovar_item((select id from pedido_itens where pedido_id = :'pq' and produto_id = '30000000-0000-0000-0000-000000000002')) = 'liberado', 'aprovar o último pendente libera o pedido');
select pg_temp.ok((select total from pedidos where id = :'pq') = 3 * 96 + 3 * 30, 'total do pedido com o produto editado');
-- preço mínimo do cadastro do produto vale mesmo dentro da % do vendedor
reset role;
update produtos set preco_minimo = 99 where id = '30000000-0000-0000-0000-000000000001';
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000001',
  '[{"produto_id":"30000000-0000-0000-0000-000000000001","quantidade":1,"preco_unit":97}]') ->> 'status' = 'aguardando_aprovacao' as r \gset
select pg_temp.ok(:'r', 'vendedor com qualquer preço diferente da tabela vai para aprovação');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000001',
  '[{"produto_id":"30000000-0000-0000-0000-000000000001","quantidade":1,"preco_unit":50}]') ->> 'status' = 'liberado' as r \gset
select pg_temp.ok(:'r', 'administrador vende abaixo do mínimo sem aprovação (o app pede a senha)');
reset role;
update produtos set preco_minimo = null where id = '30000000-0000-0000-0000-000000000001';
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000001',
  '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":1,"preco_unit":41}]') ->> 'status' = 'aguardando_aprovacao' as r \gset
select pg_temp.ok(:'r', 'vendedor aumentando o preço também espera aprovação');

-- ---------- 28. entrega de moto e balcão ----------
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000001',
  '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":1}]', null, null, null, 'balcao') ->> 'id' as pbal \gset
select pg_temp.ok((select status = 'entregue' and entregue_em is not null from pedidos where id = :'pbal'), 'pedido de balcão já nasce entregue');
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000001',
  '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":1}]', null, null, null, 'moto') ->> 'id' as pmoto \gset
select pg_temp.ok((select status = 'liberado' and entrega = 'moto' from pedidos where id = :'pmoto'), 'pedido de moto fica esperando a entrega');
select entregar_moto(:'pmoto');
select pg_temp.ok((select status from pedidos where id = :'pmoto') = 'entregue', 'moto: marcar entregue');
select entregar_moto(:'pmoto', false);
select pg_temp.ok((select status from pedidos where id = :'pmoto') = 'liberado', 'moto: desfazer entregue');
select pg_temp.ok(mudar_entrega(:'pmoto', 'balcao') = 'entregue', 'mudar entrega para balcão entrega na hora');
-- vendedor faz pedido de balcão com preço mudado: só entrega depois de aprovar
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000001',
  '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":1,"preco_unit":35}]', null, null, null, 'balcao') ->> 'id' as pb2 \gset
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select aprovar_item((select id from pedido_itens where pedido_id = :'pb2'));
select pg_temp.ok((select status from pedidos where id = :'pb2') = 'entregue', 'balcão aprovado fica entregue');
select pg_temp.ok(cliente_balcao() = cliente_balcao(), 'cliente CONSUMIDOR BALCÃO é criado uma vez só');
-- usuário só com a permissão "moto" vê os pedidos de moto (e não os outros)
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000001',
  '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":1}]', null, null, null, 'moto');
reset role;
update perfis set permissoes = '{moto}' where id = '00000000-0000-0000-0000-00000000000c';
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from pedidos where entrega = 'moto') = 1 and (select count(*) from pedidos where entrega <> 'moto' and vendedor_id <> auth.uid()) = 0, 'entregador de moto vê só os pedidos de moto');
select entregar_moto((select id from pedidos where entrega = 'moto' and status = 'liberado'));
select pg_temp.ok((select count(*) from pedidos where entrega = 'moto' and status = 'entregue') = 1, 'entregador marca entregue');


-- ---------- 29. mais de um bairro no mesmo período ----------
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select salvar_agenda('00000000-0000-0000-0000-00000000000b', '[
  {"dia":4,"turno":"manha","rota_id":"60000000-0000-0000-0000-000000000001"},
  {"dia":4,"turno":"manha","rota_id":"60000000-0000-0000-0000-000000000002"},
  {"dia":4,"turno":"manha","rota_id":"60000000-0000-0000-0000-000000000002"}]');
select pg_temp.ok((select count(*) from agenda_visitas where vendedor_id = '00000000-0000-0000-0000-00000000000b' and dia_semana = 4 and turno = 'manha') = 2, 'dois bairros na mesma manhã (repetido conta uma vez)');


-- ---------- 30. link de pedidos (cliente sem login) ----------
reset role;
update produtos set estoque = 50 where id = '30000000-0000-0000-0000-000000000002';
set role anon;
select pg_temp.como('');
select pg_temp.ok((loja_catalogo() ->> 'ligado')::boolean and jsonb_array_length(loja_catalogo() -> 'produtos') >= 3, 'catálogo do link abre sem login');
select pg_temp.ok(not (loja_catalogo() -> 'produtos' -> 0 ? 'custo') and not (loja_catalogo() -> 'produtos' -> 0 ? 'estoque'), 'catálogo não mostra custo nem estoque');
select loja_pedido('70000000-0000-0000-0000-000000000001', 'Maria da Silva', '(85) 99999-1111', 'Rua A, 10', 'Centro', 'perto da praça',
  'dinheiro', 200, 'tocar a campainha', '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":2}]') ->> 'numero' as nlink \gset
reset role;
select pg_temp.ok((select status = 'liberado' and entrega = 'moto' and origem = 'link' and vendedor_id = 'f0000000-0000-4000-8000-00000000c0de'
                     and contato_telefone = '85999991111' and contato_nome = 'MARIA DA SILVA' and troco_para = 200 and total = 80
                   from pedidos where numero = :nlink), 'pedido do link: liberado, moto, conta para o vendedor do link, guarda contato e troco');
select pg_temp.ok((select count(*) from clientes where razao_social = 'MARIA DA SILVA') = 0, 'cliente do link não é cadastrado');
select pg_temp.ok((select estoque from produtos where id = '30000000-0000-0000-0000-000000000002') = 48, 'pedido do link baixa o estoque');
set role anon;
select pg_temp.ok((loja_pedido('70000000-0000-0000-0000-000000000001', 'Maria da Silva', '85999991111', 'Rua A, 10', 'Centro', null,
  'pix', null, null, '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":2}]') ->> 'duplicado')::boolean, 'reenvio do link não duplica');
do $$ begin
  perform loja_pedido(gen_random_uuid(), 'Zé', '85999990000', 'Rua B, 1', 'Centro', null, 'dinheiro', 10, null,
    '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":2}]');
  raise exception 'FALHOU: troco menor que o total';
exception when others then
  if sqlerrm like 'FALHOU%' then raise; end if;
  raise notice 'OK   troco menor que o total é recusado';
end $$;
do $$ begin
  perform loja_pedido(gen_random_uuid(), 'Zé', '85999990000', 'Rua B, 1', 'Centro', null, 'cartao', null, null,
    '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":1}]');
  raise exception 'FALHOU: aceitou cartão';
exception when others then
  if sqlerrm like 'FALHOU%' then raise; end if;
  raise notice 'OK   link não aceita cartão';
end $$;
do $$ begin
  perform loja_pedido(gen_random_uuid(), 'Zé', '85999990000', 'Rua B, 1', 'Centro', null, 'pix', null, null,
    '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":999}]');
  raise exception 'FALHOU: vendeu sem estoque pelo link';
exception when others then
  if sqlerrm like 'FALHOU%' then raise; end if;
  raise notice 'OK   link não vende sem estoque (%)', sqlerrm;
end $$;
do $$ begin
  perform 1 from pedidos;
  raise exception 'FALHOU: anônimo leu pedidos';
exception when insufficient_privilege then raise notice 'OK   quem abre o link não lê os pedidos';
end $$;
do $$ begin
  perform marcar_link_visto(gen_random_uuid());
  raise exception 'FALHOU: anônimo chamou função do escritório';
exception when insufficient_privilege then raise notice 'OK   quem abre o link não mexe no escritório';
end $$;
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select marcar_link_visto((select id from pedidos where numero = :nlink));
select cadastrar_cliente_do_link((select id from pedidos where numero = :nlink)) as cli \gset
select pg_temp.ok((select razao_social from clientes where id = :'cli') = 'MARIA DA SILVA'
              and (select cliente_id from pedidos where numero = :nlink) = :'cli', 'escritório cadastra o cliente do link com um botão');
reset role;
update configuracoes set valor = jsonb_set(valor, '{ligado}', 'false') where chave = 'link_pedidos';
set role anon;
do $$ begin
  perform loja_pedido(gen_random_uuid(), 'Zé', '85999990000', 'Rua B, 1', 'Centro', null, 'pix', null, null,
    '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":1}]');
  raise exception 'FALHOU: link desligado aceitou pedido';
exception when others then
  if sqlerrm like 'FALHOU%' then raise; end if;
  raise notice 'OK   link desligado não aceita pedido';
end $$;
reset role;


-- ---------- 31. abastecimento ----------
reset role;
update perfis set permissoes = '{abastecimento}' where id = '00000000-0000-0000-0000-00000000000d';
insert into veiculos (id, nome, placa, marca_km) values
  ('80000000-0000-0000-0000-000000000001', 'STRADA', 'ABC1D23', true),
  ('80000000-0000-0000-0000-000000000002', 'CAMINHÃO VELHO', 'XYZ9A99', false);
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select registrar_abastecimento(p_veiculo => '80000000-0000-0000-0000-000000000001', p_data => current_date - 7, p_km => 10000, p_valor => 300, p_preco_litro => 6, p_litros => null, p_combustivel => null, p_foto_painel => 'a/1.jpg', p_foto_km => 'a/1k.jpg');
select registrar_abastecimento(p_veiculo => '80000000-0000-0000-0000-000000000001', p_data => current_date, p_km => 10450, p_valor => 250, p_preco_litro => 6.25, p_litros => null, p_combustivel => null, p_foto_painel => 'a/2.jpg', p_foto_km => 'a/2k.jpg') as ab2 \gset
select pg_temp.ok((select litros from abastecimentos where id = :'ab2') = 40, 'litros calculados (250 ÷ 6,25 = 40)');
do $$ begin
  perform registrar_abastecimento('80000000-0000-0000-0000-000000000001', current_date, 10400, 100, 6, null, null, 'a/3.jpg', 'a/3k.jpg');
  raise exception 'FALHOU: aceitou km menor';
exception when others then
  if sqlerrm like 'FALHOU%' then raise; end if;
  raise notice 'OK   km menor que a anterior é recusada';
end $$;
do $$ begin
  perform registrar_abastecimento('80000000-0000-0000-0000-000000000001', current_date, 10500, 100, 6, null, null, 'a/3.jpg', null);
  raise exception 'FALHOU: aceitou sem foto da km';
exception when others then
  if sqlerrm like 'FALHOU%' then raise; end if;
  raise notice 'OK   carro que marca km exige a foto da km';
end $$;
select registrar_abastecimento('80000000-0000-0000-0000-000000000002', current_date, 99999, 200, 6, null, null, 'b/1.jpg', 'b/1k.jpg') as ab3 \gset
select pg_temp.ok((select km is null and foto_km is null from abastecimentos where id = :'ab3'), 'carro que não marca km: guarda sem km');
select relatorio_abastecimentos(current_date - 30, current_date) as rel \gset
select pg_temp.ok((:'rel'::jsonb ->> 'total_valor')::numeric = 750, 'relatório soma o valor (300 + 250 + 200)');
select pg_temp.ok(((:'rel'::jsonb -> 'lista') -> 1 ->> 'km_litro')::numeric = 11.25, 'km por litro (450 km ÷ 40 L = 11,25)');
select pg_temp.ok((select count(*) from veiculos) >= 2, 'quem abastece vê os carros');
insert into veiculos (nome, placa) values ('MOTO CG', 'MOT0A00');
select pg_temp.ok(true, 'quem abastece cadastra carro');
do $$ begin
  perform 1 from pedidos;
  if (select count(*) from pedidos) > 0 then raise exception 'FALHOU: abastecedor vê pedidos'; end if;
  raise notice 'OK   quem só abastece não vê pedidos';
end $$;
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform registrar_abastecimento('80000000-0000-0000-0000-000000000001', current_date, 11000, 100, 6, null, null, 'x', 'y');
  raise exception 'FALHOU: vendedor abasteceu';
exception when insufficient_privilege then raise notice 'OK   vendedor não lança abastecimento';
end $$;
select pg_temp.ok((select count(*) from abastecimentos) = 0, 'vendedor não vê abastecimentos');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select apagar_abastecimento(:'ab3');
select pg_temp.ok((select count(*) from abastecimentos) = 2, 'administrador apaga abastecimento');
reset role;


-- ---------- 32. combustível e "dois de três" ----------
reset role;
insert into veiculos (id, nome, placa, combustiveis) values ('80000000-0000-0000-0000-000000000003', 'GOL FLEX', 'FLX1A11', '{etanol,gasolina}');
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
-- valor + litros → preço calculado
select registrar_abastecimento('80000000-0000-0000-0000-000000000003', current_date - 3, 50000, 200, null, 40, 'etanol', 'f/1.jpg', 'f/1k.jpg') as f1 \gset
select pg_temp.ok((select preco_litro = 5 and litros = 40 and combustivel = 'etanol' from abastecimentos where id = :'f1'), 'valor + litros: preço do litro calculado (R$ 5,00)');
-- preço + litros → valor calculado
select registrar_abastecimento('80000000-0000-0000-0000-000000000003', current_date - 2, 50300, null, 6.2, 30, 'gasolina', 'f/2.jpg', 'f/2k.jpg') as f2 \gset
select pg_temp.ok((select valor = 186 from abastecimentos where id = :'f2'), 'preço + litros: valor calculado (R$ 186,00)');
-- valor + preço → litros calculado
select registrar_abastecimento('80000000-0000-0000-0000-000000000003', current_date - 1, 50600, 120, 6, null, 'gasolina', 'f/3.jpg', 'f/3k.jpg') as f3 \gset
select pg_temp.ok((select litros = 20 from abastecimentos where id = :'f3'), 'valor + preço: litros calculados (20 L)');
do $$ begin
  perform registrar_abastecimento('80000000-0000-0000-0000-000000000003', current_date, 50900, 100, null, null, 'gasolina', 'x', 'y');
  raise exception 'FALHOU: aceitou só um campo';
exception when others then
  if sqlerrm like 'FALHOU%' then raise; end if;
  raise notice 'OK   precisa de dois dos três campos';
end $$;
do $$ begin
  perform registrar_abastecimento('80000000-0000-0000-0000-000000000003', current_date, 50900, 100, 6, null, 'diesel', 'x', 'y');
  raise exception 'FALHOU: aceitou diesel no flex';
exception when others then
  if sqlerrm like 'FALHOU%' then raise; end if;
  raise notice 'OK   combustível que o carro não usa é recusado';
end $$;
do $$ begin
  perform registrar_abastecimento('80000000-0000-0000-0000-000000000003', current_date, 50900, 100, 6, null, null, 'x', 'y');
  raise exception 'FALHOU: aceitou sem combustível';
exception when others then
  if sqlerrm like 'FALHOU%' then raise; end if;
  raise notice 'OK   carro com combustível cadastrado exige escolher';
end $$;
select relatorio_abastecimentos(current_date - 5, current_date) -> 'por_combustivel' as pc \gset
select pg_temp.ok((select count(*) from jsonb_array_elements(:'pc'::jsonb) e where e->>'combustivel' in ('etanol', 'gasolina')) = 2
              and (select (e->>'valor')::numeric from jsonb_array_elements(:'pc'::jsonb) e where e->>'combustivel' = 'gasolina') = 306, 'relatório separa por combustível (gasolina R$ 306)');
reset role;
do $$ begin
  update veiculos set combustiveis = '{querosene}' where id = '80000000-0000-0000-0000-000000000003';
  raise exception 'FALHOU: aceitou combustível inválido no carro';
exception when check_violation then raise notice 'OK   carro só aceita etanol, gasolina, diesel ou gás';
end $$;


-- ---------- 33. códigos automáticos em ordem de criação ----------
reset role;
select coalesce(max(codigo::bigint), 0) as ultp from produtos where codigo ~ '^[0-9]+$' \gset
insert into produtos (nome, unidade, preco) values ('TESTE COD A', 'UN', 1) returning codigo as ca \gset
insert into produtos (nome, unidade, preco, codigo) values ('TESTE COD MANUAL', 'UN', 1, (:ultp + 2)::text);
insert into produtos (nome, unidade, preco) values ('TESTE COD B', 'UN', 1) returning codigo as cb \gset
insert into produtos (nome, unidade, preco, codigo) values ('TESTE COD C', 'UN', 1, '') returning codigo as cc \gset
select pg_temp.ok(:'ca'::bigint = :ultp + 1, 'produto novo recebe o próximo número');
select pg_temp.ok(:'cb'::bigint = :ultp + 3, 'número digitado à mão é pulado (não repete)');
select pg_temp.ok(:'cc'::bigint = :ultp + 4, 'código vazio também vira número');
select pg_temp.ok((select count(*) from produtos where codigo is null) = 0 and (select count(*) from clientes where codigo is null) = 0, 'todos os produtos e clientes têm código');
insert into clientes (razao_social, vendedor_id) values ('TESTE CLIENTE COD', '00000000-0000-0000-0000-00000000000b') returning codigo as cl \gset
select pg_temp.ok(:'cl' ~ '^[0-9]+$', 'cliente novo recebe número');


-- ---------- 34. clube de pontos ----------
reset role;
update produtos set estoque = 200 where id in ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');
update perfis set permissoes = '{pedidos_criar}' where id = '00000000-0000-0000-0000-00000000000b';
delete from configuracoes where chave = 'clube';
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
-- WhatsApp do cliente fica só com números e com 55
update clientes set whatsapp = '(85) 99999-1111' where id = '40000000-0000-0000-0000-000000000001';
select pg_temp.ok((select whatsapp from clientes where id = '40000000-0000-0000-0000-000000000001') = '5585999991111', 'WhatsApp do cliente guardado como 5585999991111');
-- desafio: 2 fardos de refri no período = +50
insert into desafios (titulo, inicio, fim, produtos, meta, bonus)
values ('Refri em dobro', current_date - 1, current_date + 10, '{30000000-0000-0000-0000-000000000002}', 2, 50) returning id as des \gset
-- pedido do robô: 3 refri a R$ 40 = 120
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000001',
  '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":3}]') ->> 'id' as pa \gset
reset role; update pedidos set origem = 'whatsapp' where id = :'pa'; set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
-- voltou 1 refri
select devolver_item((select id from pedido_itens where pedido_id = :'pa'), 1);
select pg_temp.ok((select total_devolvido from pedidos where id = :'pa') = 40, 'item que voltou: R$ 40 a menos no pedido');
select marcar_pago(:'pa', 'pix') ->> 'pontos' as pts \gset
select pg_temp.ok(:pts = 80, 'pagou R$ 80 (120 − 40 que voltou) = 80 pontos');
select pg_temp.ok((select vence_em from pontos_movimentos where pedido_id = :'pa' and tipo = 'compra') = (current_date + interval '3 months')::date, 'pontos vencem em 3 meses');
select pg_temp.ok((extrato_pontos('40000000-0000-0000-0000-000000000001') ->> 'saldo')::int = 130, 'desafio cumprido: +50 (saldo 130)');
do $$ begin
  perform marcar_pago((select id from pedidos where origem = 'whatsapp' limit 1), 'pix');
  raise exception 'FALHOU: recebeu duas vezes';
exception when others then if sqlerrm like 'FALHOU%' then raise; end if; raise notice 'OK   não recebe o mesmo pedido duas vezes';
end $$;
-- pedido que não é do robô não ganha pontos
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000001',
  '[{"produto_id":"30000000-0000-0000-0000-000000000002","quantidade":1}]') ->> 'id' as pn \gset
select pg_temp.ok((marcar_pago(:'pn', 'dinheiro') ->> 'pontos')::int = 0, 'pedido feito fora do robô não ganha pontos');
-- prêmio: 1 refri = 100 pontos
insert into premios (produto_id, quantidade, pontos) values ('30000000-0000-0000-0000-000000000002', 1, 100) returning id as prm \gset
select trocar_pontos('40000000-0000-0000-0000-000000000001', :'prm') as trc \gset
select pg_temp.ok((extrato_pontos('40000000-0000-0000-0000-000000000001') ->> 'saldo')::int = 30, 'trocou 100 pontos (saldo 30)');
do $$ begin
  perform trocar_pontos('40000000-0000-0000-0000-000000000001', (select id from premios limit 1));
  raise exception 'FALHOU: trocou sem pontos';
exception when others then if sqlerrm like 'FALHOU%' then raise; end if; raise notice 'OK   não troca sem pontos suficientes (%)', sqlerrm;
end $$;
-- o próximo pedido leva o prêmio de graça
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000001',
  '[{"produto_id":"30000000-0000-0000-0000-000000000001","quantidade":1}]') ->> 'id' as pb \gset
select pg_temp.ok((select count(*) from pedido_itens where pedido_id = :'pb' and troca_id = :'trc' and total = 0) = 1
              and (select total from pedidos where id = :'pb') = 100, 'prêmio foi de graça no próximo pedido (total só da cerveja)');
select pg_temp.ok((select status from trocas_pontos where id = :'trc') = 'no_pedido', 'troca ficou no pedido');
select cancelar_pedido(:'pb');
select pg_temp.ok((select status = 'pendente' and pedido_id is null from trocas_pontos where id = :'trc'), 'pedido cancelado: o prêmio espera o próximo pedido');
select cancelar_troca(:'trc');
select pg_temp.ok((extrato_pontos('40000000-0000-0000-0000-000000000001') ->> 'saldo')::int = 130, 'troca cancelada: pontos de volta (130)');
-- vencimento: um lote antigo vence sozinho
reset role;
insert into pontos_movimentos (cliente_id, tipo, pontos, restante, vence_em, descricao)
values ('40000000-0000-0000-0000-000000000001', 'ajuste', 20, 20, current_date - 1, 'lote velho');
set role authenticated;
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok((extrato_pontos('40000000-0000-0000-0000-000000000001') ->> 'saldo')::int = 130, 'lote velho não entra no saldo');
select pg_temp.ok(exists (select 1 from pontos_movimentos where tipo = 'vencimento' and pontos = -20), 'pontos com 3 meses vencem (só o lote velho)');
-- voltou mais 1 refri depois de pago: tira 40 pontos
select devolver_item((select id from pedido_itens where pedido_id = :'pa'), 1);
select pg_temp.ok((select pontos_ganhos = 40 and valor_pago = 40 from pedidos where id = :'pa')
              and (extrato_pontos('40000000-0000-0000-0000-000000000001') ->> 'saldo')::int = 90, 'devolução depois de pago tira os pontos (saldo 90)');
select desfazer_pago(:'pa');
select pg_temp.ok((extrato_pontos('40000000-0000-0000-0000-000000000001') ->> 'saldo')::int = 50 and (select pago_em is null from pedidos where id = :'pa'), 'recebimento desfeito: pontos saem');
select marcar_pago(:'pa', 'dinheiro');
-- níveis: meta de quantidade = 1 fardo, Prata com 1 meta
insert into configuracoes (chave, valor) values ('clube', '{"quantidade_minima": 1, "metas_prata": 1, "metas_ouro": 4}')
  on conflict (chave) do update set valor = excluded.valor;
select calcular_niveis((current_date + interval '1 month')::date);
select pg_temp.ok((select nivel from clube_niveis where cliente_id = '40000000-0000-0000-0000-000000000001' and mes = date_trunc('month', current_date + interval '1 month')::date) = 'prata', 'quem bateu 1 meta no mês vira Prata no mês seguinte');
select pg_temp.ok((select nivel from clube_niveis where cliente_id = '40000000-0000-0000-0000-000000000003' and mes = date_trunc('month', current_date + interval '1 month')::date) = 'bronze', 'quem não comprou pelo robô fica Bronze');
-- conferência: devolução escolhendo o cliente
select criar_pedido(gen_random_uuid(), '40000000-0000-0000-0000-000000000001',
  '[{"produto_id":"30000000-0000-0000-0000-000000000001","quantidade":2}]') ->> 'id' as pc \gset
insert into cargas (turno) values ('tarde') returning id as cg \gset
select definir_pedidos_carga(:'cg', array[:'pc'::uuid]);
select saida_carga(:'cg');
select finalizar_conferencia(:'cg', json_build_array(json_build_object('tipo', 'devolvido', 'pedido_item_id', (select id from pedido_itens where pedido_id = :'pc'), 'quantidade', 1))::jsonb);
select pg_temp.ok((select total_devolvido from pedidos where id = :'pc') = 100 and (select status from pedidos where id = :'pc') = 'entregue'
              and (select pedido_id from conferencia_itens where carga_id = :'cg') = :'pc', 'conferência: item devolvido fica no pedido do cliente');
-- vendedor não recebe nem troca
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform marcar_pago(gen_random_uuid(), 'pix');
  raise exception 'FALHOU: vendedor recebeu';
exception when insufficient_privilege then raise notice 'OK   vendedor não marca pedido como pago';
end $$;
do $$ begin
  perform trocar_pontos('40000000-0000-0000-0000-000000000001', gen_random_uuid());
  raise exception 'FALHOU: vendedor trocou pontos';
exception when insufficient_privilege then raise notice 'OK   vendedor não troca pontos';
end $$;
reset role;


-- ---------- 35. identificação do cliente ----------
reset role;
update clientes set contato = 'Marcos' where id = '40000000-0000-0000-0000-000000000001';
select pg_temp.ok((select identificacao = 'Marcos ' || codigo || ' (' || razao_social || ')' from clientes where id = '40000000-0000-0000-0000-000000000001'), 'identificação: contato + código + (razão social)');
insert into clientes (razao_social, nome_fantasia, vendedor_id) values ('MERCADINHO NOVO LTDA', 'MERCADINHO NOVO', '00000000-0000-0000-0000-00000000000b') returning identificacao as idn, codigo as cdn \gset
select pg_temp.ok(:'idn' = 'MERCADINHO NOVO ' || :'cdn' || ' (MERCADINHO NOVO LTDA)', 'sem contato: usa o nome fantasia, com o código novo');

\warn '>>> TODOS OS TESTES PASSARAM'
