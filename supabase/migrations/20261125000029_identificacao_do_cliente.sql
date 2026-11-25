-- =====================================================================
-- Identificação do cliente para o robô (e para as telas):
--   nome do contato + código + (razão social)  →  "Marcos 12 (MERCADINHO BOM PREÇO EIRELI)"
-- O código é automático, na ordem de cadastro (atualização 27).
-- Sem nome do contato, usa o nome fantasia (ou a razão social).
-- =====================================================================
alter table public.clientes add column if not exists contato text;

alter table public.clientes drop column if exists identificacao;
alter table public.clientes add column identificacao text generated always as (
  trim(coalesce(nullif(trim(contato), ''), nullif(trim(nome_fantasia), ''), razao_social))
  || coalesce(' ' || nullif(trim(codigo), ''), '')
  || ' (' || razao_social || ')'
) stored;

-- telas do clube mostram a identificação
create or replace function public.clube_clientes()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_mes date := date_trunc('month', current_date)::date;
begin
  if not (tem_perm('pedidos_ver_todos') or tem_perm('clientes') or tem_perm('financeiro')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  perform _vencer_pontos(null);
  if not exists (select 1 from clube_niveis where mes = v_mes) then perform _calcular_niveis(v_mes); end if;
  return coalesce((select jsonb_agg(x order by x.saldo desc, x.nome) from (
    select c.id, c.codigo, c.identificacao as nome, c.whatsapp,
           coalesce(n.nivel, 'bronze') as nivel, n.metas,
           coalesce((select sum(restante) from pontos_movimentos m where m.cliente_id = c.id and m.restante > 0), 0) as saldo,
           coalesce((select sum(restante) from pontos_movimentos m where m.cliente_id = c.id and m.restante > 0 and m.vence_em <= current_date + 30), 0) as a_vencer_30,
           (select min(vence_em) from pontos_movimentos m where m.cliente_id = c.id and m.restante > 0) as proximo_vencimento,
           (select count(*) from trocas_pontos t where t.cliente_id = c.id and t.status in ('pendente', 'no_pedido')) as trocas_abertas,
           (select max(criado_em) from pontos_movimentos m where m.cliente_id = c.id) as ultimo_movimento
      from clientes c left join clube_niveis n on n.cliente_id = c.id and n.mes = v_mes
     where c.ativo and not _eh_cliente_generico(c.id)
       and (c.whatsapp is not null or exists (select 1 from pontos_movimentos m where m.cliente_id = c.id))) x), '[]'::jsonb);
end $$;

create or replace function public.versao_banco() returns integer language sql stable as $$ select 29 $$;
