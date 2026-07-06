-- =====================================================================
--  Cron automático de lembretes/webhooks via Supabase pg_cron + pg_net
--
--  Substitui o cron do Vercel (bloqueado no plano Hobby).
--  Roda a cada 1 minuto, direto do banco, sem serviço externo.
--
--  COMO RODAR:
--    1. Supabase Dashboard → Database → Extensions → habilitar "pg_net"
--    2. Supabase Dashboard → SQL Editor → New query → cole este arquivo → Run
-- =====================================================================

-- Habilitar extensão HTTP do Supabase
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remover job anterior se existir (evita duplicata)
SELECT cron.unschedule('lead-reminders-auto')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lead-reminders-auto');

-- Agendar chamada ao endpoint a cada 1 minuto
SELECT cron.schedule(
  'lead-reminders-auto',
  '* * * * *',
  $cron$
    SELECT net.http_post(
      url     := 'https://projeto-webnario.vercel.app/api/lead-reminders',
      headers := jsonb_build_object(
        'Content-Type',       'application/json',
        'x-dispatch-secret',  'webnario-dispatch-2025'
      ),
      body    := '{}'::jsonb
    );
  $cron$
);

-- Verificar que foi criado
SELECT jobid, jobname, schedule, command, active
  FROM cron.job
 WHERE jobname = 'lead-reminders-auto';
