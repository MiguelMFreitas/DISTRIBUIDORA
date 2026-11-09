-- =====================================================================
-- Nome da carga (ex.: "Rota Serra", "Centro + Zona Norte"), sai no romaneio
-- =====================================================================
alter table public.cargas add column if not exists nome text;
grant insert (nome) on public.cargas to authenticated;
grant update (nome) on public.cargas to authenticated;
