-- =====================================================================
--  MÚLTIPLOS HORÁRIOS POR WEBINÁRIO
--  Rode no Supabase: SQL Editor -> New query -> Run.
-- =====================================================================

-- ---------- Tabela ----------
create table if not exists public.webinar_schedules (
  id          uuid primary key default gen_random_uuid(),
  webinar_id  uuid not null references public.webinars(id) on delete cascade,
  start_at    timestamptz not null,
  label       text,          -- rótulo opcional exibido na página de agendamento
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists ws_webinar_idx on public.webinar_schedules(webinar_id);
create index if not exists ws_start_idx   on public.webinar_schedules(start_at);

-- ---------- RLS ----------
alter table public.webinar_schedules enable row level security;

drop policy if exists schedules_all on public.webinar_schedules;
create policy schedules_all on public.webinar_schedules for all
  using (exists (
    select 1 from public.webinars w
    where w.id = webinar_schedules.webinar_id
      and (w.owner_id = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.webinars w
    where w.id = webinar_schedules.webinar_id
      and (w.owner_id = auth.uid() or public.is_admin())
  ));

-- ---------- RPC atualizada ----------
-- Substitui a versão anterior de get_public_webinar.
-- Novo parâmetro opcional p_schedule_id: se passado, usa esse horário;
-- senão, auto-seleciona o horário em andamento ou o próximo futuro.

create or replace function public.get_public_webinar(
  p_slug        text,
  p_schedule_id uuid default null
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  w        public.webinars;
  sched    public.webinar_schedules;
  result   jsonb;
begin
  -- Busca o webinário publicado
  select * into w from public.webinars
  where slug = p_slug and status = 'published'
  limit 1;

  if not found then return null; end if;

  -- Resolve o horário a usar
  if p_schedule_id is not null then
    select * into sched from public.webinar_schedules
    where id = p_schedule_id and webinar_id = w.id and active = true
    limit 1;
  end if;

  -- Se não especificado (ou não encontrado), auto-seleciona:
  -- 1) Horário em andamento (já começou e ainda não terminou)
  -- 2) Próximo futuro
  if sched.id is null then
    select * into sched from public.webinar_schedules
    where webinar_id = w.id and active = true
      and start_at <= now()
      and (w.video_duration_seconds is null
           or start_at + (w.video_duration_seconds * interval '1 second') > now())
    order by start_at desc
    limit 1;
  end if;

  if sched.id is null then
    select * into sched from public.webinar_schedules
    where webinar_id = w.id and active = true
      and start_at > now()
    order by start_at asc
    limit 1;
  end if;

  select jsonb_build_object(
    'server_now', now(),
    'webinar', jsonb_build_object(
      'id', w.id,
      'title', w.title,
      'slug', w.slug,
      'video_url', w.video_url,
      'video_duration_seconds', w.video_duration_seconds,
      -- scheduled_start_at é o horário resolvido para esta sessão
      'scheduled_start_at', sched.start_at,
      'schedule_id', sched.id,
      'timezone', w.timezone,
      'settings', w.settings
    ),
    -- Todos os horários futuros ativos (para a página de agendamento)
    'schedules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'start_at', s.start_at,
        'label', s.label
      ) order by s.start_at asc)
      from public.webinar_schedules s
      where s.webinar_id = w.id
        and s.active = true
        and s.start_at > now() - interval '30 minutes'
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'type', c.type, 'author_name', c.author_name,
        'avatar_url', c.avatar_url, 'body', c.body,
        'show_at_seconds', c.show_at_seconds, 'reply_to_id', c.reply_to_id
      ) order by c.show_at_seconds asc, c.created_at asc)
      from public.comments c where c.webinar_id = w.id), '[]'::jsonb),
    'ctas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'label', t.label, 'url', t.url,
        'show_at_seconds', t.show_at_seconds,
        'post_in_chat', t.post_in_chat, 'chat_message', t.chat_message
      ) order by t.show_at_seconds asc)
      from public.ctas t where t.webinar_id = w.id), '[]'::jsonb),
    'banners', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'image_url', b.image_url, 'link_url', b.link_url,
        'position', b.position, 'show_at_seconds', b.show_at_seconds,
        'hide_at_seconds', b.hide_at_seconds
      ) order by b.show_at_seconds asc)
      from public.banners b where b.webinar_id = w.id), '[]'::jsonb)
  ) into result;

  return result;
end; $$;

grant execute on function public.get_public_webinar(text, uuid) to anon, authenticated;
