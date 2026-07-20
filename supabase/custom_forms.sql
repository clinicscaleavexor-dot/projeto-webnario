-- =====================================================================
--  FORMULÁRIOS AVULSOS (menu "Formulário")
--  Rode no Supabase: SQL Editor -> New query -> Run.
--
--  Isolado dos webinários: aqui você cria um formulário com as
--  perguntas que quiser, recebe um webhook próprio pra cada um, e vê
--  os leads coletados. Nenhum disparo é feito a partir daqui.
-- =====================================================================

create table if not exists public.custom_forms (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  name         text not null default 'Novo formulário',
  fields       jsonb not null default '[]'::jsonb, -- [{ key, label, required }]
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists custom_forms_owner_idx on public.custom_forms(owner_id);

alter table public.custom_forms enable row level security;

drop policy if exists custom_forms_all on public.custom_forms;
create policy custom_forms_all on public.custom_forms for all
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

-- -----------------------------------------------------------------------

create table if not exists public.custom_form_leads (
  id           uuid primary key default gen_random_uuid(),
  form_id      uuid not null references public.custom_forms(id) on delete cascade,
  data         jsonb not null default '{}'::jsonb, -- payload recebido no webhook
  created_at   timestamptz not null default now()
);

create index if not exists custom_form_leads_form_idx       on public.custom_form_leads(form_id);
create index if not exists custom_form_leads_created_at_idx on public.custom_form_leads(created_at);

alter table public.custom_form_leads enable row level security;

-- Sem policy de insert: a inserção só acontece pela API com a
-- service role key (que ignora RLS), nunca direto pelo frontend.

drop policy if exists custom_form_leads_select on public.custom_form_leads;
create policy custom_form_leads_select on public.custom_form_leads for select
  using (
    exists (
      select 1 from public.custom_forms f
      where f.id = custom_form_leads.form_id
        and (f.owner_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists custom_form_leads_delete on public.custom_form_leads;
create policy custom_form_leads_delete on public.custom_form_leads for delete
  using (
    exists (
      select 1 from public.custom_forms f
      where f.id = custom_form_leads.form_id
        and (f.owner_id = auth.uid() or public.is_admin())
    )
  );
