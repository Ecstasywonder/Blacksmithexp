# Booking regression guarantees (BEW-005)

The standard `pnpm test:e2e` first runs `booking-guarantees.spec.ts` against
the production Next.js booking route and real PostgreSQL repositories, then
runs the existing synthetic form/inbox specs. The real-database suite refuses
missing configuration or synthetic adapter flags. Neither suite reuses an
existing web server. Only synthetic customer data is used.

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
To use an already installed Edge browser locally, set `CHAIRLY_E2E_CHANNEL=msedge`.
CI uses the locked Chromium download by default.
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
| 04        | Guard rapid same-key submissions, independent sessions, reloads and fresh-key retries with one or two available staff. Assert one appointment/event/audit/outbox and successful acknowledgements with the same ID.                                                                                                     |
| 05        | Mandatory PostgreSQL-backed Playwright configuration and the standard verification/CI command fail on missing prerequisites or any broken guarantee.                                                                                                                                                                   |

Fixtures have unique IDs/slugs per test, seed both businesses, and delete only
their own records. The runtime role is checked for no superuser/BYPASSRLS/table
ownership, and appointment RLS must be enabled and forced. Owner cookies are
signed by test helpers using the configured test secret and exercise normal
server membership checks; no production authentication bypass is introduced.
The real-database suite checks booking form accessibility and mobile overflow;
the existing supplemental suite retains its inbox accessibility check. No new availability behaviour is implemented or required by BEW-005.

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
`pnpm --filter @chairly/e2e test:synthetic`. They also run automatically after the database-backed suite and cannot
substitute for it.

## PR review regression coverage

`pnpm test:e2e` now runs the real-database guarantees followed by both existing
synthetic form/inbox specs, each against a freshly built server with no reuse or
retries. A failure in either suite fails the standard pass and CI. Synthetic
adapters are enabled only in that suite's child server environment; the final
production build uses the real adapters.

Production requests reuse one server-process database pool. A production-mode
unit test checks 100 pool acquisitions; a real-server test checks repeated
requests stay within the configured connection limit.

An identical request means the same resolved tenant, service, preferred local
time, and customer name/contact normalized with Unicode NFKC, trimmed and
collapsed whitespace, and lowercase matching. Stored customer details remain unchanged. New keys from reloads, independent
sessions, or other devices acknowledge the same pending/confirmed appointment,
including after the 24-hour key record expires. The acknowledgement returns HTTP 200 with `outcome: "duplicate"` and the
original pending-request receipt; current status comes from owner
reads. Cancelled/declined appointments do not prevent a new request, and changed
customer details that normalize differently are a different request. Concurrent independent-session tests
cover both one and two available staff, so spare capacity cannot hide duplicates.

The real suite signs its local gateway identity headers using disposable verification
credentials. The production signature validation remains enabled.
