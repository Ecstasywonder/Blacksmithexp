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

BEW-005 verification found that the original `0003` could not commit on
PostgreSQL 16: subtracting an interval from `timestamptz` is not immutable and
therefore cannot appear in its exclusion index. The unappliable expression is
corrected to convert each instant to an explicit UTC timestamp before applying
minute buffers and building a `tsrange`. Capacity still uses absolute UTC
instants and reserves both pending and confirmed appointments. This does not
change service scheduling policy or rely on the connection's timezone.

This repair is for databases where `0003` has not successfully applied. If a
deployment records a checksum for an independently modified/applied `0003`,
do not rewrite its migration ledger or run this repair over it: reconcile that
deployment through a separately reviewed forward migration. The runner retains
its checksum mismatch protection. Verify on a fresh PostgreSQL 16 database and
run the migration command twice to check replay before rollout.
