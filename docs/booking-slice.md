# Booking Slice

The booking slice is the smallest Docker-backed verification path for BEW-005
and BEW-006. It uses a real PostgreSQL 16 container, applies the checked-in
migrations, seeds deterministic synthetic tenants, runs the PostgreSQL
integration tests, and then runs eight Playwright scenarios against the real
repository-backed booking flow.

## Commands

- `pnpm booking-slice:setup`
- `pnpm booking-slice:verify`
- `pnpm booking-slice:check`
- `pnpm booking-slice:teardown`

`pnpm booking-slice:check` runs setup plus verification and prints distinct
setup and verification durations. The browser pass is database-backed:

- `DATABASE_URL` is provided to the Next.js app and repository layer.
- A signed `chairly_session` cookie authorizes dashboard reads in the private
  appointment page tests.
- `CHAIRLY_E2E_CATALOG=synthetic` is intentionally not set in
  [`tests/e2e/playwright.config.ts`](../../tests/e2e/playwright.config.ts).

## Fixture tenants

- `luma-studio`: published and bookable with three active services.
- `nova-studio`: published and bookable with one active service.
- `quiet-studio`: published but intentionally has no services, proving the
  empty public booking state.

## Environment

The runner defaults to:

- `DATABASE_URL=postgresql://chairly_app:chairly_app@127.0.0.1:55432/chairly`
- `MIGRATION_DATABASE_URL=postgresql://chairly_migrator:chairly_migrator@127.0.0.1:55432/chairly`
- `AUTH_SESSION_SECRET=chairly-local-booking-slice-secret`

Override them only when you intentionally need a different local Docker-backed
slice. The seeded data is synthetic and safe for tests.

## Scope of this preserved checkout

This branch preserves the earlier local booking proof independently of the
newer implementation on BEW-006. Its time-only booking form uses a fixed
synthetic date (2030-01-15), and its private-page tests use explicitly signed
fixture sessions. It does not implement the current full calendar availability
or managed OIDC sign-in flows. Use synthetic data and loopback networking.

Session signing requires an explicitly configured secret of at least 32
characters; the application no longer falls back to a shared built-in secret.
The Compose examples supply development-only values for this local proof.
`pnpm test` runs session and database tests; browser verification remains the
separate `pnpm test:e2e` stage so database resets cannot race browser tests.

## Cloud verification — 2026-09-20

The isolated `chairly-precommit-legacy-20260920` Docker verification passed formatting, lint, types, repeat migrations, session-signature and PostgreSQL tests, all eight browser scenarios, and production build. Its ports were disabled through a temporary Compose override so existing development databases were untouched.
