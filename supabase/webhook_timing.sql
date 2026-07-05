-- =====================================================================
--  Webhook de disparos — timing fixo por schedule_type
--
--  Rode no Supabase: SQL Editor → New query → Run.
-- =====================================================================

-- Chaves de configuração do webhook
INSERT INTO public.dispatch_settings (key, value) VALUES
  ('webhook_enabled', 'false'),
  ('webhook_url',     '')
ON CONFLICT (key) DO NOTHING;

-- Função com timing fixo por schedule_type
-- Pre:  relative_30 → -10min ±5min  |  scheduled → -20min ±5min  |  now → nunca
-- Pos:  todos os tipos → +90min ±5min após scheduled_for
DROP FUNCTION IF EXISTS public.get_pending_webhooks();

CREATE FUNCTION public.get_pending_webhooks()
RETURNS TABLE (
  id             uuid,
  name           text,
  phone          text,
  scheduled_for  timestamptz,
  schedule_id    uuid,
  schedule_type  text,
  webinar_id     uuid,
  webinar_slug   text,
  reminder_type  text,
  rotation_index bigint
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN

  -- ── PRÉ-AULA ──────────────────────────────────────────────────────────
  -- 'now' → sem pré-lembrete
  -- 'relative_30' → janela: scheduled_for - 15min .. scheduled_for - 5min
  -- 'scheduled'   → janela: scheduled_for - 25min .. scheduled_for - 15min
  RETURN QUERY
    SELECT DISTINCT ON (sl.phone)
      sl.id, sl.name, sl.phone, sl.scheduled_for,
      sl.schedule_id, sl.schedule_type, sl.webinar_id, w.slug,
      'pre'::text,
      ROW_NUMBER() OVER (PARTITION BY sl.webinar_id ORDER BY sl.created_at) - 1
    FROM public.schedule_leads sl
    JOIN public.webinars w ON w.id = sl.webinar_id
    WHERE sl.schedule_type != 'now'
      AND (
        (sl.schedule_type = 'relative_30'
          AND now() BETWEEN sl.scheduled_for - interval '15 minutes'
                        AND sl.scheduled_for - interval '5 minutes')
        OR
        (sl.schedule_type = 'scheduled'
          AND now() BETWEEN sl.scheduled_for - interval '25 minutes'
                        AND sl.scheduled_for - interval '15 minutes')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.lead_reminder_log r
        WHERE r.lead_id = sl.id AND r.type = 'pre'
      )
    ORDER BY sl.phone, sl.scheduled_for ASC
    LIMIT 50;

  -- ── PÓS-AULA ──────────────────────────────────────────────────────────
  -- Todos os tipos (incluindo 'now'): +90min ±5min após scheduled_for
  RETURN QUERY
    SELECT DISTINCT ON (sl.phone)
      sl.id, sl.name, sl.phone, sl.scheduled_for,
      sl.schedule_id, sl.schedule_type, sl.webinar_id, w.slug,
      'pos'::text,
      ROW_NUMBER() OVER (PARTITION BY sl.webinar_id ORDER BY sl.created_at) - 1
    FROM public.schedule_leads sl
    JOIN public.webinars w ON w.id = sl.webinar_id
    WHERE now() BETWEEN sl.scheduled_for + interval '85 minutes'
                    AND sl.scheduled_for + interval '95 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM public.lead_reminder_log r
        WHERE r.lead_id = sl.id AND r.type = 'pos'
      )
    ORDER BY sl.phone, sl.scheduled_for ASC
    LIMIT 50;

END; $$;

GRANT EXECUTE ON FUNCTION public.get_pending_webhooks() TO service_role;
