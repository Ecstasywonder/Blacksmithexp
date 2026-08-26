# AGENTS.md

This repository contains a multi-tenant appointment and public-page platform. These instructions apply to the entire repository unless a deeper `AGENTS.md` overrides them.

## Product invariants

1. Tenant isolation is non-negotiable. Every tenant-owned row has `tenant_id`; every private request establishes tenant context from an authenticated membership.
2. Never trust a `tenant_id`, role, price, duration, status, or staff assignment supplied by a browser. Reload authoritative values on the server.
3. Pending and confirmed appointments for one staff member must not overlap. Preserve the PostgreSQL exclusion constraint and transactional recheck.
4. Appointment status changes must follow the domain transition map and append an event/audit record atomically.
5. Store instants as UTC and schedules with IANA timezones. Never perform booking logic with server-local time.
6. Store money as integer minor units plus ISO currency code. Do not use floating point for money.
7. Notification delivery is asynchronous through the outbox. Provider failure must not undo a committed booking.
8. Historical appointments retain service name, duration, price, currency, and timezone snapshots.
9. Do not log secrets, tokens, customer contact details, addresses, or free-text notes.
10. Public resource references are not authorization secrets. Signed customer tokens are hashed at rest, scoped, revocable, and expiring.

## Repository boundaries

- `apps/web`: Next.js routes, React UI, Server Actions, Route Handlers, and adapter composition.
- `packages/domain`: framework-independent policies and use cases. It must not import React, Next.js, database drivers, or vendor SDKs.
- `packages/database`: Drizzle schema, SQL migrations, tenant transaction helpers, and repository implementations.
- `packages/shared`: small shared schemas, result types, error codes, and formatting helpers. Avoid turning it into a miscellaneous dump.
- `tests/e2e`: critical user journeys only; use lower-level tests for permutations.

Dependencies point inward: `web -> domain/shared/database`, `database -> domain/shared`, and `domain -> shared`. Vendor SDKs belong in adapters, not domain modules.

## Development rules

- Use TypeScript strict mode. Avoid `any`; validate `unknown` at boundaries.
- Prefer Server Components for reads and Server Actions for first-party UI mutations. Use Route Handlers for public APIs and provider webhooks.
- In current App Router code, await `params`, `searchParams`, `cookies()`, and `headers()` where required.
- Client Components must be synchronous and receive JSON-serializable props.
- Keep database access server-only. Never import `packages/database` from a Client Component.
- Validate environment variables once at startup and expose client variables only through an explicit public schema.
- Centralize error codes. Return safe messages with a request ID; retain causes only in redacted server telemetry.
- Keep functions small and name use cases after business actions (`requestAppointment`, `confirmAppointment`).
- Prefer explicit transactions at aggregate boundaries. Do not make network calls while a database transaction is open.
- Use `SET LOCAL app.tenant_id` only inside a transaction; never use a pooled session-wide tenant setting.
- Use forward-only migrations. Do not edit an applied migration; add another migration.
- Use expand/migrate/contract for destructive production schema changes.
- Keep user-facing text accessible and externalizable. Do not encode meaning by color alone.

## Tenant-safe query checklist

Before adding or changing a repository query:

- Does the table carry `tenant_id`?
- Is tenant context established from trusted authentication or published-slug resolution?
- Does the query include the tenant key even where RLS also applies?
- Do joins constrain both resource identity and tenant identity?
- Does the mutation check role/permission in the service layer?
- Is there an integration test proving another tenant cannot read or mutate the record?
- Is caching keyed and invalidated by tenant?

Any uncertain answer blocks merge.

## Booking change checklist

Before changing availability or appointments:

- Test minimum lead time, horizon, buffers, weekly hours, exceptions, and DST boundaries.
- Revalidate availability inside the write transaction.
- Preserve idempotency behavior and map exclusion violation `23P01` to a stable conflict error.
- Keep pending and confirmed states in the overlap constraint.
- Snapshot mutable catalog values.
- Write appointment event, audit record, and outbox events in the same transaction.
- Add a concurrent integration test when the change affects slot claims.

## Security and privacy

- Treat all browser, webhook, URL, file, and environment input as untrusted.
- Enforce authorization on the server; hiding UI controls is not authorization.
- Verify webhook signatures against the raw body and deduplicate provider event IDs.
- Protect cookie-authenticated mutations against CSRF and sensitive public endpoints with rate limits.
- For uploads, validate type, size, and content; use randomized object keys and process images before publication.
- Do not add production credentials or real customer data to code, fixtures, snapshots, logs, or issue text.
- Any platform-admin access must be explicit, time-bound, least-privileged, and audited.

## Tests required for a change

- Domain rule change: focused unit tests.
- Repository, migration, RLS, transaction, or constraint change: PostgreSQL integration tests.
- Public API contract change: validation and response contract tests.
- Critical journey or UI behavior change: Playwright end-to-end coverage and accessibility check.
- Booking write change: idempotency and parallel conflict tests.
- Tenant-owned data change: negative cross-tenant test.

Run the smallest relevant test set while iterating, then before handoff run:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm db:migrate:test
pnpm test:e2e
pnpm build
```

If a command is not implemented yet in this scaffold, add it with the feature that first requires it; do not report an unrun check as passing.

## Definition of done

A change is done when:

- acceptance criteria are met and failure/empty/loading states are handled;
- authorization and tenant isolation are tested;
- database changes include reviewed migrations and safe rollout notes;
- observability is sufficient to diagnose failures without exposing PII;
- accessibility and responsive behavior are checked for affected flows;
- documentation, environment examples, and API/schema contracts are updated;
- no unrelated user changes are overwritten.

## Pull request expectations

Summaries should state the user-visible outcome, security/tenant implications, schema or environment changes, and exact validation performed. Flag deferred work and risky assumptions explicitly. Keep pull requests scoped so booking, tenancy, and migration changes can be reviewed carefully.
