-- Permite que espectadores (anônimos) postem no chat ao vivo.
-- Rode no Supabase: SQL Editor → New query → Run.

-- INSERT público (qualquer visitante pode comentar)
drop policy if exists lcm_viewer_insert on public.live_comments;
create policy lcm_viewer_insert on public.live_comments
  for insert with check (true);

-- SELECT público (Realtime precisa de SELECT para funcionar com usuários anônimos)
drop policy if exists lcm_viewer_select on public.live_comments;
create policy lcm_viewer_select on public.live_comments
  for select using (true);
