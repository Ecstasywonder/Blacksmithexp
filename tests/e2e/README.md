# Booking regression guarantees (BEW-005)

The standard `pnpm test:e2e` runs `booking-guarantees.spec.ts` against the
production Next.js booking route and real PostgreSQL repositories. It refuses
missing database/session configuration or synthetic adapter flags. It never
reuses an existing web server. Only synthetic customer data is used.

## Standard sprint verification

Install Node.js 22+, pnpm 11.9.0, Docker with Compose, and the locked dependencies:

```sh
pnpm install --frozen-lockfile
pnpm --filter @chairly/e2e exec playwright install --with-deps chromium
pnpm verify:local
```

`verify:local` creates its own disposable PostgreSQL 16 container on localhost
port 55435, applies migrations, grants a separate runtime role, generates test
session secrets, and runs `pnpm verify`. It cleans up its own container in a
finally block; no existing application databases are reset. Override
`CHAIRLY_TEST_DB_PORT` or `CHAIRLY_E2E_PORT` if ports 55435 or 3215 are occupied.
After a forced process kill, remove only the `chairly-bew005-<pid>` Compose
project belonging to that run.

For focused iteration, `pnpm verify:local test` and
`pnpm verify:local test:e2e` provide the same isolated database setup for only
that check. Run the default `pnpm verify:local` before handoff. Production
builds use Next.js's supported Webpack path, including the server exercised by
Playwright, to avoid the observed Turbopack build stall in the local worktree.

`pnpm verify` runs formatting, lint, type checks (including browser test code),
migrations, unit/integration tests, browser tests, and the production build.
A missing prerequisite or any failing command exits nonzero. Tests have no
retries and focused tests are forbidden. PostgreSQL integration tests may skip
when run separately without database URLs, but the standard pass requires the
URLs before running any checks. `pnpm test` runs unit/integration tests;
`pnpm test:e2e` is the separate required browser step.

`.github/workflows/booking-verification.yml` runs the same `pnpm verify:local`
command on pull requests and pushes to main and BEW-005. Its check name is
`Booking guarantees and quality checks`. Repository administrators should make
that check required in branch protection; a workflow alone cannot prevent a
privileged user from bypassing merge policy. Failure artifacts contain only
synthetic fixtures and are retained for seven days.

## Acceptance criteria mapping

| Criterion | Observable assertion                                                                                                                                                                                                                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01        | Submit the actual public form; inspect exactly one database appointment and service snapshot, exact customer name/contact/preferred date-time, pending status, tenant identity, matching response ID and authenticated owner API result. Check event/audit/outbox counts atomically accompany the booking.             |
| 02        | Omit each required field independently in both UI and API; assert field-specific readable errors and zero database appointments. Reject malformed dates before correction. Guard whitespace-only fields, UUID shape, length limits, and the existing date-time format. Exercise actual server errors through the form. |
| 03        | Submit on two active tenant pages in the same run; prove each owner sees only its own ID. Reject a mismatched membership and foreign service. Verify RLS prevents cross-tenant reads and updates using the non-owner runtime role.                                                                                     |
| 04        | Dispatch two rapid browser submissions before React renders its disabled state; assert the same generated key, two successful responses with one ID, then retry sequentially and assert exactly one appointment/event/audit/outbox.                                                                                    |
| 05        | Mandatory PostgreSQL-backed Playwright configuration and the standard verification/CI command fail on missing prerequisites or any broken guarantee.                                                                                                                                                                   |

Fixtures have unique IDs/slugs per test, seed both businesses, and delete only
their own records. The runtime role is checked for no superuser/BYPASSRLS/table
ownership, and appointment RLS must be enabled and forced. Owner cookies are
signed by test helpers using the configured test secret and exercise normal
server membership checks; no production authentication bypass is introduced.
Browser accessibility and mobile overflow checks are confined to the booking
form. No new availability behaviour is implemented or required by BEW-005.

## Validation contract pinned while design rules are TBD

Keep BEW-005's shipped contract: a service UUID; a non-whitespace customer name
of 1–120 characters; a non-whitespace contact detail of 1–254 characters; and a
calendar-valid local `YYYY-MM-DDTHH:mm` value. Preserve submitted name/contact
case and whitespace. Do not replace it with a clock-only value or add new email
or phone syntax restrictions without a product decision. Existing scheduling
policies still execute on the server; test appointments use future dates and
seeded valid hours.

The real database pass also guards the timestamp adapter repair: raw SQL
reads UTC epoch milliseconds and writes explicit ISO instants, avoiding an
assumption that the driver returns JavaScript dates. Availability exception
fixtures bind local timestamp strings as text before timezone conversion so
fixture setup is independent of the machine timezone.

Invalid API fields now include additive `error.fieldErrors`, keyed by field
name with safe human-readable message arrays. The existing generic message,
error code, request ID, and success contract remain compatible. The browser
shows returned field errors and focuses the first invalid field.

The earlier synthetic adapter browser scenarios remain available via
`pnpm --filter @chairly/e2e test:synthetic`. They are supplemental and cannot
substitute for the database-backed standard verification pass.
