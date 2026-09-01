BEGIN;

-- Keep the customer's single contact field and local preferred time exactly as
-- entered. Appointment-level snapshots prevent later customer edits from
-- changing historical request details.
ALTER TABLE customers ADD COLUMN contact_detail text;

UPDATE customers
SET contact_detail = COALESCE(NULLIF(email, ''), NULLIF(phone, ''), 'Unavailable');

ALTER TABLE customers ALTER COLUMN contact_detail SET NOT NULL;
ALTER TABLE customers ALTER COLUMN email DROP NOT NULL;

DROP INDEX customers_tenant_email_uq;
CREATE UNIQUE INDEX customers_tenant_email_uq
  ON customers (tenant_id, lower(email))
  WHERE email IS NOT NULL;

ALTER TABLE appointments
  ADD COLUMN customer_name_snapshot text,
  ADD COLUMN customer_contact_snapshot text,
  ADD COLUMN preferred_time_local_snapshot text;

UPDATE appointments AS appointment
SET
  customer_name_snapshot = customer.name,
  customer_contact_snapshot = customer.contact_detail,
  preferred_time_local_snapshot = to_char(
    appointment.starts_at AT TIME ZONE appointment.time_zone,
    'YYYY-MM-DD"T"HH24:MI'
  )
FROM customers AS customer
WHERE customer.id = appointment.customer_id
  AND customer.tenant_id = appointment.tenant_id;

ALTER TABLE appointments
  ALTER COLUMN customer_name_snapshot SET NOT NULL,
  ALTER COLUMN customer_contact_snapshot SET NOT NULL,
  ALTER COLUMN preferred_time_local_snapshot SET NOT NULL;

COMMIT;
