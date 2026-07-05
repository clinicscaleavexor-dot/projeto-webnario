-- =====================================================================
--  Vincula instâncias WhatsApp a contas de usuário
--  Rode no Supabase: SQL Editor -> New query -> Run.
-- =====================================================================

-- Adiciona campo owner_id para vincular instância a um usuário
ALTER TABLE public.dispatch_numbers
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS dn_owner_idx ON public.dispatch_numbers(owner_id);

-- Atualiza RLS: admin vê/gerencia tudo; usuário vê/gerencia as suas
DROP POLICY IF EXISTS dn_admin  ON public.dispatch_numbers;
DROP POLICY IF EXISTS dn_owner  ON public.dispatch_numbers;
CREATE POLICY dn_owner ON public.dispatch_numbers FOR ALL
  USING  (owner_id = auth.uid() OR public.is_admin())
  WITH CHECK (owner_id = auth.uid() OR public.is_admin());

-- Insere a instância atual (Mega API) vinculada à conta ADM
-- api_url = URL base sem o sufixo /text ou /mediaUrl
INSERT INTO public.dispatch_numbers (name, api_url, api_token, active, sort_order, owner_id)
VALUES (
  'Instância Principal',
  'https://apinocode01.megaapi.com.br/rest/sendMessage/megacode-MJjV24kQIXz',
  'MJjV24kQIXz',
  true,
  0,
  (SELECT id FROM auth.users WHERE email = 'chrestopherm@gmail.com')
)
ON CONFLICT DO NOTHING;
