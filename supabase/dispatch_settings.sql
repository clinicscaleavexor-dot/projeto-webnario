-- Rode no Supabase: SQL Editor → New query → Run

CREATE TABLE IF NOT EXISTS public.dispatch_settings (
  key         text PRIMARY KEY,
  value       text NOT NULL DEFAULT 'true',
  updated_at  timestamptz DEFAULT now()
);

INSERT INTO public.dispatch_settings (key, value) VALUES
  ('auto_pre_enabled',   'true'),
  ('auto_pos_enabled',   'true'),
  ('followup_audio_url', '')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.dispatch_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY dset_auth ON public.dispatch_settings FOR ALL USING (auth.role() = 'authenticated');
GRANT ALL ON public.dispatch_settings TO authenticated;

-- RPC usada pelo Vercel para ler configurações sem problema de PGRST125
CREATE OR REPLACE FUNCTION public.get_dispatch_settings()
RETURNS TABLE (key text, value text)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT key, value FROM public.dispatch_settings;
$$;
