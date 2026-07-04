-- =====================================================================
--  get_pending_reminders com configuração por webinário
--  Cada webinário pode ter dispatch_config em settings JSONB com:
--    pre: { enabled, window_start_minutes, window_end_minutes }
--    pos: { enabled, delay_minutes }
--  Webinários sem dispatch_config usam os parâmetros globais (fallback).
--
--  Rode no Supabase: SQL Editor -> New query -> Run.
-- =====================================================================

DROP FUNCTION IF EXISTS public.get_pending_reminders(timestamptz,timestamptz,timestamptz,timestamptz);

CREATE FUNCTION public.get_pending_reminders(
  p_pre_min timestamptz,
  p_pre_max timestamptz,
  p_pos_min timestamptz,
  p_pos_max timestamptz
)
RETURNS TABLE (
  id             uuid,
  name           text,
  phone          text,
  scheduled_for  timestamptz,
  schedule_id    uuid,
  webinar_id     uuid,
  webinar_slug   text,
  reminder_type  text,
  rotation_index bigint
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN

  -- ── PRÉ-AULA ───────────────────────────────────────────────────────
  RETURN QUERY
    SELECT DISTINCT ON (sl.phone)
      sl.id, sl.name, sl.phone, sl.scheduled_for,
      sl.schedule_id, sl.webinar_id, w.slug, 'pre'::text,
      ROW_NUMBER() OVER (
        PARTITION BY sl.webinar_id, date_trunc('day', sl.scheduled_for)
        ORDER BY sl.created_at
      ) - 1
    FROM public.schedule_leads sl
    JOIN public.webinars w ON w.id = sl.webinar_id
    WHERE EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = w.owner_id AND p.role = 'admin'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.lead_reminder_log r
        JOIN public.schedule_leads sl2 ON sl2.id = r.lead_id
        WHERE sl2.phone = sl.phone
          AND r.type = 'pre'
          AND r.sent_at > now() - interval '8 hours'
      )
      AND (
        CASE
          -- Webinário com config própria e pré ativo
          WHEN (w.settings->'dispatch_config'->'pre'->>'enabled') = 'true' THEN
            sl.scheduled_for >= now() + COALESCE(
              (w.settings->'dispatch_config'->'pre'->>'window_end_minutes')::int, 10
            ) * interval '1 minute'
            AND sl.scheduled_for <= now() + COALESCE(
              (w.settings->'dispatch_config'->'pre'->>'window_start_minutes')::int, 30
            ) * interval '1 minute'
          -- Webinário sem config: usa janela global
          WHEN w.settings->'dispatch_config' IS NULL THEN
            sl.scheduled_for >= p_pre_min AND sl.scheduled_for <= p_pre_max
          -- Config existe mas pré desativado
          ELSE FALSE
        END
      )
    ORDER BY sl.phone, sl.scheduled_for ASC
    LIMIT 50;

  -- ── PÓS-AULA — aulas normais (< 23h BRT) ──────────────────────────
  RETURN QUERY
    SELECT DISTINCT ON (sl.phone)
      sl.id, sl.name, sl.phone, sl.scheduled_for,
      sl.schedule_id, sl.webinar_id, w.slug, 'pos'::text,
      ROW_NUMBER() OVER (
        PARTITION BY sl.webinar_id, date_trunc('day', sl.scheduled_for)
        ORDER BY sl.created_at
      ) - 1
    FROM public.schedule_leads sl
    JOIN public.webinars w ON w.id = sl.webinar_id
    WHERE EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = w.owner_id AND p.role = 'admin'
      )
      AND EXTRACT(HOUR FROM (sl.scheduled_for AT TIME ZONE 'America/Sao_Paulo')) < 23
      AND NOT EXISTS (
        SELECT 1 FROM public.lead_reminder_log r
        JOIN public.schedule_leads sl2 ON sl2.id = r.lead_id
        WHERE sl2.phone = sl.phone
          AND r.type = 'pos'
          AND r.sent_at > now() - interval '8 hours'
      )
      AND (
        CASE
          WHEN (w.settings->'dispatch_config'->'pos'->>'enabled') = 'true' THEN
            -- Janela de 5 min em torno do delay configurado
            sl.scheduled_for >= now() - (COALESCE(
              (w.settings->'dispatch_config'->'pos'->>'delay_minutes')::int, 75
            ) + 5) * interval '1 minute'
            AND sl.scheduled_for <= now() - COALESCE(
              (w.settings->'dispatch_config'->'pos'->>'delay_minutes')::int, 75
            ) * interval '1 minute'
          WHEN w.settings->'dispatch_config' IS NULL THEN
            sl.scheduled_for >= p_pos_min AND sl.scheduled_for <= p_pos_max
          ELSE FALSE
        END
      )
    ORDER BY sl.phone, sl.scheduled_for ASC
    LIMIT 50;

  -- ── PÓS-AULA — aulas tardias (>= 23h BRT) → dia seguinte 07-08h ──
  RETURN QUERY
    SELECT DISTINCT ON (sl.phone)
      sl.id, sl.name, sl.phone, sl.scheduled_for,
      sl.schedule_id, sl.webinar_id, w.slug, 'pos'::text,
      ROW_NUMBER() OVER (
        PARTITION BY sl.webinar_id, date_trunc('day', sl.scheduled_for)
        ORDER BY sl.created_at
      ) - 1
    FROM public.schedule_leads sl
    JOIN public.webinars w ON w.id = sl.webinar_id
    WHERE EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = w.owner_id AND p.role = 'admin'
      )
      AND EXTRACT(HOUR FROM (sl.scheduled_for AT TIME ZONE 'America/Sao_Paulo')) >= 23
      AND DATE(sl.scheduled_for AT TIME ZONE 'America/Sao_Paulo')
          = DATE((now() AT TIME ZONE 'America/Sao_Paulo') - interval '1 day')
      AND (now() AT TIME ZONE 'America/Sao_Paulo')::time
          BETWEEN '07:00'::time AND '08:00'::time
      -- Inclui se sem config (fallback) ou com pos ativo
      AND (
        w.settings->'dispatch_config' IS NULL
        OR (w.settings->'dispatch_config'->'pos'->>'enabled') = 'true'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.lead_reminder_log r
        JOIN public.schedule_leads sl2 ON sl2.id = r.lead_id
        WHERE sl2.phone = sl.phone
          AND r.type = 'pos'
          AND r.sent_at > now() - interval '26 hours'
      )
    ORDER BY sl.phone, sl.scheduled_for ASC
    LIMIT 50;

END; $$;
