# Database migrations

`0001_initial.sql` is the reviewed initial PostgreSQL schema and includes constraints that are intentionally database-specific: row-level security, tenant-consistent composite foreign keys, and the active-appointment GiST exclusion constraint.

Drizzle-generated migrations belong in `generated/`. Before production use, consolidate the generated baseline with this reviewed migration or configure a migration runner that applies both exactly once. Never apply migrations with the runtime application role.

Deployment must create separate roles outside this migration:

- migration/owner role with schema ownership and `BYPASSRLS`;
- web runtime role without ownership or `BYPASSRLS`, granted only required tables/functions;
- worker role with narrowly scoped outbox claim/update access.

The runtime must wrap tenant work in a transaction and use `SET LOCAL app.tenant_id` before any tenant query.

