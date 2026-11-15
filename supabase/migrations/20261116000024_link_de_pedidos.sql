-- =====================================================================
-- Link de pedidos: o cliente abre um link (sem login), escolhe os produtos,
-- informa nome, telefone e endereço, escolhe dinheiro (com ou sem troco) ou Pix
-- e finaliza. O pedido:
--   * entra LIBERADO, marcado como "pelo link", para entrega de MOTO
--     (o escritório pode mudar para caminhão e pôr num romaneio)
--   * conta para o "vendedor" 🔗 Pedidos pelo link
--   * não cadastra o cliente: os dados ficam só no pedido
--     (o escritório pode cadastrar depois, com um botão)
-- =====================================================================

-- ---------- o "vendedor" do link ----------
do $$
declare
  v_id uuid := 'f0000000-0000-4000-8000-00000000c0de';
  v_email text := 'link-de-pedidos@usuarios.distribuidora.app';
begin
  if not exists (select 1 from auth.users where id = v_id) then
    if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'aud') then
      -- usuário sem senha e sem e-mail confirmado: ninguém entra com ele
      execute format($f$insert into auth.users (id, instance_id, email, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
                       values (%L, '00000000-0000-0000-0000-000000000000', %L, 'authenticated', 'authenticated', '{"provider":"email","providers":["email"]}', '{}', now(), now())$f$, v_id, v_email);
    else
      insert into auth.users (id, email) values (v_id, v_email);
    end if;
  end if;
  insert into public.perfis (id, nome, usuario, admin, permissoes, ativo)
  values (v_id, '🔗 Pedidos pelo link', 'link-de-pedidos', false, '{}', true)
  on conflict (id) do nothing;
end $$;

-- ---------- cliente genérico (os dados de verdade ficam no pedido) ----------
insert into public.clientes (id, razao_social, vendedor_id, observacao)
values ('f0000000-0000-4000-8000-00000000c11e', 'PEDIDOS PELO LINK', 'f0000000-0000-4000-8000-00000000c0de',
        'Cliente automático dos pedidos feitos pelo link. Não apague.')
on conflict (id) do nothing;

-- ---------- dados do pedido feito pelo link ----------
alter table public.pedidos add column if not exists origem text not null default 'sistema';
alter table public.pedidos drop constraint if exists pedidos_origem_check;
alter table public.pedidos add constraint pedidos_origem_check check (origem in ('sistema', 'link'));
alter table public.pedidos add column if not exists contato_nome text;
alter table public.pedidos add column if not exists contato_telefone text;
alter table public.pedidos add column if not exists contato_endereco text;
alter table public.pedidos add column if not exists contato_bairro text;
alter table public.pedidos add column if not exists contato_referencia text;
alter table public.pedidos add column if not exists pagamento text;
alter table public.pedidos drop constraint if exists pedidos_pagamento_check;
alter table public.pedidos add constraint pedidos_pagamento_check check (pagamento is null or pagamento in ('dinheiro', 'pix'));
alter table public.pedidos add column if not exists troco_para numeric(12,2);
alter table public.pedidos add column if not exists visto_em timestamptz;   -- quando o escritório olhou
create index if not exists pedidos_link_nao_visto on public.pedidos (feito_em) where origem = 'link' and visto_em is null;

-- ---------- configuração do link ----------
create table if not exists public.configuracoes (
  chave text primary key,
  valor jsonb not null
);
alter table public.configuracoes enable row level security;
revoke all on public.configuracoes from anon;
drop policy if exists configuracoes_ler on public.configuracoes;
create policy configuracoes_ler on public.configuracoes for select to authenticated using (true);
drop policy if exists configuracoes_gravar on public.configuracoes;
create policy configuracoes_gravar on public.configuracoes for all to authenticated using (eh_admin()) with check (eh_admin());
grant select, insert, update on public.configuracoes to authenticated;
insert into public.configuracoes (chave, valor)
values ('link_pedidos', '{"ligado": true, "aviso": "Faça seu pedido! Entregamos no seu endereço."}')
on conflict (chave) do nothing;

-- ---------- catálogo público (sem login) ----------
create or replace function public.loja_catalogo()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ligado', coalesce((select (valor->>'ligado')::boolean from configuracoes where chave = 'link_pedidos'), false),
    'aviso', (select valor->>'aviso' from configuracoes where chave = 'link_pedidos'),
    'produtos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'nome', p.nome, 'unidade', p.unidade, 'permite_meia', p.permite_meia, 'preco', p.preco,
               'categoria', c.nome, 'ordem', coalesce(c.ordem, 999), 'esgotado', p.estoque <= 0)
             order by coalesce(c.ordem, 999), p.nome)
        from produtos p left join categorias c on c.id = p.categoria_id
       where p.ativo and p.preco > 0), '[]'::jsonb))
$$;

-- ---------- o cliente finaliza o pedido ----------
create or replace function public.loja_pedido(
  p_client_id uuid, p_nome text, p_telefone text, p_endereco text, p_bairro text,
  p_referencia text, p_pagamento text, p_troco_para numeric, p_observacao text, p_itens jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_vendedor constant uuid := 'f0000000-0000-4000-8000-00000000c0de';
  v_cliente  constant uuid := 'f0000000-0000-4000-8000-00000000c11e';
  v_pedido pedidos;
  v_prod   produtos;
  v_item   record;
  v_total  numeric := 0;
  v_peso   numeric := 0;
  v_tel    text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
begin
  if not coalesce((select (valor->>'ligado')::boolean from configuracoes where chave = 'link_pedidos'), false) then
    raise exception 'Os pedidos pelo link estão fechados no momento.';
  end if;
  if p_client_id is null then raise exception 'Pedido inválido.'; end if;
  select * into v_pedido from pedidos where client_id = p_client_id;
  if found then
    return jsonb_build_object('numero', v_pedido.numero, 'total', v_pedido.total, 'duplicado', true);
  end if;

  if length(trim(coalesce(p_nome, ''))) < 2 or length(p_nome) > 80 then raise exception 'Informe o seu nome.'; end if;
  if length(v_tel) < 10 or length(v_tel) > 13 then raise exception 'Informe o telefone com DDD.'; end if;
  if length(trim(coalesce(p_endereco, ''))) < 5 or length(p_endereco) > 200 then raise exception 'Informe o endereço com o número.'; end if;
  if length(trim(coalesce(p_bairro, ''))) < 2 or length(p_bairro) > 80 then raise exception 'Informe o bairro.'; end if;
  if length(coalesce(p_referencia, '')) > 200 or length(coalesce(p_observacao, '')) > 500 then raise exception 'Texto muito grande.'; end if;
  if p_pagamento not in ('dinheiro', 'pix') then raise exception 'Escolha dinheiro ou Pix.'; end if;

  -- proteção contra abuso: no máximo 5 pedidos por telefone por hora e 300 por hora no total
  if (select count(*) from pedidos where origem = 'link' and contato_telefone = v_tel and feito_em > now() - interval '1 hour') >= 5
     or (select count(*) from pedidos where origem = 'link' and feito_em > now() - interval '1 hour') >= 300 then
    raise exception 'Muitos pedidos seguidos. Tente de novo mais tarde ou ligue para nós.';
  end if;

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Escolha pelo menos um produto.';
  end if;
  if jsonb_array_length(p_itens) > 60 then raise exception 'Produtos demais em um pedido.'; end if;
  if (select count(*) <> count(distinct e->>'produto_id') from jsonb_array_elements(p_itens) e) then
    raise exception 'Há produto repetido no pedido.';
  end if;

  perform 1 from produtos
   where id in (select (e->>'produto_id')::uuid from jsonb_array_elements(p_itens) e)
   order by id for update;

  for v_item in select (e->>'produto_id')::uuid as produto_id, (e->>'quantidade')::numeric as qtd from jsonb_array_elements(p_itens) e loop
    select * into v_prod from produtos where id = v_item.produto_id and ativo and preco > 0;
    if not found then raise exception 'Um dos produtos não está mais disponível. Atualize a página.'; end if;
    if v_item.qtd is null or v_item.qtd <= 0 or v_item.qtd > 999 or not _quantidade_valida(v_prod, v_item.qtd) then
      raise exception 'Quantidade inválida para %.', v_prod.nome;
    end if;
    if v_prod.estoque < v_item.qtd then
      raise exception 'Acabou o estoque de % (tem %). Diminua a quantidade ou tire o produto.', v_prod.nome,
        replace(regexp_replace(greatest(v_prod.estoque, 0)::text, '\.0+$', ''), '.', ',');
    end if;
    v_total := v_total + round(v_prod.preco * v_item.qtd, 2);
  end loop;
  if p_pagamento = 'dinheiro' and p_troco_para is not null and p_troco_para < v_total then
    raise exception 'O troco tem que ser para um valor maior que o total do pedido.';
  end if;

  insert into pedidos (client_id, cliente_id, vendedor_id, status, entrega, origem, observacao, feito_em,
                       contato_nome, contato_telefone, contato_endereco, contato_bairro, contato_referencia, pagamento, troco_para)
  values (p_client_id, v_cliente, v_vendedor, 'liberado', 'moto', 'link', nullif(trim(p_observacao), ''), now(),
          upper(trim(p_nome)), v_tel, upper(trim(p_endereco)), upper(trim(p_bairro)), nullif(upper(trim(p_referencia)), ''),
          p_pagamento, case when p_pagamento = 'dinheiro' then p_troco_para end)
  returning * into v_pedido;

  for v_item in select (e->>'produto_id')::uuid as produto_id, (e->>'quantidade')::numeric as qtd from jsonb_array_elements(p_itens) e loop
    select * into v_prod from produtos where id = v_item.produto_id;
    insert into pedido_itens (pedido_id, produto_id, quantidade, preco_tabela, desconto_pct, preco_unit, total, peso_kg, custo_unit)
    values (v_pedido.id, v_prod.id, v_item.qtd, v_prod.preco, 0, v_prod.preco, round(v_prod.preco * v_item.qtd, 2), v_prod.peso_kg * v_item.qtd, v_prod.custo);
    v_peso := v_peso + v_prod.peso_kg * v_item.qtd;
    perform _mover_estoque(v_prod.id, -v_item.qtd, 'venda', v_pedido.id, null, 'Pedido pelo link', v_prod.preco, 0);
  end loop;
  update pedidos set total = v_total, peso_kg = v_peso where id = v_pedido.id;
  return jsonb_build_object('numero', v_pedido.numero, 'total', v_total, 'duplicado', false);
end $$;

-- ---------- escritório: "já vi" e cadastrar o cliente ----------
create or replace function public.marcar_link_visto(p_pedido uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not tem_perm('pedidos_ver_todos') then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  update pedidos set visto_em = coalesce(visto_em, now()) where id = p_pedido and origem = 'link';
end $$;

create or replace function public.cadastrar_cliente_do_link(p_pedido uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v pedidos; v_cli uuid;
begin
  if not tem_perm('clientes') then raise exception 'Sem permissão para cadastrar clientes.' using errcode = '42501'; end if;
  select * into v from pedidos where id = p_pedido and origem = 'link' for update;
  if not found then raise exception 'Pedido pelo link não encontrado.'; end if;
  if v.cliente_id <> 'f0000000-0000-4000-8000-00000000c11e' then return v.cliente_id; end if;
  insert into clientes (razao_social, telefone, endereco, bairro, referencia, vendedor_id, observacao)
  values (v.contato_nome, v.contato_telefone, v.contato_endereco, v.contato_bairro, v.contato_referencia, auth.uid(),
          'Cadastrado a partir do pedido nº ' || v.numero || ' (link)')
  returning id into v_cli;
  update pedidos set cliente_id = v_cli, visto_em = coalesce(visto_em, now()) where id = p_pedido;
  return v_cli;
end $$;

revoke execute on function public.loja_catalogo() from public;
grant execute on function public.loja_catalogo() to anon, authenticated;
revoke execute on function public.loja_pedido(uuid, text, text, text, text, text, text, numeric, text, jsonb) from public;
grant execute on function public.loja_pedido(uuid, text, text, text, text, text, text, numeric, text, jsonb) to anon, authenticated;
revoke execute on function public.marcar_link_visto(uuid) from public, anon;
grant execute on function public.marcar_link_visto(uuid) to authenticated;
revoke execute on function public.cadastrar_cliente_do_link(uuid) from public, anon;
grant execute on function public.cadastrar_cliente_do_link(uuid) to authenticated;

create or replace function public.versao_banco() returns integer language sql stable as $$ select 24 $$;
