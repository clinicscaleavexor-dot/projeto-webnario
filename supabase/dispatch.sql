-- =====================================================================
--  DISPARO EM GRUPOS WHATSAPP
--  Rode no Supabase: SQL Editor -> New query -> Run.
-- =====================================================================

-- Tabela de configurações de disparo
create table if not exists public.group_dispatches (
  id          uuid        primary key default gen_random_uuid(),
  owner_id    uuid        not null references auth.users(id) on delete cascade,
  webinar_id  uuid        not null references public.webinars(id) on delete cascade,
  name        text        not null default 'Configuração de disparo',
  active      boolean     not null default true,
  config      jsonb       not null default '[]',
  -- config: [{schedule_id, schedule_label, group_id, messages:[{text, time:"HH:MM"}]}]
  created_at  timestamptz not null default now()
);

create index if not exists gd_owner_idx   on public.group_dispatches(owner_id);
create index if not exists gd_webinar_idx on public.group_dispatches(webinar_id);

alter table public.group_dispatches enable row level security;

drop policy if exists gd_all on public.group_dispatches;
create policy gd_all on public.group_dispatches for all
  using  (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

-- Tabela de log de disparos
create table if not exists public.group_dispatch_logs (
  id              uuid        primary key default gen_random_uuid(),
  dispatch_id     uuid        references public.group_dispatches(id) on delete cascade,
  schedule_id     uuid,
  message_index   int,
  group_id        text,
  sent_at         timestamptz not null default now(),
  status          text        not null,  -- 'sent' | 'error'
  error_message   text
);

create index if not exists gdl_dispatch_idx on public.group_dispatch_logs(dispatch_id);
create index if not exists gdl_sent_idx     on public.group_dispatch_logs(sent_at desc);

alter table public.group_dispatch_logs enable row level security;

drop policy if exists gdl_all on public.group_dispatch_logs;
create policy gdl_all on public.group_dispatch_logs for all
  using (
    exists (
      select 1 from public.group_dispatches gd
      where gd.id = group_dispatch_logs.dispatch_id
        and (gd.owner_id = auth.uid() or public.is_admin())
    )
  );
