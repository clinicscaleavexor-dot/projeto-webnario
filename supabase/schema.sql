-- =====================================================================
--  PROJETO WEBNÁRIO — SCHEMA (tabelas, RLS, RPCs)
--  Rode este arquivo INTEIRO no Supabase: SQL Editor -> New query -> Run.
--  É idempotente (pode rodar de novo sem quebrar).
-- =====================================================================

-- ---------- Extensões ----------
create extension if not exists "pgcrypto";

-- =====================================================================
--  TABELAS
-- =====================================================================

-- Perfis: 1 linha por usuário do Auth. Marca quem é admin.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        text not null default 'user' check (role in ('admin','user')),
  name        text,
  created_at  timestamptz not null default now()
);

-- Webinários (projetos). Cada usuário pode ter vários.
create table if not exists public.webinars (
  id                      uuid primary key default gen_random_uuid(),
  owner_id                uuid not null references auth.users(id) on delete cascade,
  title                   text not null default 'Novo webinário',
  slug                    text not null unique,
  status                  text not null default 'draft' check (status in ('draft','published')),
  video_url               text,
  video_duration_seconds  integer,                 -- duração do vídeo (em segundos)
  scheduled_start_at      timestamptz,             -- horário de início da "live"
  timezone                text default 'America/Sao_Paulo',
  settings                jsonb not null default '{}'::jsonb,  -- contador de espectadores, textos, etc.
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists webinars_owner_idx on public.webinars(owner_id);
create index if not exists webinars_slug_idx  on public.webinars(slug);

-- Comentários fake e respostas fake de ADM, programados por segundo do vídeo.
create table if not exists public.comments (
  id              uuid primary key default gen_random_uuid(),
  webinar_id      uuid not null references public.webinars(id) on delete cascade,
  type            text not null default 'comment' check (type in ('comment','admin_reply')),
  author_name     text not null default 'Convidado',
  avatar_url      text,
  body            text not null,
  show_at_seconds integer not null default 0,      -- aparece quando o vídeo chega nesse segundo
  reply_to_id     uuid references public.comments(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists comments_webinar_idx on public.comments(webinar_id);

-- CTAs: botão que aparece num minuto e (opcional) é "postado" no chat.
create table if not exists public.ctas (
  id              uuid primary key default gen_random_uuid(),
  webinar_id      uuid not null references public.webinars(id) on delete cascade,
  label           text not null default 'Quero participar',
  url             text not null,
  show_at_seconds integer not null default 0,
  post_in_chat    boolean not null default true,
  chat_message    text,
  created_at      timestamptz not null default now()
);
create index if not exists ctas_webinar_idx on public.ctas(webinar_id);

-- Banners dentro do webinário (imagem clicável, opcionalmente temporizada).
create table if not exists public.banners (
  id              uuid primary key default gen_random_uuid(),
  webinar_id      uuid not null references public.webinars(id) on delete cascade,
  image_url       text not null,
  link_url        text,
  position        text not null default 'below' check (position in ('top','side','below')),
  show_at_seconds integer not null default 0,
  hide_at_seconds integer,                          -- null = fica até o fim
  created_at      timestamptz not null default now()
);
create index if not exists banners_webinar_idx on public.banners(webinar_id);

-- ---------- updated_at automático ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists webinars_touch on public.webinars;
create trigger webinars_touch before update on public.webinars
  for each row execute function public.touch_updated_at();

-- ---------- cria profile automaticamente ao surgir um usuário no Auth ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
--  HELPERS
-- =====================================================================

-- É admin? (usado nas policies)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- =====================================================================
--  RLS (Row Level Security)
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.webinars enable row level security;
alter table public.comments enable row level security;
alter table public.ctas     enable row level security;
alter table public.banners  enable row level security;

-- profiles: cada um lê/edita o seu; admin vê todos.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- webinars: dono faz tudo; admin também.
drop policy if exists webinars_all on public.webinars;
create policy webinars_all on public.webinars for all
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

-- comments/ctas/banners: acesso se for dono (ou admin) do webinário pai.
drop policy if exists comments_all on public.comments;
create policy comments_all on public.comments for all
  using (exists (select 1 from public.webinars w
                 where w.id = comments.webinar_id
                   and (w.owner_id = auth.uid() or public.is_admin())))
  with check (exists (select 1 from public.webinars w
                 where w.id = comments.webinar_id
                   and (w.owner_id = auth.uid() or public.is_admin())));

drop policy if exists ctas_all on public.ctas;
create policy ctas_all on public.ctas for all
  using (exists (select 1 from public.webinars w
                 where w.id = ctas.webinar_id
                   and (w.owner_id = auth.uid() or public.is_admin())))
  with check (exists (select 1 from public.webinars w
                 where w.id = ctas.webinar_id
                   and (w.owner_id = auth.uid() or public.is_admin())));

drop policy if exists banners_all on public.banners;
create policy banners_all on public.banners for all
  using (exists (select 1 from public.webinars w
                 where w.id = banners.webinar_id
                   and (w.owner_id = auth.uid() or public.is_admin())))
  with check (exists (select 1 from public.webinars w
                 where w.id = banners.webinar_id
                   and (w.owner_id = auth.uid() or public.is_admin())));

-- Obs.: NÃO existe policy de SELECT para "anon" nessas tabelas.
-- O público lê tudo apenas pela RPC get_public_webinar (SECURITY DEFINER) abaixo.

-- =====================================================================
--  RPCs
-- =====================================================================

-- Horário autoritativo do servidor (para re-sincronizar o relógio do cliente).
create or replace function public.server_now()
returns timestamptz language sql stable as $$
  select now();
$$;
grant execute on function public.server_now() to anon, authenticated;

-- Pacote público e seguro de um webinário publicado (sem expor outras linhas/tabelas).
create or replace function public.get_public_webinar(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  w public.webinars;
  result jsonb;
begin
  select * into w from public.webinars
  where slug = p_slug and status = 'published'
  limit 1;

  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'server_now', now(),
    'webinar', jsonb_build_object(
      'id', w.id,
      'title', w.title,
      'slug', w.slug,
      'video_url', w.video_url,
      'video_duration_seconds', w.video_duration_seconds,
      'scheduled_start_at', w.scheduled_start_at,
      'timezone', w.timezone,
      'settings', w.settings
    ),
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
grant execute on function public.get_public_webinar(text) to anon, authenticated;
