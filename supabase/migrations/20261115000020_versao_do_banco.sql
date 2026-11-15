-- =====================================================================
-- Versão do banco: o painel compara com a versão que o site espera e
-- avisa os administradores quando falta rodar alguma atualização.
-- Toda atualização nova a partir daqui troca o número abaixo.
-- =====================================================================
create or replace function public.versao_banco()
returns integer language sql stable as $$ select 20 $$;
revoke execute on function public.versao_banco() from public, anon;
grant execute on function public.versao_banco() to authenticated;
