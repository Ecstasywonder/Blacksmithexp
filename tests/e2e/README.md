# End-to-end tests

Run the isolated real booking slice from the repository root:

```sh
bash tooling/booking-slice/run.sh up
```

See [setup, demo credentials and reset instructions](../../README.md#run-the-booking-slice).
`booking-slice.spec.ts` uses real PostgreSQL, local OIDC and the production app to cover validation, happy path, tenant isolation and duplicate submission, including axe accessibility checks. `playwright.slice.config.ts` runs these serially without retries or captured authentication traces. The runner resets the two disposable tenants before each run.

`pnpm test:e2e` separately runs the existing synthetic-catalog UI regression suite. It excludes the real slice spec; the slice runner invokes that spec explicitly and also runs the synthetic suite in a separate disposable container to preserve the real app build. The happy-path customer uses an anonymous browser context separate from the signed-in owner. All fixtures are fictional.
