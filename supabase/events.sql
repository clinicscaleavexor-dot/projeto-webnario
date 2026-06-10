-- =====================================================================
--  EVENTOS DE RASTREAMENTO DO WEBINÁRIO
--  Append-only. Não requer autenticação para INSERT.
--  Rode no Supabase: SQL Editor -> New query -> Run.
-- =====================================================================

create table if not exists public.webinar_events (
  id          uuid        primary key default gen_random_uuid(),
  webinar_id  uuid        not null references public.webinars(id) on delete cascade,
  event_type  text        not null,
  -- Valores de event_type:
  --   'schedule_view'   – schedule.html carregou
  --   'modal_open'      – modal de lead abriu
  --   'watch_view'      – watch.html carregou (= presença real)
  --   'watch_heartbeat' – pulsação a cada 60s com value = segundos decorridos
  --   'cta_click'       – clique num botão CTA
  value       integer,    -- segundos assistidos (para watch_heartbeat)
  metadata    jsonb,      -- { cta_id, cta_label } para cta_click
  created_at  timestamptz not null default now()
);

-- Índice principal: todas as queries filtram por webinar_id + event_type
create index if not exists we_webinar_type_idx
  on public.webinar_events(webinar_id, event_type);

create index if not exists we_created_idx
  on public.webinar_events(created_at desc);

alter table public.webinar_events enable row level security;

-- Visitante anônimo pode inserir (fire-and-forget, sem bloquear a UI)
drop policy if exists events_insert on public.webinar_events;
create policy events_insert on public.webinar_events
  for insert with check (true);

-- Somente o dono do webinário (ou admin) pode ler
drop policy if exists events_select on public.webinar_events;
create policy events_select on public.webinar_events
  for select using (
    exists (
      select 1 from public.webinars w
      where w.id = webinar_events.webinar_id
        and (w.owner_id = auth.uid() or public.is_admin())
    )
  );

-- =====================================================================
--  RPC: métricas agregadas por webinário do usuário logado
-- =====================================================================
create or replace function public.get_my_metrics()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  select jsonb_agg(row_data order by row_data->>'title')
  into result
  from (
    select jsonb_build_object(
      'webinar_id',        w.id,
      'title',             w.title,
      'status',            w.status,
      -- leads já capturados na schedule_leads
      'leads',             coalesce((
        select count(*) from public.schedule_leads sl
        where sl.webinar_id = w.id
      ), 0),
      -- acessos à página de agendamento
      'schedule_views',    coalesce((
        select count(*) from public.webinar_events e
        where e.webinar_id = w.id and e.event_type = 'schedule_view'
      ), 0),
      -- modal de captura de dados aberto
      'modal_opens',       coalesce((
        select count(*) from public.webinar_events e
        where e.webinar_id = w.id and e.event_type = 'modal_open'
      ), 0),
      -- pessoas que chegaram à página da live
      'watch_views',       coalesce((
        select count(*) from public.webinar_events e
        where e.webinar_id = w.id and e.event_type = 'watch_view'
      ), 0),
      -- média de tempo assistido (segundos) via heartbeats de 60s
      -- avg(value) converge para o ponto médio assistido — adequado para v1
      'avg_watch_seconds', coalesce((
        select round(avg(e.value))
        from public.webinar_events e
        where e.webinar_id = w.id
          and e.event_type = 'watch_heartbeat'
          and e.value is not null
      ), 0),
      -- cliques no botão CTA
      'cta_clicks',        coalesce((
        select count(*) from public.webinar_events e
        where e.webinar_id = w.id and e.event_type = 'cta_click'
      ), 0)
    ) as row_data
    from public.webinars w
    where w.owner_id = auth.uid()
  ) sub;

  return coalesce(result, '[]'::jsonb);
end;
$$;

grant execute on function public.get_my_metrics() to authenticated;
