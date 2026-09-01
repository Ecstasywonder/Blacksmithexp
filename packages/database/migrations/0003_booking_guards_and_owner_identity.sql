BEGIN;

-- Buffer values affect capacity and must remain stable after a service changes.
ALTER TABLE appointments
  ADD COLUMN buffer_before_minutes_snapshot integer NOT NULL DEFAULT 0,
  ADD COLUMN buffer_after_minutes_snapshot integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT appointments_buffer_before_ck
    CHECK (buffer_before_minutes_snapshot >= 0),
  ADD CONSTRAINT appointments_buffer_after_ck
    CHECK (buffer_after_minutes_snapshot >= 0);

ALTER TABLE appointments DROP CONSTRAINT appointments_no_staff_overlap;
ALTER TABLE appointments ADD CONSTRAINT appointments_no_staff_overlap
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(
      starts_at - buffer_before_minutes_snapshot * interval '1 minute',
      ends_at + buffer_after_minutes_snapshot * interval '1 minute',
      '[)'
    ) WITH &&
  )
  WHERE (status IN ('pending', 'confirmed'))
  DEFERRABLE INITIALLY IMMEDIATE;

-- Authentication starts from a verified OIDC issuer/subject pair. This narrow
-- function is the only cross-tenant lookup needed to establish an owner's
-- initial tenant context; all later reads still run under tenant RLS.
CREATE OR REPLACE FUNCTION app.resolve_owner_membership(
  p_issuer text,
  p_subject text
)
RETURNS TABLE (user_id uuid, tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
  SELECT identity.id, membership.tenant_id
  FROM public.users AS identity
  JOIN public.tenant_members AS membership
    ON membership.user_id = identity.id
  JOIN public.tenants AS tenant
    ON tenant.id = membership.tenant_id
  WHERE identity.oidc_issuer = p_issuer
    AND identity.oidc_subject = p_subject
    AND membership.role = 'owner'
    AND membership.status = 'active'
    AND tenant.status = 'active'
    AND tenant.archived_at IS NULL
  ORDER BY membership.accepted_at NULLS LAST, membership.created_at, membership.tenant_id
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.resolve_owner_membership(text, text) FROM PUBLIC;
COMMENT ON FUNCTION app.resolve_owner_membership(text, text) IS
  'Grant EXECUTE only to the application runtime role. Call only after OIDC token verification.';

-- Public endpoint rate counters are operational security data, not tenant
-- business data. Only the SECURITY DEFINER function may read or mutate them.
CREATE TABLE public_endpoint_rate_limits (
  scope_hash text NOT NULL CHECK (scope_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope_hash, window_started_at)
);

REVOKE ALL ON TABLE public_endpoint_rate_limits FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.consume_public_booking_rate_limit(
  p_scope_hash text,
  p_max_requests integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  v_window_started_at timestamptz;
  v_request_count integer;
BEGIN
  IF p_scope_hash !~ '^[0-9a-f]{64}$'
    OR p_max_requests < 1
    OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'Invalid public rate-limit input';
  END IF;

  v_window_started_at := date_bin(
    make_interval(secs => p_window_seconds),
    statement_timestamp(),
    timestamptz '1970-01-01 00:00:00+00'
  );

  INSERT INTO public.public_endpoint_rate_limits (
    scope_hash,
    window_started_at,
    request_count,
    expires_at
  ) VALUES (
    p_scope_hash,
    v_window_started_at,
    1,
    v_window_started_at + make_interval(secs => p_window_seconds * 2)
  )
  ON CONFLICT (scope_hash, window_started_at)
  DO UPDATE SET request_count = public.public_endpoint_rate_limits.request_count + 1
  RETURNING request_count INTO v_request_count;

  IF random() < 0.01 THEN
    DELETE FROM public.public_endpoint_rate_limits
    WHERE expires_at < statement_timestamp();
  END IF;

  RETURN v_request_count <= p_max_requests;
END;
$$;

REVOKE ALL ON FUNCTION app.consume_public_booking_rate_limit(text, integer, integer) FROM PUBLIC;
COMMENT ON FUNCTION app.consume_public_booking_rate_limit(text, integer, integer) IS
  'Grant EXECUTE only to the application runtime role. Stores only an HMAC scope hash.';

COMMIT;
