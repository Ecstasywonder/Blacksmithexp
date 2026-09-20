# Chairly

Multi-tenant public-page and appointment-request platform for salons, barbers, makeup artists, and related small businesses. A public booking request is persisted as a tenant-owned pending appointment and appears automatically in the authenticated owner dashboard.

The product requirements are in [PRD.md](./PRD.md), the technical design is in [Architecture.md](./Architecture.md), and repository guidance is in [AGENTS.md](./AGENTS.md).

## Workspace

- `apps/web` — Next.js App Router application
- `packages/database` — PostgreSQL schema, migrations, and database boundary
- `packages/domain` — framework-independent booking and authorization rules
- `packages/shared` — shared validation and error contracts
- `tests/e2e` — critical browser journeys

## Run the booking slice

Prerequisites: Git, Bash (WSL on Windows), and a running Docker engine with Compose v2.20+; allow 4 GB RAM and 8 GB free disk. Internet access is needed for the first image/package/browser downloads. No host Node, PostgreSQL, auth account, or `.env` edits are needed.

From the checkout root:

```sh
bash tooling/booking-slice/run.sh up
```

This builds the production app, starts an isolated PostgreSQL database and local demo sign-in gateway, applies migrations, seeds two businesses, and runs formatting, lint, types, setup-failure checks, unit/database tests, four real browser scenarios, and the existing browser regressions. Wait for **Booking slice PASSED**; any failed stage exits nonzero and names the failing step. First-run download speed affects the ten-minute target; cached runs are faster.

1. Open <http://127.0.0.1:3310/sign-in>, continue to sign in, choose **Luma Studio**, and enter `booking-demo`.
2. In another tab open <http://127.0.0.1:3310/luma-studio>, choose **Book an appointment**, and select **Signature silk press**.
3. Enter a fictional name and email, and choose a future time between 08:00 and 17:00 in **Africa/Lagos**, within 90 days. Tests reserve 10:00, 12:00 and 14:00 three days ahead; choose another slot.
4. Submit. The confirmation appears and the owner's **Pending appointments** list refreshes automatically. Submit again to see the duplicate message and a single appointment. Submit an empty form to see field-specific corrections.

The second demo owner, **Ember Studio**, uses the same password and sees only that business's appointments. The local identity provider signs real OIDC tokens; the app resolves the seeded membership and uses a separate PostgreSQL runtime role with tenant RLS. The gateway and database are disposable local infrastructure, not production services. Only the gateway is exposed, on loopback port 3310. Never put real customer data in this setup.

Re-run checks (resets demo appointments first):

```sh
bash tooling/booking-slice/run.sh test
```

Completely remove containers, database data, appointments, and sign-in state, then reproduce the run:

```sh
bash tooling/booking-slice/run.sh down
bash tooling/booking-slice/run.sh up
```

Images/build caches are retained for speed; no application state is retained. The four scenarios cover actionable validation errors, a persisted pending request visible to the owner, cross-tenant service/read rejection, and duplicate replay retaining one appointment. Tests use the running app, real PostgreSQL and local OIDC; they do not mock booking responses. Two businesses with one owner, service, location and staff member each are the minimum isolation fixture. The existing synthetic browser regressions run in a disposable container from the same image so their build cannot replace the running real app.

Troubleshooting:

- Docker prerequisite failure: start Docker and verify `docker info` works for your user.
- Download/build failure: check network access and free disk, then repeat `up`.
- Port 3310 already allocated: stop the process using it and repeat `up`.
- Readiness/migration failure: run `docker compose -p chairly-booking-slice -f compose.booking-slice.yml logs --tail=80`; use `down` then `up` to recreate this disposable database.
- Test failure: the runner names the check and Playwright reports the failing scenario/assertion; repeat `test` to retry the existing image, or `up` after changing source files. A failed run never prints PASSED. Every Docker stage has a timeout, including an unresponsive Docker engine. Runs exceeding ten minutes explicitly report that the timing target was missed.

## Isolated verification and preserved legacy work

Set `CHAIRLY_SLICE_PROJECT` to a unique Compose project name when checking a
fresh database without replacing the normal demo volume:

```sh
CHAIRLY_SLICE_PROJECT=chairly-check bash tooling/booking-slice/run.sh up
CHAIRLY_SLICE_PROJECT=chairly-check bash tooling/booking-slice/run.sh down
```

The gateway still uses loopback port 3310, so run only one slice at a time on
that port. Use the same project name for teardown. The independent nested
`Blacksmithexp/` checkout is excluded from this repository and its formatting
checks; its source is preserved separately on
`checkpoint/legacy-booking-20260920` in the same GitHub repository.

## Other development setups

For development outside the isolated slice, install Node.js 22+ and pnpm 11+, configure `.env.example` values, provision PostgreSQL migration/runtime roles and an OIDC provider, run `pnpm install`, `pnpm db:migrate`, then `pnpm dev`. The slice above requires none of these manual steps.

## Business authentication

Configure a managed OpenID Connect provider with the callback URL `${APP_ORIGIN}/auth/callback`. `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`, and a random `AUTH_SESSION_SECRET` of at least 32 characters are required. The provider issuer/subject pair must already map to a local `users` row with an active owner membership; the callback never accepts a tenant or role from the browser.

The deployment runtime role needs `EXECUTE` on `app.resolve_published_tenant(text)`, `app.resolve_owner_membership(text, text)`, and `app.consume_public_booking_rate_limit(text, integer, integer)`. It must not own schema objects or have `BYPASSRLS`.

## Public booking contract

`POST /api/public/{tenantSlug}/appointments` requires an `Idempotency-Key` header (8–200 letters, digits, `.`, `_`, `:`, or `-`; reuse it when retrying the same request) and accepts JSON containing `serviceId`, `customerName`, `contactDetail`, and a timezone-local `preferredTime` in `YYYY-MM-DDTHH:mm` form. A newly created request returns `201` with `outcome: "created"`; an idempotent replay returns `200` with `outcome: "duplicate"`. Both responses include the original appointment ID and `pending` status. Invalid, unmatched, conflicting, rate-limited, and internal failures use the safe customer message documented in the product requirements and include a request ID; `429` responses include `Retry-After`.

Set `RATE_LIMIT_SECRET` to a separate random value of at least 32 characters. Only an HMAC of the normalized business slug and proxy-supplied client address is persisted in rate-limit counters. Vercel deployments use the platform-overwritten `x-vercel-forwarded-for` header.

For self-hosting, keep the application origin private and configure the trusted gateway to strip inbound client-identity headers, set exactly one client IP in the header named by `TRUSTED_PROXY_CLIENT_IP_HEADER`, and set `x-chairly-client-ip-signature` to the lowercase hex HMAC-SHA256 of `client-ip:v1\0<header-name>\0<client-ip>` using the separate 32-or-more-character `TRUSTED_PROXY_CLIENT_IP_SECRET`. The application compares that signature in constant time and fails closed when the header, secret, IP, or signature is invalid. It never trusts `x-forwarded-for` by default.

The route streams and enforces its 8 KiB JSON limit without buffering an unbounded request body. A self-hosted reverse proxy should enforce the same or a stricter payload limit before traffic reaches Next.js.
