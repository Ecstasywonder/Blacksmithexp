# Chairly — Multi-Tenant Appointment SaaS

**Secure multi-tenant appointment platform designed around tenant isolation, authorization and reliable public booking.**

Chairly is a portfolio engineering project focused on the parts of SaaS systems that become difficult at scale: tenant-aware authorization, database boundaries, abuse prevention, idempotent APIs and end-to-end verification.

## Engineering highlights

- Next.js App Router application
- PostgreSQL persistence with an explicit database boundary
- Managed OIDC authentication
- Tenant- and role-aware authorization
- Shared validation and error contracts
- Public appointment booking API with idempotency
- Rate limiting and request-size limits
- HMAC trusted-proxy client identity with fail-closed behavior
- Constant-time signature comparison
- Request IDs for operational traceability
- Safe customer-facing error messages
- Retry-After handling for 429 responses
- Browser E2E coverage
- Architecture, PRD and agent-development documentation

## Core reliability behavior

The public booking endpoint is designed to make retries safe:

- `201 Created` when a new booking is accepted
- `200 OK` when an idempotent duplicate request is replayed

The system also treats security boundaries explicitly rather than relying on framework defaults or client-provided identity headers.

## Architecture

Browser → Next.js application → authentication / authorization / validation / rate limiting → PostgreSQL

See `Architecture.md` for the full system model and security boundaries.

## Local development

Requirements: Node.js 22+, pnpm 11+, PostgreSQL.

    pnpm install
    pnpm db:migrate
    pnpm dev

## Verification

    pnpm format:check
    pnpm lint
    pnpm typecheck
    pnpm test
    pnpm test:e2e

## Security model

The project intentionally documents tenant isolation, authorization boundaries, trusted-proxy assumptions, request identity handling, abuse controls, idempotency, error disclosure and database security boundaries.

It is a portfolio project and should not be deployed with production credentials without a deployment-specific security review.

## Portfolio focus

**Multi-tenancy → authorization → database security → API reliability → abuse prevention → automated testing**

---

**Chinwendu Onyeani**  
Software / DevOps Engineer  
GitHub: https://github.com/Ecstasywonder  
Email: chinwenduonyeani@gmail.com
