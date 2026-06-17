-- Rode no Supabase: SQL Editor → New query → Run

-- Retorna leads pendentes deduplicados por telefone.
-- Se o mesmo número já recebeu aquele tipo nas últimas 8h, pula.
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
  RETURN QUERY
    SELECT DISTINCT ON (sl.phone)
      sl.id, sl.name, sl.phone, sl.scheduled_for,
      sl.schedule_id, sl.webinar_id, w.slug, 'pre'::text
    FROM public.schedule_leads sl
    JOIN public.webinars w ON w.id = sl.webinar_id
    WHERE sl.scheduled_for >= p_pre_min
      AND sl.scheduled_for <= p_pre_max
      AND NOT EXISTS (
        SELECT 1 FROM public.lead_reminder_log r
        JOIN public.schedule_leads sl2 ON sl2.id = r.lead_id
        WHERE sl2.phone = sl.phone
          AND r.type = 'pre'
          AND r.sent_at > now() - interval '8 hours'
      )
    ORDER BY sl.phone, sl.scheduled_for ASC
    LIMIT 50;

  RETURN QUERY
    SELECT DISTINCT ON (sl.phone)
      sl.id, sl.name, sl.phone, sl.scheduled_for,
      sl.schedule_id, sl.webinar_id, w.slug, 'pos'::text
    FROM public.schedule_leads sl
    JOIN public.webinars w ON w.id = sl.webinar_id
    WHERE sl.scheduled_for >= p_pos_min
      AND sl.scheduled_for <= p_pos_max
      AND NOT EXISTS (
        SELECT 1 FROM public.lead_reminder_log r
        JOIN public.schedule_leads sl2 ON sl2.id = r.lead_id
        WHERE sl2.phone = sl.phone
          AND r.type = 'pos'
          AND r.sent_at > now() - interval '8 hours'
      )
    ORDER BY sl.phone, sl.scheduled_for ASC
    LIMIT 50;
END;
$$;

-- Grava o log antes de enviar (atômico — previne duplo envio)
CREATE OR REPLACE FUNCTION public.claim_reminder(p_lead_id uuid, p_type text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.lead_reminder_log (lead_id, type)
  VALUES (p_lead_id, p_type)
  ON CONFLICT (lead_id, type) DO NOTHING;
  RETURN FOUND;
END;
$$;

-- Mantido por compatibilidade
CREATE OR REPLACE FUNCTION public.log_reminder_sent(p_lead_id uuid, p_type text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.lead_reminder_log (lead_id, type)
  VALUES (p_lead_id, p_type)
  ON CONFLICT (lead_id, type) DO NOTHING;
END;
$$;
