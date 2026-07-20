-- =====================================================================
--  LEADS RECEBIDOS POR WEBHOOK (formulário externo)
--  Rode no Supabase: SQL Editor -> New query -> Run.
--
--  Esses leads chegam via POST em /api/webhook-lead?webinar_id=...
--  (Vercel, usa a service role key) e ficam só salvos aqui — nenhum
--  disparo automático é feito a partir deles.
-- =====================================================================

create table if not exists public.webhook_form_leads (
  id           uuid primary key default gen_random_uuid(),
  webinar_id   uuid not null references public.webinars(id) on delete cascade,
  name         text not null,
  phone        text not null,
  raw          jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists webhook_form_leads_webinar_idx    on public.webhook_form_leads(webinar_id);
create index if not exists webhook_form_leads_created_at_idx on public.webhook_form_leads(created_at);

alter table public.webhook_form_leads enable row level security;

-- Sem policy de insert: a inserção só acontece pela Edge/API com a
-- service role key (que ignora RLS), nunca direto pelo frontend.

-- Apenas o dono do webinário (ou admin) pode ler os leads
drop policy if exists webhook_form_leads_select on public.webhook_form_leads;
create policy webhook_form_leads_select on public.webhook_form_leads for select
  using (
    exists (
      select 1 from public.webinars w
      where w.id = webhook_form_leads.webinar_id
        and (w.owner_id = auth.uid() or public.is_admin())
    )
  );

-- Apenas dono/admin pode deletar leads
drop policy if exists webhook_form_leads_delete on public.webhook_form_leads;
create policy webhook_form_leads_delete on public.webhook_form_leads for delete
  using (
    exists (
      select 1 from public.webinars w
      where w.id = webhook_form_leads.webinar_id
        and (w.owner_id = auth.uid() or public.is_admin())
    )
  );
