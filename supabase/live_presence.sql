-- Presença real de viewers ao vivo.
-- Rode no Supabase: SQL Editor → New query → Run.

CREATE TABLE IF NOT EXISTS public.live_presence (
  webinar_id  UUID NOT NULL REFERENCES public.webinars(id) ON DELETE CASCADE,
  session_id  TEXT NOT NULL,
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (webinar_id, session_id)
);

CREATE INDEX IF NOT EXISTS lp_seen_idx ON public.live_presence(webinar_id, last_seen);

ALTER TABLE public.live_presence ENABLE ROW LEVEL SECURITY;

-- Qualquer visitante (anônimo) pode inserir/atualizar a própria sessão
DROP POLICY IF EXISTS lp_insert ON public.live_presence;
CREATE POLICY lp_insert ON public.live_presence FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS lp_update ON public.live_presence;
CREATE POLICY lp_update ON public.live_presence FOR UPDATE USING (true);

-- Apenas autenticados (admin/dono) podem ver os counts
DROP POLICY IF EXISTS lp_select ON public.live_presence;
CREATE POLICY lp_select ON public.live_presence FOR SELECT USING (auth.role() = 'authenticated');
