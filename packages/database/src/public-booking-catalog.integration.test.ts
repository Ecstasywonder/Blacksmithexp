import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import { bookingSliceFixtures } from "@chairly/shared";
import {
  createDatabase,
  getPublishedBookingCatalog,
  grantRuntimePrivileges,
  resetBookingSliceFixtures,
} from "./index";

const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL;
const runtimeDatabaseUrl = process.env.DATABASE_URL;
const hasDatabaseEnvironment = Boolean(
  migrationDatabaseUrl && runtimeDatabaseUrl,
);

test(
  "the public catalog returns only active services from the resolved tenant",
  {
    skip: hasDatabaseEnvironment
      ? false
      : "PostgreSQL test URLs are not configured",
  },
  async () => {
    assert.ok(migrationDatabaseUrl);
    assert.ok(runtimeDatabaseUrl);

    const administrator = postgres(migrationDatabaseUrl, {
      prepare: false,
      max: 1,
    });
    const runtime = createDatabase(runtimeDatabaseUrl);

    try {
      await grantRuntimePrivileges(administrator);
      await resetBookingSliceFixtures(administrator);

      const catalog = await getPublishedBookingCatalog(
        runtime.db,
        bookingSliceFixtures.tenants.luma.slug,
      );

      assert.ok(catalog);
      assert.equal(catalog.tenantId, bookingSliceFixtures.tenants.luma.id);
      assert.equal(catalog.displayName, "Luma Studio");
      assert.deepEqual(
        catalog.services.map((service) => service.name),
        ["Signature silk press", "Knotless braids", "Wash and treatment"],
      );
    } finally {
      await Promise.all([administrator.end(), runtime.client.end()]);
    }
  },
);
