-- =====================================================================
--  RESTRINGE LEMBRETES AUTOMÁTICOS (pré/pós-aula) AOS WEBINÁRIOS DA CONTA ADM
--  Rode no Supabase: SQL Editor -> New query -> Run.
--  Pré-requisito: supabase/set_admin.sql já executado.
--  Substitui a função de supabase/reminder_functions.sql, adicionando o
--  filtro "dono do webinário é admin" nas 3 consultas.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_pending_reminders(
  p_pre_min timestamptz,
  p_pre_max timestamptz,
  p_pos_min timestamptz,
  p_pos_max timestamptz
)
RETURNS TABLE (
  id            uuid,
  name          text,
  phone         text,
  scheduled_for  timestamptz,
  schedule_id   uuid,
  webinar_id    uuid,
  webinar_slug  text,
  reminder_type text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Lembrete pré-aula (inalterado, exceto pelo filtro de dono admin)
  RETURN QUERY
    SELECT DISTINCT ON (sl.phone)
      sl.id, sl.name, sl.phone, sl.scheduled_for,
      sl.schedule_id, sl.webinar_id, w.slug, 'pre'::text
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

  -- Follow-up pós-aula: aulas normais (antes das 23h BRT) → 75-80 min após a aula
  RETURN QUERY
    SELECT DISTINCT ON (sl.phone)
      sl.id, sl.name, sl.phone, sl.scheduled_for,
      sl.schedule_id, sl.webinar_id, w.slug, 'pos'::text
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

  -- Follow-up pós-aula: aulas tardias (>= 23h BRT) → dia seguinte entre 07h e 08h BRT
  RETURN QUERY
    SELECT DISTINCT ON (sl.phone)
      sl.id, sl.name, sl.phone, sl.scheduled_for,
      sl.schedule_id, sl.webinar_id, w.slug, 'pos'::text
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
