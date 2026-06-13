-- Rastreamento de packs de comentários inseridos em lote.
-- Rode no Supabase: SQL Editor → New query → Run.

alter table public.comments
  add column if not exists batch_id uuid;

create index if not exists comments_batch_idx
  on public.comments(batch_id)
  where batch_id is not null;
