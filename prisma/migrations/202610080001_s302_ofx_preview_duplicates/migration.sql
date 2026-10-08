ALTER TABLE public.ingestion_items
  DROP CONSTRAINT ingestion_items_duplicate_shape_check;

ALTER TABLE public.ingestion_items
  ADD CONSTRAINT ingestion_items_duplicate_shape_check
  CHECK (
    (status = 'previewed')
    OR (status = 'imported' AND is_duplicate = false)
    OR (status = 'ignored_duplicate' AND is_duplicate = true)
    OR (status = 'failed' AND is_duplicate IS NULL)
  );
