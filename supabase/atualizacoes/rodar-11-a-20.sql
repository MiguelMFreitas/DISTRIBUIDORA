-- =====================================================================
-- ATUALIZAÇÕES 11 A 20 (exceto a 16) EM UM ARQUIVO SÓ
-- Cole tudo no SQL Editor do Supabase e clique em Run (Correr).
-- Pode rodar mesmo que alguma já tenha sido rodada.
-- =====================================================================

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
