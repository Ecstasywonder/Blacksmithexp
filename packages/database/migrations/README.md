# Database migrations

The numbered SQL files are reviewed, forward-only migrations. `0001_initial.sql` contains the PostgreSQL-specific baseline: row-level security, tenant-consistent composite foreign keys, and the active-appointment GiST exclusion constraint. `0002_pending_appointment_requests.sql` adds exact customer/contact/preferred-time snapshots while safely backfilling existing appointments.

`pnpm db:migrate` applies numbered migrations in order, records their SHA-256 checksums in `chairly_schema_migrations`, and refuses to continue if an applied migration was edited. Never apply migrations with the runtime application role.

Deployment must create separate roles outside this migration:

- migration/owner role with schema ownership and `BYPASSRLS`;
- web runtime role without ownership or `BYPASSRLS`, granted only required tables/functions;
- worker role with narrowly scoped outbox claim/update access.

The runtime must wrap tenant work in a transaction and use `SET LOCAL app.tenant_id` before any tenant query.
