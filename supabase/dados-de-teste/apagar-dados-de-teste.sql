-- =====================================================================
-- APAGA SÓ OS DADOS DE TESTE criados por criar-dados-de-teste.sql
-- (vendedor1, vendedor2, clientes TST-C.., produtos TST.., rotas/veículos/
-- motoristas/vasilhame com TESTE no nome e os pedidos desses clientes).
-- Os seus cadastros reais não são tocados.
-- =====================================================================
do $$
declare
  vends uuid[] := array(select id from perfis where usuario in ('vendedor1', 'vendedor2'));
  clis  uuid[] := array(select id from clientes where codigo like 'TST-C%');
  prods uuid[] := array(select id from produtos where codigo like 'TST%' and codigo not like 'TST-C%');
  peds  uuid[];
begin
  peds := array(select id from pedidos where cliente_id = any (clis) or exists (
                  select 1 from pedido_itens i where i.pedido_id = pedidos.id and i.produto_id = any (prods)));

  -- cargas que só tinham pedidos de teste (e as conferências delas)
  delete from cargas c where exists (select 1 from pedidos p where p.carga_id = c.id and p.id = any (peds))
                         and not exists (select 1 from pedidos p where p.carga_id = c.id and not (p.id = any (peds)));
  delete from conferencia_itens where produto_id = any (prods) or vasilhame_id in (select id from vasilhames where nome like 'TESTE %');
  delete from recibos where cliente_id = any (clis);
  delete from estoque_movimentos where pedido_id = any (peds) or produto_id = any (prods);
  delete from pedidos where id = any (peds);                -- itens saem junto
  delete from clientes where id = any (clis);
  delete from produtos where id = any (prods);
  delete from agenda_visitas where vendedor_id = any (vends) or rota_id in (select id from rotas where nome like 'TESTE %');
  delete from rotas where nome like 'TESTE %';
  delete from veiculos where nome like 'TESTE %';
  delete from motoristas where nome like 'TESTE %';
  delete from vasilhames where nome like 'TESTE %';
  delete from auth.users where id = any (vends);            -- perfis saem junto
  raise notice 'Dados de teste apagados.';
end $$;
