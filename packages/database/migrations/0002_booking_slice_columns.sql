BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS contact_detail text;

UPDATE customers
SET contact_detail = email
WHERE contact_detail IS NULL;

ALTER TABLE customers
  ALTER COLUMN contact_detail SET NOT NULL;

CREATE INDEX IF NOT EXISTS customers_tenant_contact_detail_idx
  ON customers (tenant_id, contact_detail);

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS preferred_time_label text;

UPDATE appointments
SET preferred_time_label = to_char(starts_at AT TIME ZONE 'UTC', 'HH12:MI AM')
WHERE preferred_time_label IS NULL;

ALTER TABLE appointments
  ALTER COLUMN preferred_time_label SET NOT NULL;

COMMENT ON COLUMN customers.contact_detail IS
  'Exact contact detail entered by the customer for dashboard follow-up.';

COMMENT ON COLUMN appointments.preferred_time_label IS
  'Customer-facing preferred time label captured at request creation.';

COMMIT;
