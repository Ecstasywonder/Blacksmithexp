# Chairly — Multi-Tenant Appointment SaaS

Chairly is a multi-tenant public-page and appointment-request platform for salons, barbers, makeup artists, and related small businesses.

The project focuses on **secure multi-tenancy, API design, database boundaries, authorization, reliability, and automated testing**.

## Engineering Highlights

- Multi-tenant Next.js application architecture
- PostgreSQL schema, migrations, and database boundary
- Framework-independent domain layer for booking and authorization rules
- Shared validation and error contracts
- Managed OpenID Connect authentication
- Tenant-aware authorization and database security boundaries
- Idempotent public booking API
- Rate limiting and request-size controls
- HMAC-based trusted-proxy client identity
- Constant-time signature comparison and fail-closed behavior
- Request IDs and safe customer-facing errors
- Browser-based end-to-end testing

## Workspace

- `apps/web` — Next.js App Router application
- `packages/database` — PostgreSQL schema, migrations, and database boundary
- `packages/domain` — framework-independent booking and authorization rules
- `packages/shared` — shared validation and error contracts
- `tests/e2e` — critical browser journeys

## Architecture & Documentation

The repository includes:

- [Product requirements](./PRD.md)
- [Technical architecture](./Architecture.md)
- [Engineering guidance](./AGENTS.md)

The architecture deliberately separates presentation, domain rules, persistence, validation, and authentication concerns.

## Public Booking API

`POST /api/public/{tenantSlug}/appointments`

A newly created request returns `201` with `outcome: "created"`.

An idempotent replay returns `200` with `outcome: "duplicate"` and the original appointment ID.

Invalid, conflicting, rate-limited, and internal failures use safe customer-facing messages and include a request ID. Rate-limited responses include `Retry-After`.

## Security Model

### Authentication

Business owners authenticate through a managed OpenID Connect provider. The callback requires a matching local user and active owner membership; tenant and role information are not accepted from the browser.

### Database Boundaries

The runtime role must not own schema objects or have `BYPASSRLS`. Application access is constrained through explicit database functions for published tenants, owner membership, and public booking rate limits.

### Trusted Proxy Identity

For self-hosted deployments, the trusted gateway must strip inbound client-identity headers and set the configured client IP header plus its HMAC signature.

The application validates the header and secret, compares the signature in constant time, fails closed when identity data is invalid, and does not trust `x-forwarded-for` by default.

### Request Protection

The booking endpoint enforces an 8 KiB JSON request limit without buffering an unbounded request body.

Rate-limit counters persist only an HMAC-derived client identifier rather than the raw client address.

## Local Development

### Prerequisites

- Node.js 22+
- pnpm 11+
- PostgreSQL 16+

### Setup

1. Copy `.env.example` to `.env.local`.
2. Configure local-only values.
3. Start PostgreSQL.
4. Configure the migration and application roles described in the architecture.
5. Run:

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

Do not use production customer data or credentials in local development.

## Testing

Critical browser journeys are covered by the `tests/e2e` workspace.

The project also separates business rules into a framework-independent domain package, making core booking and authorization behavior easier to reason about and test independently from the web layer.

## Portfolio Focus

**Multi-tenancy → authorization → database security → API reliability → abuse prevention → automated testing**

## Author

**Chinwendu Onyeani**  
Software / DevOps Engineer

GitHub: https://github.com/Ecstasywonder  
Email: chinwenduonyeani@gmail.com
