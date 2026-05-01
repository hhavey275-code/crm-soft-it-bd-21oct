-- 1) Archive table (snapshot of old data, admin-only)
CREATE TABLE IF NOT EXISTS public.seller_transactions_archive_2026_05 (
  LIKE public.seller_transactions INCLUDING ALL
);
ALTER TABLE public.seller_transactions_archive_2026_05 ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.seller_transactions_archive_2026_05 ADD COLUMN IF NOT EXISTS archive_reason text;

ALTER TABLE public.seller_transactions_archive_2026_05 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage archive" ON public.seller_transactions_archive_2026_05;
CREATE POLICY "Admins can manage archive"
  ON public.seller_transactions_archive_2026_05
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role));

-- 2) Copy all existing rows for the 3 sellers into archive
INSERT INTO public.seller_transactions_archive_2026_05
SELECT t.*, now() AS archived_at, 'May 2026 reset — carry forward only' AS archive_reason
FROM public.seller_transactions t
WHERE t.seller_id IN (
  '95a5c5aa-1130-416a-b818-7af64f1e2989', -- Faisal
  '145d3819-9e59-45f9-a0dc-a7260dbbc73b', -- Rasel
  'e5670168-73b0-4f07-a6a4-3a033ab9bb1b'  -- Najmul
);

-- 3) Delete all transactions for these 3 sellers
DELETE FROM public.seller_transactions
WHERE seller_id IN (
  '95a5c5aa-1130-416a-b818-7af64f1e2989',
  '145d3819-9e59-45f9-a0dc-a7260dbbc73b',
  'e5670168-73b0-4f07-a6a4-3a033ab9bb1b'
);

-- 4) Insert opening-balance entries (May 1, 2026)
-- Faisal: Due −৳15,60,533 → represented as USDT given (negative balance) at rate 1 so cost=1,560,533 BDT
INSERT INTO public.seller_transactions
  (seller_id, type, bdt_amount, usdt_amount, rate, description, status, created_at, entry_by_name)
VALUES
  ('95a5c5aa-1130-416a-b818-7af64f1e2989', 'usdt_received', 0, 1560533, 1,
   'Previous month carry forward (April 2026 closing balance)', 'approved',
   '2026-05-01 00:00:00+06', 'System'),
  -- Rasel: Advance +৳1,49,017 → BDT in
  ('145d3819-9e59-45f9-a0dc-a7260dbbc73b', 'bdt_payment', 149017, 0, 0,
   'Previous month carry forward (April 2026 closing balance)', 'approved',
   '2026-05-01 00:00:00+06', 'System'),
  -- Najmul: Advance +৳61,46,377 → BDT in
  ('e5670168-73b0-4f07-a6a4-3a033ab9bb1b', 'bdt_payment', 6146377, 0, 0,
   'Previous month carry forward (April 2026 closing balance)', 'approved',
   '2026-05-01 00:00:00+06', 'System');