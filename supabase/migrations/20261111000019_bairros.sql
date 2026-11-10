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
