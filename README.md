# Chairly

Greenfield scaffold for a multi-tenant public-page and appointment-request platform for salons, barbers, makeup artists, and related small businesses.

The product requirements are in [PRD.md](./PRD.md), the technical design is in [Architecture.md](./Architecture.md), and repository guidance is in [AGENTS.md](./AGENTS.md).

## Workspace

- `apps/web` — Next.js App Router application
- `packages/database` — PostgreSQL schema, migrations, and database boundary
- `packages/domain` — framework-independent booking and authorization rules
- `packages/shared` — shared validation and error contracts
- `tests/e2e` — critical browser journeys

## Local setup

The repository is a scaffold; feature implementations and generated lockfile are intentionally not included yet.

1. Install Node.js 22+ and pnpm 11+.
2. Copy `.env.example` to `.env.local` and set local-only values.
3. Start PostgreSQL 16+ and create the application and migration roles described in the architecture.
4. Run `pnpm install`, then apply `packages/database/migrations/0001_initial.sql` with the migration role.
5. Run `pnpm dev`.

Do not use production customer data or credentials in local development.
