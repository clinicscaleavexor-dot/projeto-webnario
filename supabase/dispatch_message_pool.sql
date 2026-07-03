-- =====================================================================
--  Novos campos em dispatch_settings: pool de mensagens + janela de tempo
--  Rode no Supabase: SQL Editor -> New query -> Run.
-- =====================================================================

INSERT INTO public.dispatch_settings (key, value) VALUES
  ('message_pool',               '[]'),
  ('lead_window_start_minutes',  '30'),
  ('lead_window_end_minutes',    '10')
ON CONFLICT (key) DO NOTHING;
