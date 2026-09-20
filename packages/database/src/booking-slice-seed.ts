import postgres from "postgres";
import {
  grantRuntimePrivileges,
  resetBookingSliceFixtures,
} from "./booking-slice-fixtures";

const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL;

if (!migrationDatabaseUrl) {
  throw new Error(
    "MIGRATION_DATABASE_URL is required for booking-slice fixture setup",
  );
}

const administrator = postgres(migrationDatabaseUrl, {
  max: 1,
  prepare: false,
});

try {
  await grantRuntimePrivileges(
    administrator,
    process.env.CHAIRLY_DATABASE_RUNTIME_ROLE ?? "chairly_app",
  );
  await resetBookingSliceFixtures(administrator);
  console.log("[booking-slice] reset deterministic tenants");
} finally {
  await administrator.end();
}
