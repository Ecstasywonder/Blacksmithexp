-- Only the disposable verification database uses these local credentials.
CREATE ROLE chairly_app LOGIN PASSWORD 'local-verification-app-only'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public, app TO chairly_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, tenants, tenant_members, booking_settings, locations, staff_members,
  services, service_locations, staff_services, weekly_availability,
  availability_exceptions, customers, appointments, appointment_services,
  appointment_events, idempotency_keys, outbox_events, audit_logs
TO chairly_app;
GRANT EXECUTE ON FUNCTION app.resolve_published_tenant(text),
  app.resolve_owner_membership(text, text),
  app.consume_public_booking_rate_limit(text, integer, integer)
TO chairly_app;
