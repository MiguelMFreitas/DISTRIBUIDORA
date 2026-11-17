-- =====================================================================
-- APAGA SÓ OS DADOS DE TESTE  (cole tudo no SQL Editor do Supabase e clique em Run)
--
-- O que é teste (foi criado pelo criar-dados-de-teste.sql):
--   * vendedores: vendedor1 (Carlos Teste) e vendedor2 (Paula Teste)
--   * clientes com código TST-C.. ("TESTE BAR DO ZÉ" etc.)
--   * produtos com código TST01..TST12 ("TESTE CERVEJA ..." etc.)
--   * pedidos desses clientes ou feitos por esses vendedores, e os recibos desses clientes
--   * bairros/rotas, veículos, motoristas e vasilhame com "TESTE" no começo do nome
--
-- O que é SEU fica:
--   * seus clientes, produtos, pedidos, cargas, recibos, usuários e abastecimentos
--   * se um pedido seu tinha um produto de teste, sai só aquele produto do pedido
--   * se um cliente seu estava com um vendedor de teste, ele passa para o administrador
--   * o estoque dos seus produtos volta a ficar como se os testes não tivessem existido
--   * bairro/veículo de teste que você passou a usar (com cliente seu ou abastecimento) fica
--
-- Pode rodar mais de uma vez: na segunda não acha mais nada.
-- =====================================================================
do $$
declare
  v_admin  uuid := (select id from perfis where admin and ativo and usuario not in ('vendedor1', 'vendedor2')
                     order by criado_em limit 1);
  vends    uuid[] := array(select id from perfis where usuario in ('vendedor1', 'vendedor2'));
  clis     uuid[] := array(select id from clientes where codigo like 'TST-C%');
  prods    uuid[] := array(select id from produtos where codigo ~ '^TST[0-9]');
  peds     uuid[];
  cargas_t uuid[];
  afetados uuid[];
  n_ped int; n_cli int; n_prod int; n_itens int; n_rec int; n_carga int; n_vend int;
  mv record;
begin
  -- pedidos de teste: de cliente de teste ou feitos por vendedor de teste
  peds := array(select id from pedidos where cliente_id = any (clis) or vendedor_id = any (vends));
  -- cargas que só tinham pedidos de teste
  cargas_t := array(select c.id from cargas c
                     where exists (select 1 from pedidos p where p.carga_id = c.id and p.id = any (peds))
                       and not exists (select 1 from pedidos p where p.carga_id = c.id and not (p.id = any (peds))));

  -- 1) desfaz no estoque dos SEUS produtos o que os testes mexeram (vendas, cancelamentos, devoluções)
  for mv in select m.produto_id, sum(m.quantidade) as q from estoque_movimentos m
            where (m.pedido_id = any (peds) or m.carga_id = any (cargas_t)) and not (m.produto_id = any (prods))
            group by m.produto_id loop
    update produtos set estoque = estoque - mv.q where id = mv.produto_id;
  end loop;
  delete from estoque_movimentos where pedido_id = any (peds) or carga_id = any (cargas_t) or produto_id = any (prods);

  -- 2) pedidos SEUS com produto de teste: tira só o produto de teste e refaz o total
  afetados := array(select distinct pedido_id from pedido_itens where produto_id = any (prods) and not (pedido_id = any (peds)));
  delete from pedido_itens where produto_id = any (prods) and pedido_id = any (afetados);
  get diagnostics n_itens = row_count;
  update pedidos p set total   = coalesce((select sum(total) from pedido_itens where pedido_id = p.id), 0),
                       peso_kg = coalesce((select sum(peso_kg) from pedido_itens where pedido_id = p.id), 0)
   where p.id = any (afetados);
  -- pedido seu que só tinha produto de teste ficou vazio: sai também
  peds := peds || array(select a from unnest(afetados) a where not exists (select 1 from pedido_itens i where i.pedido_id = a));

  -- 3) cargas, conferências, recibos e pedidos de teste
  delete from conferencia_itens where carga_id = any (cargas_t) or produto_id = any (prods)
                                   or vasilhame_id in (select id from vasilhames where nome like 'TESTE %');
  delete from cargas where id = any (cargas_t);                              -- conferências saem junto
  get diagnostics n_carga = row_count;
  delete from recibos where cliente_id = any (clis) or recebemos_de like 'TESTE %';
  get diagnostics n_rec = row_count;
  delete from pedidos where id = any (peds);                                 -- itens saem junto
  get diagnostics n_ped = row_count;

  -- 4) clientes e produtos de teste
  delete from clientes where id = any (clis);
  get diagnostics n_cli = row_count;
  delete from produtos where id = any (prods);
  get diagnostics n_prod = row_count;

  -- 5) seus clientes/bairros que estavam com vendedor de teste: passam para o administrador
  update clientes set vendedor_id = v_admin where vendedor_id = any (vends);
  update rotas set vendedor_id = null where vendedor_id = any (vends);
  delete from agenda_visitas where vendedor_id = any (vends);

  -- 6) bairros, veículos, motoristas e vasilhame de teste (se você não passou a usar)
  delete from agenda_visitas where rota_id in (select id from rotas r where r.nome like 'TESTE %'
                                                  and not exists (select 1 from clientes c where c.rota_id = r.id));
  delete from rotas r where r.nome like 'TESTE %' and not exists (select 1 from clientes c where c.rota_id = r.id);
  delete from veiculos v where v.nome like 'TESTE %' and not exists (select 1 from abastecimentos a where a.veiculo_id = v.id);
  delete from motoristas where nome like 'TESTE %';
  delete from vasilhames v where v.nome like 'TESTE %' and not exists (select 1 from produtos p where p.vasilhame_id = v.id);

  -- 7) os vendedores de teste (o login deles some junto)
  delete from auth.users where id = any (vends);
  get diagnostics n_vend = row_count;

  raise notice 'Apagado: % pedido(s), % cliente(s), % produto(s), % recibo(s), % carga(s), % vendedor(es). % produto(s) de teste tirados de pedidos seus.',
    n_ped, n_cli, n_prod, n_rec, n_carga, n_vend, n_itens;
end $$;

-- confira: tem que dar tudo zero
select (select count(*) from clientes where codigo like 'TST-C%')              as clientes_teste,
       (select count(*) from produtos where codigo ~ '^TST[0-9]')               as produtos_teste,
       (select count(*) from perfis where usuario in ('vendedor1', 'vendedor2')) as vendedores_teste;
