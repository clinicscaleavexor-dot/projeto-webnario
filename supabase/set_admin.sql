-- Registra um usuário como admin pelo e-mail.
-- Rode no Supabase: SQL Editor → New query → Run.

update public.profiles
set role = 'admin'
where id = (
  select id from auth.users where email = 'chrestopherm@gmail.com'
);
