-- Limpa todos os eventos de analytics para começar do zero.
-- Rode no Supabase: SQL Editor → New query → Run.
-- OBS: leads (schedule_leads) NÃO são apagados.

TRUNCATE TABLE public.webinar_events;
TRUNCATE TABLE public.live_presence;
