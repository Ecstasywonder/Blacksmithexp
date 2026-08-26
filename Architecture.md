# Architecture: Chairly Multi-Tenant Booking Platform

**Status:** Proposed  
**Last updated:** 2026-08-26

## 1. Architecture objectives

The system must provide strong tenant isolation, correct appointment scheduling under concurrency, fast public pages, an auditable booking lifecycle, and a path to grow without premature distributed-system complexity.

The recommended starting point is a modular monolith. One Next.js application serves public pages, the business dashboard, server actions, and HTTP endpoints. A managed PostgreSQL database is the system of record. Background workers handle notifications and other retryable side effects through a transactional outbox.

## 2. Technology decisions

| Area | Decision | Rationale |
| --- | --- | --- |
| Web application | Next.js App Router + TypeScript | Server Components for tenant pages/read-heavy screens; Server Actions for first-party mutations; Route Handlers for public endpoints/webhooks |
| Runtime | Node.js | Broad database and provider compatibility; no Edge-only constraint |
| Database | PostgreSQL 16+ | Transactions, range/exclusion constraints, row-level security, mature managed options |
| Data access | Drizzle ORM + generated SQL migrations | Typed schema/query layer while retaining explicit SQL control |
| Validation | Zod at all external boundaries | Shared runtime validation and stable error mapping |
| Authentication | Managed OIDC provider behind an application adapter | Avoid storing passwords; keep provider-specific code at the edge of the system |
| Authorization | Tenant membership RBAC plus PostgreSQL RLS | Defense in depth; authorization remains server-side |
| Assets | S3-compatible object storage + CDN | Direct uploads, resizing pipeline, and durable tenant media |
| Email | Transactional email provider behind a notifier interface | Provider portability and retryability |
| Background work | Transactional outbox polled by a worker; durable queue when scale requires it | No lost notifications and no distributed transaction with providers |
| Observability | Structured logs, OpenTelemetry traces, error tracking, metrics | Correlation from public request through database and worker |
| Hosting | Managed Node.js web/worker services and managed PostgreSQL | Low operational overhead; platform choice remains replaceable |

Specific vendors and exact dependency versions should be recorded in ADRs and lockfiles at implementation kickoff. The domain design does not depend on a particular auth, hosting, email, or storage vendor.

## 3. Repository shape

```text
.
|-- apps/
|   `-- web/                     # Next.js UI, Server Actions, Route Handlers
|-- packages/
|   |-- database/                # Drizzle schema, migrations, tenant transaction helper
|   |-- domain/                  # Framework-independent booking and authorization logic
|   `-- shared/                  # Schemas, result/error types, formatting primitives
|-- tests/
|   |-- e2e/                     # Browser-level critical journeys
|   `-- fixtures/                # Tenant-safe deterministic test data
|-- PRD.md
|-- Architecture.md
`-- AGENTS.md
```

This is a pnpm workspace. Packages expose narrow public entry points. Domain code may depend on shared types but must not import Next.js. The web app coordinates use cases and adapters; it does not embed scheduling rules in React components.

## 4. System context

```text
Customer browser ----\
                      > Next.js web/API ---- PostgreSQL
Business browser ----/          |                 |
                                 |                 `-- outbox events
                                 |                          |
                                 |                     background worker
                                 |                          |
                                 +---- object storage       +---- email/SMS providers
                                 +---- OIDC provider
```

Trust boundaries:

- Browsers and provider webhooks are untrusted inputs.
- The web runtime authenticates actors, resolves tenant context, validates input, and invokes domain use cases.
- PostgreSQL is the final consistency and tenant-isolation boundary.
- Workers receive identifiers, reload authoritative data, and are safe to retry.

## 5. Application modules

| Module | Responsibilities |
| --- | --- |
| Identity | Map OIDC subject to local user, session claims, sign-in callbacks |
| Tenancy | Tenant lifecycle, slug resolution, memberships, roles, tenant context |
| Catalog | Locations, services, staff, service/staff assignment, publication prerequisites |
| Scheduling | Weekly availability, exceptions, slot generation, timezone conversion |
| Appointments | Booking transaction, status machine, customer management, appointment history |
| Content | Landing-page profile, social links, policies, assets, publication |
| Notifications | Outbox events, templates, provider delivery, retries, manage links |
| Audit | Append-only security and business activity records |
| Administration | Suspension, support grants, operational views; separately authorized |

Modules communicate through use-case functions and domain events, not by importing another module's internal repository.

## 6. Routing and rendering

```text
/                              platform marketing page
/{tenantSlug}                  public tenant landing page
/{tenantSlug}/book             public booking flow
/booking/{publicReference}     status/manage page; signed token required for actions
/sign-in                       business authentication
/dashboard                     authenticated tenant dashboard
/dashboard/appointments        appointment queue/calendar
/dashboard/services            service management
/dashboard/staff               staff and schedule management
/dashboard/settings            profile, locations, page, members, policies
/api/v1/public/...             public JSON endpoints needed by interactive clients
/api/webhooks/...              provider webhooks with signature verification
/api/health                    shallow liveness/readiness endpoint
```

System route names are reserved tenant slugs. Custom domains can later be normalized by a trusted-host mapping and internally rewritten to the same tenant route.

Rendering rules:

- Public landing pages are Server Components with cache keys/tags scoped by tenant and revalidated after publication changes.
- Availability is dynamic and never served as permanently authoritative cached data.
- Dashboard reads occur directly in Server Components through tenant-scoped repositories.
- Dashboard mutations use Server Actions. Public/mobile endpoints and provider webhooks use Route Handlers.
- Dynamic route `params` and request APIs are awaited according to current App Router conventions.
- The Node.js runtime is the default for database-backed routes.

## 7. Multi-tenancy model

### Tenant identity

Each business is a tenant. All tenant-owned tables contain a non-null `tenant_id`, even when it could be inferred through another foreign key. The explicit key makes policies, indexes, audit queries, and accidental cross-tenant join detection straightforward.

### Tenant resolution

- Public request: normalize slug/host, resolve only an active published tenant through a narrow database function, then establish tenant context.
- Private request: authenticate user, load membership for the selected tenant, authorize the required permission, then establish tenant context.
- The server ignores a body-provided `tenant_id` unless it exactly matches established context.

### Database boundary

The runtime uses a non-owner database role with RLS enabled and forced on tenant tables. Every tenant transaction executes `SET LOCAL app.tenant_id = '<uuid>'` before tenant queries. `SET LOCAL` is transaction-scoped and safe with pooled connections; session-wide `SET` is prohibited.

The migration role is separate and not available to the application. Public tenant resolution is performed through a minimal `SECURITY DEFINER` function that returns only an ID for published tenants and fixes its `search_path`.

RLS is defense in depth, not the sole authorization mechanism. Role permissions are checked in the application service before mutation.

### Roles and permissions

| Permission | Owner | Manager | Staff |
| --- | --- | --- | --- |
| View tenant dashboard | Yes | Yes | Limited |
| Manage appointments | Yes | Yes | Assigned appointments, policy-dependent |
| Manage services/staff/hours | Yes | Yes | Own availability, policy-dependent |
| Manage page/settings | Yes | Yes | No |
| Invite/remove members | Yes | Optional | No |
| Transfer/delete tenant | Yes | No | No |

Central permission constants and policy functions are used everywhere; route-level checks alone are insufficient.

## 8. Data model

The executable schema is in `packages/database/migrations/0001_initial.sql`; its main relationships are:

```text
users --< tenant_members >-- tenants --< locations
                                  |--< services
                                  |--< staff_members --< staff_services >-- services
                                  |--< weekly_availability
                                  |--< availability_exceptions
                                  |--< customers --< appointments --< appointment_services
                                  |                         `--< appointment_events
                                  |--< outbox_events
                                  `--< audit_logs
```

Important conventions:

- UUID primary keys; database-generated.
- `timestamptz` for instants, UTC at storage boundaries.
- IANA timezone names on locations and snapshotted on appointments.
- Money in integer minor units plus currency code.
- `created_at` and `updated_at` on mutable aggregates.
- Soft archival (`archived_at`) for entities referenced by history.
- JSONB only for variable metadata (social links, event payloads), not core relational fields.
- Foreign keys include `tenant_id` in uniqueness/lookup indexes to support isolation and query shape.
- Public references and tokens are independent from primary keys.

## 9. Availability algorithm

Inputs: tenant, location, service, optional preferred staff, date range, and current time.

1. Load active service, location, eligible staff, booking rules, weekly availability, and date exceptions in parallel where safe.
2. Convert local schedule intervals to UTC using the location IANA timezone.
3. Intersect location and staff intervals; apply closures and added availability.
4. Expand candidate starts at the configured slot interval.
5. Keep candidates where service duration plus buffers fits entirely in an interval.
6. Exclude candidates overlapping `pending` or `confirmed` appointments.
7. Apply minimum lead time and booking horizon.
8. Return UTC start/end plus timezone/offset display values and an opaque short-lived availability fingerprint if useful.

The query is an availability hint. Appointment creation repeats the decisive checks inside a database transaction.

## 10. Booking transaction and concurrency

The booking endpoint requires an idempotency key. A single transaction:

1. Establishes tenant context and locks/validates the idempotency key.
2. Reloads the active service, location, eligible staff, schedule, and exceptions.
3. Resolves “any professional” deterministically (for example, fewest bookings then stable staff ID).
4. Revalidates the requested time against current rules.
5. Inserts customer/upserts tenant-local contact identity.
6. Inserts the pending appointment and immutable service price/duration snapshots.
7. Inserts an appointment event, audit event, and notification outbox records.
8. Stores the idempotent response and commits.

PostgreSQL has a partial GiST exclusion constraint over `(staff_id, tstzrange(starts_at, ends_at))` for `pending` and `confirmed` rows. If two transactions race, at most one commits. The losing request maps SQLSTATE `23P01` to HTTP `409 BOOKING_SLOT_UNAVAILABLE` and returns instructions to refresh slots.

Status updates use optimistic concurrency (`version` or expected current status) and the allowed transition map. Every mutation is atomic with its event record.

## 11. API and error contracts

First-party UI mutations prefer Server Actions. Public JSON endpoints use versioned resources where external compatibility matters.

Example booking request:

```json
{
  "locationId": "uuid",
  "serviceIds": ["uuid"],
  "staffId": "uuid-or-null",
  "startsAt": "2026-09-02T13:00:00Z",
  "customer": {
    "name": "Ada Example",
    "email": "ada@example.com",
    "phone": "+2348000000000"
  },
  "notes": "Optional customer note",
  "policyVersion": "2026-08-01"
}
```

Response errors use:

```json
{
  "error": {
    "code": "BOOKING_SLOT_UNAVAILABLE",
    "message": "That time was just taken. Choose another available time.",
    "fieldErrors": {},
    "requestId": "01J..."
  }
}
```

Rules:

- Validate request size, content type, shape, string bounds, normalized contact values, and resource ownership.
- Do not expose database errors or whether unauthorized cross-tenant records exist.
- All retried POSTs use the same idempotency key.
- Webhooks verify raw-body signatures, timestamp freshness, provider event uniqueness, and tolerate reordering.

## 12. Authentication and customer links

Business authentication is delegated to a managed OIDC provider. The local `users` table maps a stable issuer/subject pair to a user. Session handling lives behind `getAuthenticatedUser()` so domain code is provider-independent.

Customers do not require accounts in MVP. A customer manage URL contains a high-entropy, single-purpose token. Only a hash is stored. Tokens expire, can be revoked, are compared in constant time, are excluded from logs/referrers where possible, and authorize only the named appointment actions.

## 13. Notifications and background processing

Outbox records are created in the same transaction as domain changes. A worker:

1. Claims available rows using `FOR UPDATE SKIP LOCKED`.
2. Renders the template from current event snapshot data.
3. Sends using a provider adapter and deterministic provider idempotency key.
4. Marks success or records attempt count, last error class, and next retry time.
5. Moves exhausted events to `dead` and emits an alert.

Worker leases recover after crashes. Delivery is at least once; handlers and providers must be idempotent.

## 14. Security controls

- RLS isolation tests run against the real PostgreSQL engine in CI.
- Input validation and output encoding are mandatory at trust boundaries.
- Content Security Policy, HSTS, frame restrictions, safe referrer policy, and permissions policy are configured centrally.
- CSRF tokens/origin checks protect cookie-authenticated mutations.
- Public booking, availability, sign-in, token, upload, and webhook endpoints have risk-based rate limits.
- File uploads use signed direct uploads, content sniffing, allowlisted formats, size limits, randomized keys, and image processing before publication.
- SSRF defenses restrict any server-side remote fetch.
- Secrets are injected per environment and rotated; `.env.example` contains names only.
- Audit logs capture actor, tenant, action, target, request ID, timestamp, and safe metadata.
- Dependency, secret, static analysis, migration, and container scans run in CI.
- Platform support access is separately authenticated, time-limited, reason-coded, and alerted.

## 15. Caching and performance

- Cache only public, published tenant content using a tenant-specific tag.
- Invalidate the tenant tag after profile/catalog publication changes.
- Never share a private dashboard cache across tenant/user boundaries.
- Availability responses use short private/no-store semantics unless their cache key includes every relevant tenant/resource/version input.
- Index appointments by tenant/location/time, tenant/staff/time, and tenant/status/time.
- Use cursor pagination for audit logs, customers, and long appointment histories.
- Avoid browser-to-internal-API round trips for Server Component reads.

## 16. Observability and operations

Every request receives a correlation ID propagated to logs, traces, database query context, audit records, and outbox events.

Key metrics:

- HTTP latency/error rate by route class (never raw tenant slug).
- Availability computation latency and candidate counts.
- Booking successes, conflicts, validation failures, and idempotent replays.
- Pending request age and confirmation time.
- Outbox lag, attempts, failures, and dead letters.
- Database pool saturation, slow queries, locks, and exclusion conflicts.

Alerts cover elevated booking failures, cross-tenant policy test failure, outbox lag/dead letters, database health, authentication outages, and backup failures.

Runbooks are required for notification provider failure, compromised manage tokens, tenant suspension, database restore, stuck migrations, and suspected data isolation incidents.

## 17. Environments and delivery

- `local`: containerized PostgreSQL and provider fakes.
- `preview`: isolated application deployment; no production PII; ephemeral or namespaced database.
- `staging`: production-like managed services and sanitized fixtures.
- `production`: protected environment with least-privilege identities and audited access.

CI sequence:

1. formatting, linting, and TypeScript;
2. unit and domain tests;
3. migration apply on an empty PostgreSQL database;
4. repository and RLS integration tests;
5. production build;
6. end-to-end smoke tests and accessibility checks;
7. security scans.

Migrations are forward-only in production. Destructive schema changes use expand/migrate/contract releases. Deployments run migrations as a separate, single-writer release step before compatible application rollout.

## 18. Testing strategy

- **Unit:** status transitions, permission policies, price/duration snapshots, timezone and slot interval functions.
- **Property tests:** generated schedule/exception combinations never return overlapping or out-of-bounds slots.
- **Integration:** repositories, RLS, idempotency, outbox atomicity, exclusion conflicts, soft archival.
- **Concurrency:** parallel booking attempts for the same staff/time yield exactly one success.
- **Contract:** auth/storage/email adapters and webhook signature behavior.
- **End-to-end:** tenant onboarding/publish, customer request, business confirm/decline/cancel, signed customer link.
- **Security:** cross-tenant ID substitution, role downgrade, CSRF, rate limit, expired token, upload abuse.
- **Accessibility:** automated checks plus keyboard/screen-reader manual checks on critical flows.

## 19. Architectural decision records

Create ADRs in `docs/adr/` as decisions become concrete. Initial required ADRs:

1. Modular monolith and package boundaries.
2. PostgreSQL RLS tenant strategy and connection-pool handling.
3. Managed OIDC provider selection.
4. Object storage and image processing provider.
5. Email provider and worker execution model.
6. Public URL and future custom-domain strategy.
7. Pending booking hold/expiry policy.

## 20. Evolution path

Scale the monolith vertically and optimize queries before splitting services. The first likely independently scaled component is the outbox worker. Extract availability/appointments only if measured load, deployment isolation, or team ownership requires it. The PostgreSQL exclusion constraint and domain APIs remain authoritative regardless of process boundaries.
