import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { requestAppointment } from "@chairly/domain";
import postgres from "postgres";
import {
  createDatabase,
  getOwnerPendingAppointments,
  PostgresAppointmentRequestRepository,
} from "./index";

const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL;
const runtimeDatabaseUrl = process.env.DATABASE_URL;
const hasDatabaseEnvironment = Boolean(
  migrationDatabaseUrl && runtimeDatabaseUrl,
);

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
      },
      {
        id: randomUUID(),
        slug: `appointments-b-${randomUUID().slice(0, 8)}`,
        name: "Appointments B",
        ownerId: randomUUID(),
        serviceId: randomUUID(),
        locationId: randomUUID(),
        staffId: randomUUID(),
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
        await transaction`delete from staff_services where tenant_id = ${tenantId}`;
        await transaction`delete from service_locations where tenant_id = ${tenantId}`;
        await transaction`delete from services where tenant_id = ${tenantId}`;
        await transaction`delete from staff_members where tenant_id = ${tenantId}`;
        await transaction`delete from locations where tenant_id = ${tenantId}`;
        await transaction`delete from tenant_members where tenant_id = ${tenantId}`;
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
              'Africa/Lagos',
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
              price_minor,
              currency,
              is_active
            ) values (
              ${tenant.serviceId},
              ${tenant.id},
              'Identical service',
              60,
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
        });
      }

      const [tenantA, tenantB] = tenants;
      const tenantAIdempotencyKey = randomUUID();
      const identicalCustomer = {
        customerName: "  Ada Okafor  ",
        contactDetail: "Ada@Example.test",
        preferredTime: "2031-09-03T10:30",
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
            preferredTime: "2031-09-03T10:30",
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
        preferredTime: "2031-09-03T12:30",
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
      });
      assert.deepEqual(unknownTenantResult, {
        ok: false,
        reason: "tenant_not_found",
      });

      const racingCommands = ["First Racer", "Second Racer"].map(
        (customerName) =>
          requestAppointment(repository, {
            tenantSlug: tenantA.slug,
            serviceId: tenantA.serviceId,
            customerName,
            contactDetail: `${customerName.replace(" ", ".")}@example.test`,
            preferredTime: "2031-09-03T14:00",
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
        appointments: 2,
        events: 2,
        audits: 2,
        outbox: 2,
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
