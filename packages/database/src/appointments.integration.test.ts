import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { requestAppointment } from "@chairly/domain";
import postgres from "postgres";
import {
  createDatabase,
  getOwnerPendingAppointments,
  PostgresAppointmentRequestRepository,
  resolveOwnerIdentity,
} from "./index";

const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL;
const runtimeDatabaseUrl = process.env.DATABASE_URL;
const hasDatabaseEnvironment = Boolean(
  migrationDatabaseUrl && runtimeDatabaseUrl,
);

function futureLocalDate(daysFromNow: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

function secondSundayInMarch(year: number): number {
  const firstDay = new Date(Date.UTC(year, 2, 1)).getUTCDay();
  const firstSunday = 1 + ((7 - firstDay) % 7);
  return firstSunday + 7;
}

test(
  "appointment requests are atomically created and isolated by resolved tenant",
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
    const repository = new PostgresAppointmentRequestRepository(runtime.db);
    const tenants = [
      {
        id: randomUUID(),
        slug: `appointments-a-${randomUUID().slice(0, 8)}`,
        name: "Appointments A",
        ownerId: randomUUID(),
        serviceId: randomUUID(),
        locationId: randomUUID(),
        staffId: randomUUID(),
        timeZone: "Africa/Lagos",
      },
      {
        id: randomUUID(),
        slug: `appointments-b-${randomUUID().slice(0, 8)}`,
        name: "Appointments B",
        ownerId: randomUUID(),
        serviceId: randomUUID(),
        locationId: randomUUID(),
        staffId: randomUUID(),
        timeZone: "America/New_York",
      },
    ] as const;

    async function deleteTenant(tenantId: string) {
      await administrator.begin(async (transaction) => {
        await transaction`select set_config('app.tenant_id', ${tenantId}, true)`;
        await transaction`delete from outbox_events where tenant_id = ${tenantId}`;
        await transaction`delete from audit_logs where tenant_id = ${tenantId}`;
        await transaction`delete from appointment_events where tenant_id = ${tenantId}`;
        await transaction`delete from appointment_services where tenant_id = ${tenantId}`;
        await transaction`delete from appointments where tenant_id = ${tenantId}`;
        await transaction`delete from customers where tenant_id = ${tenantId}`;
        await transaction`delete from idempotency_keys where tenant_id = ${tenantId}`;
        await transaction`delete from availability_exceptions where tenant_id = ${tenantId}`;
        await transaction`delete from weekly_availability where tenant_id = ${tenantId}`;
        await transaction`delete from staff_services where tenant_id = ${tenantId}`;
        await transaction`delete from service_locations where tenant_id = ${tenantId}`;
        await transaction`delete from services where tenant_id = ${tenantId}`;
        await transaction`delete from staff_members where tenant_id = ${tenantId}`;
        await transaction`delete from locations where tenant_id = ${tenantId}`;
        await transaction`delete from tenant_members where tenant_id = ${tenantId}`;
        await transaction`delete from booking_settings where tenant_id = ${tenantId}`;
        await transaction`delete from tenants where id = ${tenantId}`;
      });
    }

    try {
      for (const tenant of tenants) {
        await administrator`
          insert into users (id, oidc_issuer, oidc_subject, email, display_name)
          values (
            ${tenant.ownerId},
            'appointments-integration-test',
            ${tenant.ownerId},
            ${`${tenant.ownerId}@example.test`},
            'Appointment Test Owner'
          )
        `;

        await administrator.begin(async (transaction) => {
          await transaction`select set_config('app.tenant_id', ${tenant.id}, true)`;
          await transaction`
            insert into tenants (
              id,
              created_by_user_id,
              slug,
              display_name,
              status,
              is_published,
              policy_version
            ) values (
              ${tenant.id},
              ${tenant.ownerId},
              ${tenant.slug},
              ${tenant.name},
              'active',
              true,
              'integration-v1'
            )
          `;
          await transaction`
            insert into tenant_members
              (tenant_id, user_id, role, status, accepted_at)
            values (${tenant.id}, ${tenant.ownerId}, 'owner', 'active', now())
          `;
          await transaction`
            insert into booking_settings (
              tenant_id,
              slot_interval_minutes,
              minimum_lead_minutes,
              booking_horizon_days
            ) values (${tenant.id}, 5, 0, 730)
          `;
          await transaction`
            insert into locations (
              id,
              tenant_id,
              name,
              address_line_1,
              city,
              country_code,
              time_zone,
              is_primary,
              is_active
            ) values (
              ${tenant.locationId},
              ${tenant.id},
              'Primary studio',
              'Synthetic address',
              'Lagos',
              'NG',
              ${tenant.timeZone},
              true,
              true
            )
          `;
          await transaction`
            insert into staff_members
              (id, tenant_id, display_name, is_active)
            values (${tenant.staffId}, ${tenant.id}, 'Assigned professional', true)
          `;
          await transaction`
            insert into services (
              id,
              tenant_id,
              name,
              duration_minutes,
              buffer_before_minutes,
              buffer_after_minutes,
              price_minor,
              currency,
              is_active
            ) values (
              ${tenant.serviceId},
              ${tenant.id},
              'Identical service',
              60,
              15,
              15,
              2500000,
              'NGN',
              true
            )
          `;
          await transaction`
            insert into service_locations (tenant_id, service_id, location_id)
            values (${tenant.id}, ${tenant.serviceId}, ${tenant.locationId})
          `;
          await transaction`
            insert into staff_services (tenant_id, staff_id, service_id)
            values (${tenant.id}, ${tenant.staffId}, ${tenant.serviceId})
          `;
          await transaction`
            insert into weekly_availability (
              tenant_id,
              location_id,
              staff_id,
              day_of_week,
              starts_local_at,
              ends_local_at
            )
            select
              ${tenant.id},
              ${tenant.locationId},
              ${tenant.staffId},
              day_of_week,
              time '08:00',
              time '18:00'
            from generate_series(0, 6) as day_of_week
          `;
        });
      }

      const [tenantA, tenantB] = tenants;
      assert.deepEqual(
        await resolveOwnerIdentity(
          runtime.db,
          "appointments-integration-test",
          tenantA.ownerId,
        ),
        { userId: tenantA.ownerId, tenantId: tenantA.id },
      );
      assert.equal(
        await resolveOwnerIdentity(
          runtime.db,
          "appointments-integration-test",
          randomUUID(),
        ),
        null,
      );
      const tenantAIdempotencyKey = randomUUID();
      const appointmentDate = futureLocalDate(30);
      const identicalCustomer = {
        customerName: "  Ada Okafor  ",
        contactDetail: "Ada@Example.test",
        preferredTime: `${appointmentDate}T10:30`,
      };
      const [resultA, resultB] = await Promise.all([
        requestAppointment(repository, {
          tenantSlug: tenantA.slug,
          serviceId: tenantA.serviceId,
          ...identicalCustomer,
          idempotencyKey: tenantAIdempotencyKey,
          requestId: randomUUID(),
        }),
        requestAppointment(repository, {
          tenantSlug: tenantB.slug,
          serviceId: tenantB.serviceId,
          ...identicalCustomer,
          idempotencyKey: randomUUID(),
          requestId: randomUUID(),
        }),
      ]);

      assert.equal(resultA.ok, true);
      assert.equal(resultB.ok, true);

      const replayA = await requestAppointment(repository, {
        tenantSlug: tenantA.slug,
        serviceId: tenantA.serviceId,
        ...identicalCustomer,
        idempotencyKey: tenantAIdempotencyKey,
        requestId: randomUUID(),
      });
      assert.deepEqual(replayA, resultA);

      const unrelatedExpiredKey = randomUUID();
      await administrator.begin(async (transaction) => {
        await transaction`select set_config('app.tenant_id', ${tenantA.id}, true)`;
        await transaction`
          update idempotency_keys
          set expires_at = now() - interval '1 minute'
          where tenant_id = ${tenantA.id}
            and key = ${tenantAIdempotencyKey}
        `;
        await transaction`
          insert into idempotency_keys (
            tenant_id,
            key,
            request_hash,
            response_status,
            response_body,
            expires_at
          ) values (
            ${tenantA.id},
            ${unrelatedExpiredKey},
            'expired-test-hash',
            409,
            '{"ok":false,"reason":"slot_unavailable"}'::jsonb,
            now() - interval '2 days'
          )
        `;
      });
      const expiredRetry = await requestAppointment(repository, {
        tenantSlug: tenantA.slug,
        serviceId: tenantA.serviceId,
        ...identicalCustomer,
        idempotencyKey: tenantAIdempotencyKey,
        requestId: randomUUID(),
      });
      assert.deepEqual(expiredRetry, {
        ok: false,
        reason: "slot_unavailable",
      });
      const expiredRows = await administrator.begin(async (transaction) => {
        await transaction`select set_config('app.tenant_id', ${tenantA.id}, true)`;
        return transaction<{ count: number }[]>`
          select count(*)::int as count
          from idempotency_keys
          where tenant_id = ${tenantA.id}
            and key = ${unrelatedExpiredKey}
        `;
      });
      assert.equal(expiredRows[0]?.count, 0);

      const mismatchedReplay = await requestAppointment(repository, {
        tenantSlug: tenantA.slug,
        serviceId: tenantA.serviceId,
        ...identicalCustomer,
        customerName: "A different customer",
        idempotencyKey: tenantAIdempotencyKey,
        requestId: randomUUID(),
      });
      assert.deepEqual(mismatchedReplay, {
        ok: false,
        reason: "idempotency_conflict",
      });

      const [pendingA, pendingB] = await Promise.all([
        getOwnerPendingAppointments(runtime.db, tenantA.ownerId, tenantA.id),
        getOwnerPendingAppointments(runtime.db, tenantB.ownerId, tenantB.id),
      ]);
      assert.ok(pendingA);
      assert.ok(pendingB);
      assert.equal(pendingA.appointments.length, 1);
      assert.equal(pendingB.appointments.length, 1);
      assert.deepEqual(
        pendingA.appointments.map((appointment) => ({
          service: appointment.serviceName,
          preferredTime: appointment.preferredTime,
          customerName: appointment.customerName,
          customerContact: appointment.customerContact,
          status: appointment.status,
        })),
        [
          {
            service: "Identical service",
            preferredTime: `${appointmentDate}T10:30`,
            customerName: "  Ada Okafor  ",
            customerContact: "Ada@Example.test",
            status: "pending",
          },
        ],
      );
      assert.notEqual(
        pendingA.appointments[0]?.id,
        pendingB.appointments[0]?.id,
      );
      assert.equal(
        await getOwnerPendingAppointments(
          runtime.db,
          tenantB.ownerId,
          tenantA.id,
        ),
        null,
      );

      const unknownTenantResult = await requestAppointment(repository, {
        tenantSlug: `missing-${randomUUID().slice(0, 8)}`,
        serviceId: tenantA.serviceId,
        customerName: "No owner",
        contactDetail: "nobody@example.test",
        preferredTime: `${appointmentDate}T12:30`,
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
      });
      assert.deepEqual(unknownTenantResult, {
        ok: false,
        reason: "tenant_not_found",
      });

      for (const preferredTime of [
        `${futureLocalDate(-1)}T10:30`,
        `${futureLocalDate(731)}T10:30`,
      ]) {
        const policyFailure = await requestAppointment(repository, {
          tenantSlug: tenantA.slug,
          serviceId: tenantA.serviceId,
          customerName: "Policy boundary",
          contactDetail: `policy-${randomUUID()}@example.test`,
          preferredTime,
          idempotencyKey: randomUUID(),
          requestId: randomUUID(),
        });
        assert.deepEqual(policyFailure, {
          ok: false,
          reason: "invalid_preferred_time",
        });
      }

      const outsideWeeklyHours = await requestAppointment(repository, {
        tenantSlug: tenantA.slug,
        serviceId: tenantA.serviceId,
        customerName: "Outside hours",
        contactDetail: "outside-hours@example.test",
        preferredTime: `${appointmentDate}T19:00`,
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
      });
      assert.deepEqual(outsideWeeklyHours, {
        ok: false,
        reason: "slot_unavailable",
      });

      await administrator.begin(async (transaction) => {
        await transaction`select set_config('app.tenant_id', ${tenantA.id}, true)`;
        await transaction`
          insert into availability_exceptions (
            tenant_id,
            location_id,
            staff_id,
            kind,
            starts_at,
            ends_at
          ) values (
            ${tenantA.id},
            ${tenantA.locationId},
            ${tenantA.staffId},
            'available',
            (${`${appointmentDate}T18:30`}::timestamp at time zone 'Africa/Lagos'),
            (${`${appointmentDate}T20:30`}::timestamp at time zone 'Africa/Lagos')
          )
        `;
      });
      const availableException = await requestAppointment(repository, {
        tenantSlug: tenantA.slug,
        serviceId: tenantA.serviceId,
        customerName: "Available exception",
        contactDetail: "available-exception@example.test",
        preferredTime: `${appointmentDate}T19:00`,
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
      });
      assert.equal(availableException.ok, true);

      const bufferConflict = await requestAppointment(repository, {
        tenantSlug: tenantA.slug,
        serviceId: tenantA.serviceId,
        customerName: "Buffer conflict",
        contactDetail: "buffer-conflict@example.test",
        preferredTime: `${appointmentDate}T11:35`,
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
      });
      assert.deepEqual(bufferConflict, {
        ok: false,
        reason: "slot_unavailable",
      });

      await administrator.begin(async (transaction) => {
        await transaction`select set_config('app.tenant_id', ${tenantA.id}, true)`;
        await transaction`
          insert into availability_exceptions (
            tenant_id,
            location_id,
            staff_id,
            kind,
            starts_at,
            ends_at
          ) values (
            ${tenantA.id},
            ${tenantA.locationId},
            ${tenantA.staffId},
            'closed',
            (${`${appointmentDate}T12:00`}::timestamp at time zone 'Africa/Lagos'),
            (${`${appointmentDate}T13:30`}::timestamp at time zone 'Africa/Lagos')
          )
        `;
      });
      const closedException = await requestAppointment(repository, {
        tenantSlug: tenantA.slug,
        serviceId: tenantA.serviceId,
        customerName: "Closed exception",
        contactDetail: "closed-exception@example.test",
        preferredTime: `${appointmentDate}T12:30`,
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
      });
      assert.deepEqual(closedException, {
        ok: false,
        reason: "slot_unavailable",
      });

      const dstYear = new Date().getUTCFullYear() + 1;
      const dstGap = await requestAppointment(repository, {
        tenantSlug: tenantB.slug,
        serviceId: tenantB.serviceId,
        customerName: "DST gap",
        contactDetail: "dst-gap@example.test",
        preferredTime: `${dstYear}-03-${String(secondSundayInMarch(dstYear)).padStart(2, "0")}T02:30`,
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
      });
      assert.deepEqual(dstGap, {
        ok: false,
        reason: "invalid_preferred_time",
      });

      const racingCommands = ["First Racer", "Second Racer"].map(
        (customerName) =>
          requestAppointment(repository, {
            tenantSlug: tenantA.slug,
            serviceId: tenantA.serviceId,
            customerName,
            contactDetail: `${customerName.replace(" ", ".")}@example.test`,
            preferredTime: `${appointmentDate}T14:00`,
            idempotencyKey: randomUUID(),
            requestId: randomUUID(),
          }),
      );
      const racingResults = await Promise.all(racingCommands);
      assert.equal(racingResults.filter((result) => result.ok).length, 1);
      assert.equal(
        racingResults.filter(
          (result) => !result.ok && result.reason === "slot_unavailable",
        ).length,
        1,
      );

      const aggregateCounts = await administrator.begin(async (transaction) => {
        await transaction`select set_config('app.tenant_id', ${tenantA.id}, true)`;
        return transaction<
          {
            appointments: number;
            events: number;
            audits: number;
            outbox: number;
          }[]
        >`
            select
              (select count(*)::int from appointments where tenant_id = ${tenantA.id}) as appointments,
              (select count(*)::int from appointment_events where tenant_id = ${tenantA.id}) as events,
              (select count(*)::int from audit_logs where tenant_id = ${tenantA.id}) as audits,
              (select count(*)::int from outbox_events where tenant_id = ${tenantA.id}) as outbox
          `;
      });
      assert.deepEqual(aggregateCounts[0], {
        appointments: 3,
        events: 3,
        audits: 3,
        outbox: 3,
      });
    } finally {
      for (const tenant of tenants) {
        await deleteTenant(tenant.id);
        await administrator`delete from users where id = ${tenant.ownerId}`;
      }
      await Promise.all([administrator.end(), runtime.client.end()]);
    }
  },
);
