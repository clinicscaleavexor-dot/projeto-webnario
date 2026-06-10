-- =====================================================================
--  RECORRÊNCIA DE HORÁRIOS
--  Rode no Supabase: SQL Editor -> New query -> Run.
-- =====================================================================

-- Adiciona colunas de recorrência à tabela de horários
alter table public.webinar_schedules
  add column if not exists recurrence_type     text    not null default 'once',
  -- 'once' | 'weekly' | 'every_n_days'
  add column if not exists recurrence_interval integer,
  -- null para 'once' e 'weekly'; número de dias para 'every_n_days'
  add column if not exists recurrence_group_id uuid;
  -- UUID compartilhado entre todas as ocorrências da mesma regra

create index if not exists ws_group_idx
  on public.webinar_schedules(recurrence_group_id)
  where recurrence_group_id is not null;
