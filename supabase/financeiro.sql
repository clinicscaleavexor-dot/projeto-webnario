-- =====================================================================
--  Módulo Financeiro — tabelas de registros e parcelas
--  Visível somente para admin (RLS via is_admin()).
--
--  Rode no Supabase: SQL Editor -> New query -> Run.
-- =====================================================================

-- Registro principal (cliente + contrato parcelado)
CREATE TABLE IF NOT EXISTS public.financial_records (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  lead_id        uuid REFERENCES public.schedule_leads(id) ON DELETE SET NULL,
  name           text NOT NULL,
  phone          text NOT NULL,
  total_amount   numeric(10,2) NOT NULL,
  payment_date   date NOT NULL,
  installments   int NOT NULL DEFAULT 1,
  notes          text,
  created_at     timestamptz DEFAULT now()
);

-- Parcelas geradas automaticamente ao salvar o registro
CREATE TABLE IF NOT EXISTS public.financial_installments (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  record_id           uuid REFERENCES public.financial_records(id) ON DELETE CASCADE NOT NULL,
  installment_number  int NOT NULL,
  due_date            date NOT NULL,
  amount              numeric(10,2) NOT NULL,
  paid                boolean DEFAULT false,
  paid_at             timestamptz,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fi_record_idx ON public.financial_installments(record_id);

-- RLS — somente admin
ALTER TABLE public.financial_records      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_installments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fr_admin ON public.financial_records;
DROP POLICY IF EXISTS fi_admin ON public.financial_installments;

CREATE POLICY fr_admin ON public.financial_records FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY fi_admin ON public.financial_installments FOR ALL
  USING  (EXISTS (SELECT 1 FROM public.financial_records r WHERE r.id = record_id AND public.is_admin()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.financial_records r WHERE r.id = record_id AND public.is_admin()));
