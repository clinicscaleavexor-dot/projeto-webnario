-- =====================================================================
--  RESTRINGE DISPARO (grupos + configurações) À CONTA ADM
--  Rode no Supabase: SQL Editor -> New query -> Run.
--  Pré-requisito: supabase/set_admin.sql já executado.
-- =====================================================================

-- group_dispatches: antes dono OU admin podiam gerenciar; agora só admin.
drop policy if exists gd_all on public.group_dispatches;
create policy gd_all on public.group_dispatches for all
  using  (public.is_admin())
  with check (public.is_admin());

-- group_dispatch_logs: segue a mesma regra.
drop policy if exists gdl_all on public.group_dispatch_logs;
create policy gdl_all on public.group_dispatch_logs for all
  using (public.is_admin())
  with check (public.is_admin());

-- dispatch_settings: antes qualquer autenticado lia/editava; agora só admin.
drop policy if exists dset_auth on public.dispatch_settings;
create policy dset_admin on public.dispatch_settings for all
  using (public.is_admin())
  with check (public.is_admin());
