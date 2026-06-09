-- =====================================================================
--  Domínio personalizado por conta (perfil do usuário)
--  Rode no Supabase: SQL Editor -> New query -> Run.
-- =====================================================================

alter table public.profiles
  add column if not exists custom_domain text;
