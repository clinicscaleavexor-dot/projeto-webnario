-- =====================================================================
--  LEADS DE AGENDAMENTO
--  Rode no Supabase: SQL Editor -> New query -> Run.
-- =====================================================================

create table if not exists public.schedule_leads (
  id             uuid primary key default gen_random_uuid(),
  webinar_id     uuid not null references public.webinars(id) on delete cascade,
  schedule_id    uuid references public.webinar_schedules(id) on delete set null,
  name           text not null,
  phone          text not null,
  scheduled_for  timestamptz not null,
  schedule_type  text not null default 'scheduled', -- 'now' | 'relative_30' | 'scheduled'
  created_at     timestamptz not null default now()
);

create index if not exists leads_webinar_idx     on public.schedule_leads(webinar_id);
create index if not exists leads_scheduled_idx   on public.schedule_leads(scheduled_for);
create index if not exists leads_schedule_id_idx on public.schedule_leads(schedule_id);

alter table public.schedule_leads enable row level security;

-- Qualquer visitante pode registrar um lead (sem autenticação)
drop policy if exists leads_insert on public.schedule_leads;
create policy leads_insert on public.schedule_leads for insert with check (true);

-- Apenas o dono do webinário (ou admin) pode ler os leads
drop policy if exists leads_select on public.schedule_leads;
create policy leads_select on public.schedule_leads for select
  using (
    exists (
      select 1 from public.webinars w
      where w.id = schedule_leads.webinar_id
        and (w.owner_id = auth.uid() or public.is_admin())
    )
  );

-- Apenas dono/admin pode deletar leads
drop policy if exists leads_delete on public.schedule_leads;
create policy leads_delete on public.schedule_leads for delete
  using (
    exists (
      select 1 from public.webinars w
      where w.id = schedule_leads.webinar_id
        and (w.owner_id = auth.uid() or public.is_admin())
    )
  );
