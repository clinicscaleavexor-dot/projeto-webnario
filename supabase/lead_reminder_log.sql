-- Log de lembretes enviados por lead. Garante que cada lead recebe
-- cada tipo de mensagem somente uma vez.
-- Rode no Supabase: SQL Editor → New query → Run.

CREATE TABLE IF NOT EXISTS public.lead_reminder_log (
  lead_id  UUID NOT NULL REFERENCES public.schedule_leads(id) ON DELETE CASCADE,
  type     TEXT NOT NULL CHECK (type IN ('pre', 'pos')),
  sent_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_id, type)
);

ALTER TABLE public.lead_reminder_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY lrl_auth ON public.lead_reminder_log FOR ALL USING (auth.role() = 'authenticated');
