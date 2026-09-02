# Chairly

Multi-tenant public-page and appointment-request platform for salons, barbers, makeup artists, and related small businesses. A public booking request is persisted as a tenant-owned pending appointment and appears automatically in the authenticated owner dashboard.

The product requirements are in [PRD.md](./PRD.md), the technical design is in [Architecture.md](./Architecture.md), and repository guidance is in [AGENTS.md](./AGENTS.md).

## Workspace

- `apps/web` — Next.js App Router application
- `packages/database` — PostgreSQL schema, migrations, and database boundary
- `packages/domain` — framework-independent booking and authorization rules
- `packages/shared` — shared validation and error contracts
- `tests/e2e` — critical browser journeys

## Local setup

1. Install Node.js 22+ and pnpm 11+.
2. Copy `.env.example` to `.env.local` and set local-only values.
3. Start PostgreSQL 16+ and create the application and migration roles described in the architecture.
4. Run `pnpm install`, then run `pnpm db:migrate` with the migration role configured in `MIGRATION_DATABASE_URL`.
5. Run `pnpm dev`.

Do not use production customer data or credentials in local development.

## Business authentication

Configure a managed OpenID Connect provider with the callback URL `${APP_ORIGIN}/auth/callback`. `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`, and a random `AUTH_SESSION_SECRET` of at least 32 characters are required. The provider issuer/subject pair must already map to a local `users` row with an active owner membership; the callback never accepts a tenant or role from the browser.

The deployment runtime role needs `EXECUTE` on `app.resolve_published_tenant(text)`, `app.resolve_owner_membership(text, text)`, and `app.consume_public_booking_rate_limit(text, integer, integer)`. It must not own schema objects or have `BYPASSRLS`.

## Public booking contract

`POST /api/public/{tenantSlug}/appointments` accepts JSON containing `serviceId`, `customerName`, `contactDetail`, and a timezone-local `preferredTime` in `YYYY-MM-DDTHH:mm` form. Successful requests return `201` with an appointment ID and `pending` status. Invalid, unmatched, conflicting, rate-limited, and internal failures use the safe customer message documented in the product requirements and include a request ID; `429` responses include `Retry-After`.

Set `RATE_LIMIT_SECRET` to a separate random value of at least 32 characters. Only an HMAC of the normalized business slug and proxy-supplied client address is persisted in rate-limit counters. Vercel deployments use the platform-overwritten `x-vercel-forwarded-for` header. For self-hosting, a reverse proxy must strip any inbound value and overwrite a single client-IP header, and `TRUSTED_PROXY_CLIENT_IP_HEADER` must name that header. Public booking fails closed when this trusted header is not configured, missing, or does not contain a valid IP address; the application never trusts `x-forwarded-for` by default.

The route streams and enforces its 8 KiB JSON limit without buffering an unbounded request body. A self-hosted reverse proxy should enforce the same or a stricter payload limit before traffic reaches Next.js.
