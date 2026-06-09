-- =====================================================================
--  PROJETO WEBNÁRIO — STORAGE (buckets + políticas)
--  Rode no Supabase: SQL Editor -> New query -> Run.
--
--  Os vídeos ficam públicos para LEITURA (o player precisa de range
--  requests via URL pública). O UPLOAD/edição é só para usuários logados.
--  Como o link público do webinário já é "secreto" (slug), e o video_url
--  só sai pela RPC do webinário publicado, isso é adequado para o caso.
-- =====================================================================

-- ---------- Buckets (públicos p/ leitura) ----------
insert into storage.buckets (id, name, public)
values ('webinar-videos', 'webinar-videos', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('webinar-banners', 'webinar-banners', true)
on conflict (id) do update set public = true;

-- ---------- Políticas ----------
-- Leitura pública dos dois buckets.
drop policy if exists "webinar public read" on storage.objects;
create policy "webinar public read" on storage.objects for select
  to anon, authenticated
  using (bucket_id in ('webinar-videos','webinar-banners'));

-- Upload: qualquer usuário logado.
drop policy if exists "webinar authenticated upload" on storage.objects;
create policy "webinar authenticated upload" on storage.objects for insert
  to authenticated
  with check (bucket_id in ('webinar-videos','webinar-banners'));

-- Update/Delete: só o dono do arquivo (quem fez upload).
drop policy if exists "webinar owner update" on storage.objects;
create policy "webinar owner update" on storage.objects for update
  to authenticated
  using (bucket_id in ('webinar-videos','webinar-banners') and owner = auth.uid());

drop policy if exists "webinar owner delete" on storage.objects;
create policy "webinar owner delete" on storage.objects for delete
  to authenticated
  using (bucket_id in ('webinar-videos','webinar-banners') and owner = auth.uid());
