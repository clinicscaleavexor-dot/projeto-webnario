-- =====================================================================
--  Mensagens de disparo por webinário (texto ou áudio)
--  Rode no Supabase: SQL Editor -> New query -> Run.
-- =====================================================================

-- Bucket público para áudio de disparo
INSERT INTO storage.buckets (id, name, public)
VALUES ('webinar-dispatch', 'webinar-dispatch', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "dispatch public read" ON storage.objects;
CREATE POLICY "dispatch public read" ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'webinar-dispatch');

DROP POLICY IF EXISTS "dispatch authenticated upload" ON storage.objects;
CREATE POLICY "dispatch authenticated upload" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'webinar-dispatch');

DROP POLICY IF EXISTS "dispatch owner delete" ON storage.objects;
CREATE POLICY "dispatch owner delete" ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'webinar-dispatch' AND owner = auth.uid());

-- Tabela de mensagens de disparo por webinário
CREATE TABLE IF NOT EXISTS public.webinar_dispatch_messages (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  webinar_id uuid        NOT NULL REFERENCES public.webinars(id) ON DELETE CASCADE,
  type       text        NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'audio')),
  content    text        NOT NULL,   -- texto ou URL pública do áudio
  sort_order int         NOT NULL DEFAULT 0,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wdm_webinar_idx ON public.webinar_dispatch_messages(webinar_id);

ALTER TABLE public.webinar_dispatch_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wdm_all ON public.webinar_dispatch_messages;
CREATE POLICY wdm_all ON public.webinar_dispatch_messages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.webinars w
      WHERE w.id = webinar_dispatch_messages.webinar_id
        AND (w.owner_id = auth.uid() OR public.is_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.webinars w
      WHERE w.id = webinar_dispatch_messages.webinar_id
        AND (w.owner_id = auth.uid() OR public.is_admin())
    )
  );
