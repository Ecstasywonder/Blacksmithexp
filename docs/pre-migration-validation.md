# Cloud checkpoint validation — 2026-09-20

The current booking slice was validated on EC2 in the isolated Compose project
`chairly-precommit-20260920`, using a new synthetic PostgreSQL volume.

`CHAIRLY_SLICE_PROJECT=chairly-precommit-20260920 bash tooling/booking-slice/run.sh up`
passed in 123 seconds, including the production Docker build, healthy startup,
repeat migrations, formatting, lint, type checks, runner failure-path tests,
unit/database tests, four real PostgreSQL/OIDC browser scenarios, and ten
existing browser regression scenarios. Database tests exercised the buffered
overlap guard in UTC and America/New_York and verified valid dashboard dates.

The historical 0003 migration remains byte-for-byte unchanged; unapplied 0003
is superseded by the forward-only immutable 0004 replacement. See the migration
rollout notes before using a non-disposable database.

The separately versioned nested checkout is a legacy local booking proof, not
the canonical current implementation. Its snapshot branch preserves that work
without embedding a second Git repository in this checkout.

This verification does not establish production readiness or validate the
planned infrastructure migration. Existing development databases were not
reset by this check. Back up and restore-test durable data before teardown.
