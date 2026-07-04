-- =====================================================================
--  Adiciona coluna extra_data em schedule_leads para guardar respostas
--  das perguntas extras do formulário.
--  Rode no Supabase: SQL Editor -> New query -> Run.
-- =====================================================================

ALTER TABLE public.schedule_leads
  ADD COLUMN IF NOT EXISTS extra_data jsonb;
