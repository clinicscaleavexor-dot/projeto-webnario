-- =====================================================================
--  Tabela para múltiplas instâncias WhatsApp (futuro rodízio de 3 números)
--  Rode no Supabase: SQL Editor -> New query -> Run.
--  Por enquanto fica vazia — UI e lógica de alternância serão adicionadas depois.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.dispatch_numbers (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,           -- ex: "Número 1 - Principal"
  api_url    text        NOT NULL,           -- URL da instância Mega API
  api_token  text        NOT NULL,
  active     boolean     NOT NULL DEFAULT true,
  sort_order int         NOT NULL DEFAULT 0, -- ordem do rodízio
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dispatch_numbers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dn_admin ON public.dispatch_numbers;
CREATE POLICY dn_admin ON public.dispatch_numbers FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
