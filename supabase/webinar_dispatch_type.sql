-- =====================================================================
--  Adiciona dispatch_type em webinar_dispatch_messages
--  'pre' = lembrete pré-aula  |  'pos' = follow-up pós-aula
--  Mensagens existentes (sem o campo) recebem 'pre' por padrão.
--
--  Rode no Supabase: SQL Editor -> New query -> Run.
-- =====================================================================

ALTER TABLE public.webinar_dispatch_messages
  ADD COLUMN IF NOT EXISTS dispatch_type text NOT NULL DEFAULT 'pre'
    CHECK (dispatch_type IN ('pre', 'pos'));

CREATE INDEX IF NOT EXISTS wdm_dispatch_type_idx
  ON public.webinar_dispatch_messages(webinar_id, dispatch_type);
