-- =====================================================================
--  COMENTÁRIOS AO VIVO DO ADMIN
--  Rode no Supabase: SQL Editor -> New query -> Run.
-- =====================================================================

create table if not exists public.live_comments (
  id          uuid primary key default gen_random_uuid(),
  webinar_id  uuid not null references public.webinars(id) on delete cascade,
  schedule_id uuid references public.webinar_schedules(id) on delete set null,
  author_name text not null default 'ADM',
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists lc_webinar_idx on public.live_comments(webinar_id);
create index if not exists lc_created_idx on public.live_comments(created_at);

alter table public.live_comments enable row level security;

-- Leitura pública para webinários publicados
drop policy if exists lc_select on public.live_comments;
create policy lc_select on public.live_comments for select
  using (
    exists (
      select 1 from public.webinars w
      where w.id = live_comments.webinar_id
        and w.status = 'published'
    )
  );

-- Insert apenas pelo dono do webinário ou admin
drop policy if exists lc_insert on public.live_comments;
create policy lc_insert on public.live_comments for insert
  with check (
    exists (
      select 1 from public.webinars w
      where w.id = live_comments.webinar_id
        and (w.owner_id = auth.uid() or public.is_admin())
    )
  );

-- Habilita Realtime para esta tabela
alter publication supabase_realtime add table public.live_comments;
