# Full-stack local containers

The repository can be edited and versioned normally while the complete runtime
stack runs in Docker. Git tracks the source files, Dockerfile, and Compose
configuration; it does not track generated images, containers, or database
volumes.

## Runtime topology

| Service    | Purpose                                                  | Host port |
| ---------- | -------------------------------------------------------- | --------- |
| `postgres` | PostgreSQL 16 with local application and migration roles | `55432`   |
| `migrate`  | One-shot job that applies checked-in SQL migrations      | None      |
| `web`      | Non-root Next.js standalone production server            | `3000`    |

Compose waits for PostgreSQL to become healthy, requires migrations to finish
successfully, and then starts the web application. The web service connects to
PostgreSQL over the private Compose network using the `postgres` service name.

The credentials in `compose.yml` are local-development values. Never reuse
them for a shared or production environment.

## First start

1. Confirm Docker is available:

   ```bash
   docker version
   docker compose version
   ```

2. From the repository root, build and start the stack:

   ```bash
   pnpm container:up
   ```

3. Inspect health and startup state:

   ```bash
   pnpm container:ps
   pnpm container:logs
   ```

4. Open `http://localhost:3000`. The shallow health endpoint is
   `http://localhost:3000/api/health`.

5. Optionally load the deterministic booking-slice fixtures:

   ```bash
   pnpm container:seed
   ```

`container:up` builds the images, creates the network and database volume,
starts PostgreSQL, applies migrations, starts Next.js, and waits for health
checks.

## Daily development

Edit files on the host with the normal Git workflow. Rebuild after source or
dependency changes:

```bash
pnpm container:up
```

Docker reuses cached dependency and build layers when their inputs have not
changed. Follow application and database logs with:

```bash
pnpm container:logs
```

This Compose stack runs the production-style Next.js server, so it rebuilds
rather than providing hot module reload. Continue using `pnpm dev` when rapid
host-based hot reload is more useful.

## Database lifecycle

Apply newly added checked-in migrations without deleting data:

```bash
pnpm container:migrate
```

Stop and remove containers while preserving the PostgreSQL volume:

```bash
pnpm container:down
```

Delete the containers and the local PostgreSQL volume:

```bash
pnpm container:reset
```

`container:reset` permanently removes local containerized database data. It
does not delete source files or Git history.

## Quality and booking verification

Run the standard checks and database-backed booking tests entirely in Docker:

```bash
pnpm container:verify
```

Without a host Node installation, run the equivalent commands:

```bash
docker compose build
docker compose -f compose.verify.yml run --build --rm verify
```

This creates a separate `chairly-verification` stack. Its app is exposed at
`http://localhost:3210`, and its PostgreSQL database at `127.0.0.1:55433`.
The normal app remains at `http://localhost:3000`, with its database on port
`55432`. Verification resets only its own synthetic database. Do not store
customer data in the verification stack.

The verification image includes Chromium. Both database URLs and the signed
test-session secret are provided to the test runner, and Playwright targets
the verification app through `CHAIRLY_E2E_BASE_URL`. The runner executes
in the test app's network namespace, allowing Chromium to use localhost and
its secure-context browser APIs without browser security overrides. It runs
formatting, lint, type checks, migrations, tests, browser tests, and build;
it reports all failed commands and exits nonzero if any check fails.

The test app and database remain running after verification. To stop them
while preserving the volume:

```bash
docker compose -f compose.verify.yml down
```

The existing host commands remain available:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm booking-slice:check
pnpm booking-slice:teardown
```

The older booking-slice Compose file uses its own database volume but shares
port `55432` with the normal stack. Use `compose.verify.yml` when the normal
stack is running.

## Git and GitHub workflow

Docker does not interfere with branches, commits, pulls, or pushes. A typical
workflow is:

```bash
git switch -c codex/containerize-full-stack
git status
git add Dockerfile .dockerignore compose.yml package.json \
  apps/web/next.config.ts docs/containerization.md README.md
git commit -m "Containerize the full local stack"
git push -u origin codex/containerize-full-stack
```

Review `git status` before committing because the repository may contain other
work that should be committed separately.

Pushing Git commits uploads the container definitions, not a built image. If a
container registry image is also needed, build and push it separately:

```bash
docker build --target runner \
  --tag ghcr.io/ecstasywonder/blacksmithexp:latest .
docker login ghcr.io
docker push ghcr.io/ecstasywonder/blacksmithexp:latest
```

Use a narrowly scoped GitHub token with package-write permission for registry
login, and never commit that token.

## Configuration

The defaults serve the app at port `3000` and PostgreSQL at port `55432`.
Override host ports or the public origin for a single invocation:

```bash
CHAIRLY_WEB_PORT=3300 \
CHAIRLY_POSTGRES_PORT=55433 \
APP_ORIGIN=http://localhost:3300 \
pnpm container:up
```

Set `AUTH_SESSION_SECRET` in the shell or an ignored `.env` file when a stable
local session secret is required. Do not put real secrets in `compose.yml` or
commit `.env` files.

## Troubleshooting

- If image pulls report DNS failures, verify `auth.docker.io` and
  `registry-1.docker.io` resolve on the host, then restart Docker.
- If a host port is already occupied, override `CHAIRLY_WEB_PORT` or
  `CHAIRLY_POSTGRES_PORT`.
- If migrations fail after changing the initialization SQL, use
  `pnpm container:reset` to recreate the local-only database from scratch.
- Use `docker compose config` to inspect the fully resolved Compose model.
- Use `docker compose logs migrate` when the web service is blocked waiting for
  the migration job.
