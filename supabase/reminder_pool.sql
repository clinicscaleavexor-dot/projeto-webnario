-- =====================================================================
--  Atualiza get_pending_reminders para retornar rotation_index
--  Rode no Supabase: SQL Editor -> New query -> Run.
--  Substitui a versão de reminder_admin_only.sql.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_pending_reminders(
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
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Lembrete pré-aula
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
    WHERE sl.scheduled_for >= p_pre_min
      AND sl.scheduled_for <= p_pre_max
      AND EXISTS (
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
    ORDER BY sl.phone, sl.scheduled_for ASC
    LIMIT 50;

  -- Follow-up pós-aula: aulas normais (< 23h BRT)
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
    WHERE sl.scheduled_for >= p_pos_min
      AND sl.scheduled_for <= p_pos_max
      AND EXTRACT(HOUR FROM (sl.scheduled_for AT TIME ZONE 'America/Sao_Paulo')) < 23
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = w.owner_id AND p.role = 'admin'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.lead_reminder_log r
        JOIN public.schedule_leads sl2 ON sl2.id = r.lead_id
        WHERE sl2.phone = sl.phone
          AND r.type = 'pos'
          AND r.sent_at > now() - interval '8 hours'
      )
    ORDER BY sl.phone, sl.scheduled_for ASC
    LIMIT 50;

  -- Follow-up pós-aula: aulas tardias (>= 23h BRT) → dia seguinte 07-08h BRT
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
    WHERE EXTRACT(HOUR FROM (sl.scheduled_for AT TIME ZONE 'America/Sao_Paulo')) >= 23
      AND DATE(sl.scheduled_for AT TIME ZONE 'America/Sao_Paulo')
          = DATE((now() AT TIME ZONE 'America/Sao_Paulo') - interval '1 day')
      AND (now() AT TIME ZONE 'America/Sao_Paulo')::time
          BETWEEN '07:00'::time AND '08:00'::time
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = w.owner_id AND p.role = 'admin'
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
END;
$$;
