BEGIN;

-- Bound the cross-key retry lookup without indexing customer contact details.
CREATE INDEX appointments_public_retry_lookup_idx
  ON appointments (tenant_id, preferred_time_local_snapshot)
  WHERE source = 'public_web' AND status IN ('pending', 'confirmed');

COMMIT;
