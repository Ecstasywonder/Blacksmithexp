# Database migrations

The numbered SQL files are reviewed, forward-only migrations. `0001_initial.sql` contains the PostgreSQL-specific baseline: row-level security, tenant-consistent composite foreign keys, and the active-appointment GiST exclusion constraint. `0002_pending_appointment_requests.sql` adds exact customer/contact/preferred-time snapshots while safely backfilling existing appointments. `0004_immutable_booking_guards.sql` adds buffer snapshots to the overlap constraint plus narrowly scoped owner-identity and public-rate-limit functions. It supersedes the unapplyable `0003` without changing that historical file.

`pnpm db:migrate` applies numbered migrations in order, records their SHA-256 checksums in `chairly_schema_migrations`, and refuses to continue if an applied migration was edited. Never apply migrations with the runtime application role.

Deployment must create separate roles outside this migration:

- migration/owner role with schema ownership and `BYPASSRLS`;
- web runtime role without ownership or `BYPASSRLS`, granted only required tables/functions;
- worker role with narrowly scoped outbox claim/update access.

The runtime must wrap tenant work in a transaction and use `SET LOCAL app.tenant_id` before any tenant query.

## `0004` rollout notes

Recreating the GiST exclusion constraint requires a table lock while PostgreSQL validates existing appointment ranges. Apply `0004_immutable_booking_guards.sql` during a controlled low-traffic migration window and confirm existing pending/confirmed rows do not overlap when service buffers are treated as zero. Grant only `EXECUTE` on the two new `app` functions to the runtime role after the migration; do not grant direct access to `public_endpoint_rate_limits`.

PostgreSQL rejects `0003` with SQLSTATE `42P17`: adding an interval to a `timestamptz` depends on the session timezone and cannot appear in an immutable index expression. The migration runner deliberately skips **unapplied** `0003`, then applies its complete replacement `0004`. It does not falsely record `0003` as applied. Existing `0003` ledger entries still undergo checksum validation; `0004` also supports that schema by retaining existing columns and the rate-limit table. No prior migration bytes/checksums change.

The replacement converts instants to UTC for minute arithmetic and back to `timestamptz`, preserving pending/confirmed buffered overlap checks independent of session timezone. The old constraint is replaced atomically inside the migration transaction. If existing buffered ranges overlap, migration fails and rolls back: resolve those records through the normal domain workflow before retrying; never disable the overlap guard. Take a backup and allow a table-lock window for non-disposable databases. No environment variables or data backfill are added.

See [PostgreSQL date/time arithmetic](https://www.postgresql.org/docs/16/functions-datetime.html) for timezone semantics.
