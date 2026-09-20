import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import { bookingSliceFixtures } from "@chairly/shared";
import {
  createDatabase,
  grantRuntimePrivileges,
  listDashboardAppointments,
  requestPublicAppointment,
  resetBookingSliceFixtures,
} from "./index";

const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL;
const runtimeDatabaseUrl = process.env.DATABASE_URL;
const hasDatabaseEnvironment = Boolean(
  migrationDatabaseUrl && runtimeDatabaseUrl,
);

test(
  "the same idempotency key returns one appointment under concurrent submission",
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
    const baseInput = {
      tenantSlug: bookingSliceFixtures.tenants.luma.slug,
      serviceId: bookingSliceFixtures.services.lumaSilkPress.id,
      customerName: "Ada Okafor",
      contactDetail: "ada@example.test",
      preferredTime: "10:30 AM",
      idempotencyKey: "same-key-for-concurrency",
      requestId: "integration-test-request",
    } as const;

    try {
      await grantRuntimePrivileges(administrator);
      await resetBookingSliceFixtures(administrator);

      const [first, second] = await Promise.all([
        requestPublicAppointment(runtime.db, baseInput),
        requestPublicAppointment(runtime.db, baseInput),
      ]);

      assert.equal(first.appointmentId, second.appointmentId);
      assert.equal(first.publicReference, second.publicReference);
      assert.equal(first.status, "pending");

      const dashboardRows = await listDashboardAppointments(
        runtime.db,
        bookingSliceFixtures.tenants.luma.id,
      );

      assert.equal(
        dashboardRows.filter(
          (row) => row.customerName === baseInput.customerName,
        ).length,
        1,
      );
    } finally {
      await Promise.all([administrator.end(), runtime.client.end()]);
    }
  },
);
