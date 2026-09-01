# Database migrations

The numbered SQL files are reviewed, forward-only migrations. `0001_initial.sql` contains the PostgreSQL-specific baseline: row-level security, tenant-consistent composite foreign keys, and the active-appointment GiST exclusion constraint. `0002_pending_appointment_requests.sql` adds exact customer/contact/preferred-time snapshots while safely backfilling existing appointments. `0003_booking_guards_and_owner_identity.sql` adds immutable buffer snapshots to the overlap constraint plus narrowly scoped owner-identity and public-rate-limit functions.

`pnpm db:migrate` applies numbered migrations in order, records their SHA-256 checksums in `chairly_schema_migrations`, and refuses to continue if an applied migration was edited. Never apply migrations with the runtime application role.

Deployment must create separate roles outside this migration:

- migration/owner role with schema ownership and `BYPASSRLS`;
- web runtime role without ownership or `BYPASSRLS`, granted only required tables/functions;
- worker role with narrowly scoped outbox claim/update access.

The runtime must wrap tenant work in a transaction and use `SET LOCAL app.tenant_id` before any tenant query.

## `0003` rollout notes

Recreating the GiST exclusion constraint requires a table lock while PostgreSQL validates existing appointment ranges. Apply `0003_booking_guards_and_owner_identity.sql` during a controlled low-traffic migration window and confirm existing pending/confirmed rows do not overlap when service buffers are treated as zero. Grant only `EXECUTE` on the two new `app` functions to the runtime role after the migration; do not grant direct access to `public_endpoint_rate_limits`.
