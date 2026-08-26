BEGIN;

-- Required for UUID generation and range-based overlap protection.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS app;

CREATE TYPE tenant_status AS ENUM ('active', 'suspended', 'deleted');
CREATE TYPE member_role AS ENUM ('owner', 'manager', 'staff');
CREATE TYPE member_status AS ENUM ('invited', 'active', 'disabled');
CREATE TYPE appointment_status AS ENUM ('pending', 'confirmed', 'declined', 'cancelled', 'completed', 'no_show');
CREATE TYPE appointment_source AS ENUM ('public_web', 'dashboard', 'import');
CREATE TYPE actor_type AS ENUM ('customer', 'member', 'system', 'platform_admin');
CREATE TYPE exception_kind AS ENUM ('closed', 'available');
CREATE TYPE outbox_status AS ENUM ('pending', 'processing', 'delivered', 'dead');

-- Global identity and tenant membership. Authentication remains external.
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oidc_issuer text NOT NULL,
  oidc_subject text NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL,
  last_signed_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_oidc_identity_uq UNIQUE (oidc_issuer, oidc_subject)
);
CREATE INDEX users_email_idx ON users (email);

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  slug text NOT NULL,
  display_name text NOT NULL,
  legal_name text,
  description text,
  status tenant_status NOT NULL DEFAULT 'active',
  is_published boolean NOT NULL DEFAULT false,
  default_currency text NOT NULL DEFAULT 'NGN',
  contact_email text,
  contact_phone text,
  logo_url text,
  cover_image_url text,
  brand_color text,
  social_links jsonb NOT NULL DEFAULT '{}'::jsonb,
  cancellation_policy text,
  policy_version text NOT NULL DEFAULT 'initial',
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenants_slug_uq UNIQUE (slug),
  CONSTRAINT tenants_slug_format_ck CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$'),
  CONSTRAINT tenants_currency_ck CHECK (default_currency ~ '^[A-Z]{3}$')
);

CREATE TABLE tenant_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role member_role NOT NULL,
  status member_status NOT NULL DEFAULT 'invited',
  invited_by_user_id uuid REFERENCES users(id),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_members_tenant_user_uq UNIQUE (tenant_id, user_id)
);
CREATE INDEX tenant_members_user_idx ON tenant_members (user_id, status);

CREATE TABLE booking_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  slot_interval_minutes integer NOT NULL DEFAULT 15 CHECK (slot_interval_minutes BETWEEN 5 AND 240),
  minimum_lead_minutes integer NOT NULL DEFAULT 60 CHECK (minimum_lead_minutes BETWEEN 0 AND 525600),
  booking_horizon_days integer NOT NULL DEFAULT 90 CHECK (booking_horizon_days BETWEEN 1 AND 730),
  pending_expiry_minutes integer CHECK (pending_expiry_minutes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Tenant catalog and availability configuration.
CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  address_line_1 text NOT NULL,
  address_line_2 text,
  city text NOT NULL,
  region text,
  postal_code text,
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  time_zone text NOT NULL,
  phone text,
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locations_id_tenant_uq UNIQUE (id, tenant_id)
);
CREATE INDEX locations_tenant_active_idx ON locations (tenant_id, is_active);
CREATE UNIQUE INDEX locations_one_primary_uq ON locations (tenant_id) WHERE is_primary AND is_active AND archived_at IS NULL;

CREATE TABLE staff_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid REFERENCES users(id),
  display_name text NOT NULL,
  bio text,
  photo_url text,
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_members_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT staff_members_tenant_user_uq UNIQUE (tenant_id, user_id)
);
CREATE INDEX staff_members_tenant_active_idx ON staff_members (tenant_id, is_active);

CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  description text,
  category text,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 1440),
  buffer_before_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_before_minutes >= 0),
  buffer_after_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_after_minutes >= 0),
  price_minor bigint NOT NULL CHECK (price_minor >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT services_id_tenant_uq UNIQUE (id, tenant_id)
);
CREATE INDEX services_tenant_active_sort_idx ON services (tenant_id, is_active, sort_order);

CREATE TABLE service_locations (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  service_id uuid NOT NULL,
  location_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service_id, location_id),
  FOREIGN KEY (service_id, tenant_id) REFERENCES services(id, tenant_id),
  FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id)
);
CREATE INDEX service_locations_tenant_idx ON service_locations (tenant_id);

CREATE TABLE staff_services (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  staff_id uuid NOT NULL,
  service_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, service_id),
  FOREIGN KEY (staff_id, tenant_id) REFERENCES staff_members(id, tenant_id),
  FOREIGN KEY (service_id, tenant_id) REFERENCES services(id, tenant_id)
);
CREATE INDEX staff_services_tenant_idx ON staff_services (tenant_id);

CREATE TABLE weekly_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  location_id uuid NOT NULL,
  staff_id uuid,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  starts_local_at time NOT NULL,
  ends_local_at time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_availability_time_ck CHECK (starts_local_at < ends_local_at),
  CONSTRAINT weekly_availability_location_fk FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id),
  CONSTRAINT weekly_availability_staff_fk FOREIGN KEY (staff_id, tenant_id) REFERENCES staff_members(id, tenant_id)
);
CREATE INDEX weekly_availability_lookup_idx ON weekly_availability (tenant_id, location_id, staff_id, day_of_week);

CREATE TABLE availability_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  location_id uuid NOT NULL,
  staff_id uuid,
  kind exception_kind NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT availability_exceptions_range_ck CHECK (starts_at < ends_at),
  CONSTRAINT availability_exceptions_location_fk FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id),
  CONSTRAINT availability_exceptions_staff_fk FOREIGN KEY (staff_id, tenant_id) REFERENCES staff_members(id, tenant_id)
);
CREATE INDEX availability_exceptions_lookup_idx ON availability_exceptions (tenant_id, location_id, staff_id, starts_at);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  marketing_consent_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_id_tenant_uq UNIQUE (id, tenant_id)
);
CREATE UNIQUE INDEX customers_tenant_email_uq ON customers (tenant_id, lower(email));
CREATE INDEX customers_tenant_name_idx ON customers (tenant_id, name);

-- Appointment aggregates snapshot mutable catalog values for reliable history.
CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  public_reference text NOT NULL UNIQUE,
  location_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  status appointment_status NOT NULL DEFAULT 'pending',
  source appointment_source NOT NULL DEFAULT 'public_web',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  total_price_minor bigint NOT NULL CHECK (total_price_minor >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  customer_notes text,
  policy_version text NOT NULL,
  manage_token_hash text,
  manage_token_expires_at timestamptz,
  cancellation_reason text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointments_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT appointments_range_ck CHECK (starts_at < ends_at),
  CONSTRAINT appointments_location_fk FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id),
  CONSTRAINT appointments_staff_fk FOREIGN KEY (staff_id, tenant_id) REFERENCES staff_members(id, tenant_id),
  CONSTRAINT appointments_customer_fk FOREIGN KEY (customer_id, tenant_id) REFERENCES customers(id, tenant_id)
);
CREATE INDEX appointments_tenant_status_start_idx ON appointments (tenant_id, status, starts_at);
CREATE INDEX appointments_tenant_staff_start_idx ON appointments (tenant_id, staff_id, starts_at);
CREATE INDEX appointments_tenant_location_start_idx ON appointments (tenant_id, location_id, starts_at);

ALTER TABLE appointments ADD CONSTRAINT appointments_no_staff_overlap
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status IN ('pending', 'confirmed'))
  DEFERRABLE INITIALLY IMMEDIATE;

CREATE TABLE appointment_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  appointment_id uuid NOT NULL,
  service_id uuid,
  name_snapshot text NOT NULL,
  duration_minutes_snapshot integer NOT NULL CHECK (duration_minutes_snapshot > 0),
  price_minor_snapshot bigint NOT NULL CHECK (price_minor_snapshot >= 0),
  currency_snapshot text NOT NULL CHECK (currency_snapshot ~ '^[A-Z]{3}$'),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_services_appointment_fk FOREIGN KEY (appointment_id, tenant_id) REFERENCES appointments(id, tenant_id),
  CONSTRAINT appointment_services_service_fk FOREIGN KEY (service_id, tenant_id) REFERENCES services(id, tenant_id)
);
CREATE INDEX appointment_services_appointment_idx ON appointment_services (tenant_id, appointment_id);

CREATE TABLE appointment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  appointment_id uuid NOT NULL,
  actor_type actor_type NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  event_type text NOT NULL,
  from_status appointment_status,
  to_status appointment_status,
  reason text,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_events_appointment_fk FOREIGN KEY (appointment_id, tenant_id) REFERENCES appointments(id, tenant_id)
);
CREATE INDEX appointment_events_history_idx ON appointment_events (tenant_id, appointment_id, occurred_at);

CREATE TABLE idempotency_keys (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  key text NOT NULL,
  request_hash text NOT NULL,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, key)
);
CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys (expires_at);

-- Side effects and audit history are appended in the same domain transaction.
CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status outbox_status NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  delivered_at timestamptz,
  last_error_code text,
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_events_claim_idx ON outbox_events (status, available_at, created_at);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_type actor_type NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  request_id text NOT NULL,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_tenant_time_idx ON audit_logs (tenant_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.resolve_published_tenant(p_slug text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id
  FROM tenants
  WHERE slug = lower(p_slug)
    AND status = 'active'
    AND is_published = true
    AND archived_at IS NULL
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.resolve_published_tenant(text) FROM PUBLIC;
COMMENT ON FUNCTION app.resolve_published_tenant(text) IS
  'Grant EXECUTE only to the application runtime role. Function owner must be the migration/BYPASSRLS role.';

-- Defense-in-depth tenant isolation. Runtime queries must also include tenant_id.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_isolation ON tenants
  USING (id = app.current_tenant_id())
  WITH CHECK (id = app.current_tenant_id());

ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_members_isolation ON tenant_members
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE booking_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY booking_settings_isolation ON booking_settings
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations FORCE ROW LEVEL SECURITY;
CREATE POLICY locations_isolation ON locations
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_members FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_members_isolation ON staff_members
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE services FORCE ROW LEVEL SECURITY;
CREATE POLICY services_isolation ON services
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE service_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_locations FORCE ROW LEVEL SECURITY;
CREATE POLICY service_locations_isolation ON service_locations
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE staff_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_services FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_services_isolation ON staff_services
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE weekly_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_availability FORCE ROW LEVEL SECURITY;
CREATE POLICY weekly_availability_isolation ON weekly_availability
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE availability_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_exceptions FORCE ROW LEVEL SECURITY;
CREATE POLICY availability_exceptions_isolation ON availability_exceptions
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
CREATE POLICY customers_isolation ON customers
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;
CREATE POLICY appointments_isolation ON appointments
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE appointment_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_services FORCE ROW LEVEL SECURITY;
CREATE POLICY appointment_services_isolation ON appointment_services
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE appointment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_events FORCE ROW LEVEL SECURITY;
CREATE POLICY appointment_events_isolation ON appointment_events
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_keys_isolation ON idempotency_keys
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_events_isolation ON outbox_events
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_isolation ON audit_logs
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

COMMENT ON COLUMN appointments.manage_token_hash IS 'Hash only; never store the customer manage token plaintext.';
COMMENT ON COLUMN appointment_events.safe_metadata IS 'Must not contain customer contact details, notes, secrets, or tokens.';
COMMENT ON COLUMN audit_logs.safe_metadata IS 'Security metadata only; redact PII, credentials, and signed URLs.';

COMMIT;
