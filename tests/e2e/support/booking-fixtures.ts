import { test as base, expect, type BrowserContext } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import postgres from "postgres";

function tenant(label: string) {
  return {
    id: randomUUID(),
    slug: `bew005-${label}-${randomUUID().slice(0, 8)}`,
    name: `Booking ${label}`,
    ownerId: randomUUID(),
    serviceId: randomUUID(),
    locationId: randomUUID(),
    staffId: randomUUID(),
    timeZone: "Africa/Lagos",
  };
}
export type Tenant = ReturnType<typeof tenant>;
export type BookingInput = {
  serviceId: string;
  customerName: string;
  contactDetail: string;
  preferredTime: string;
};
export function inputFor(tenant: Tenant): BookingInput {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 30);
  return {
    serviceId: tenant.serviceId,
    customerName: "  Ada Okafor  ",
    contactDetail: "Ada.Case+Booking@Example.test",
    preferredTime: `${date.toISOString().slice(0, 10)}T10:30`,
  };
}
export async function authenticate(
  context: BrowserContext,
  tenant: Tenant,
  userId = tenant.ownerId,
) {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) throw new Error("AUTH_SESSION_SECRET is required");
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      tenantId: tenant.id,
      expiresAt: Date.now() + 3_600_000,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  await context.addCookies([
    {
      name: "chairly_session",
      value: `${payload}.${signature}`,
      url: `http://127.0.0.1:${process.env.CHAIRLY_E2E_PORT ?? 3215}`,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
}
export type Fixture = {
  tenants: readonly [Tenant, Tenant];
  administrator: ReturnType<typeof postgres>;
  runtime: ReturnType<typeof postgres>;
};
export const test = base.extend<{ booking: Fixture }>({
  booking: async ({}, use) => {
    const adminUrl = process.env.MIGRATION_DATABASE_URL;
    const runtimeUrl = process.env.DATABASE_URL;
    if (!adminUrl || !runtimeUrl)
      throw new Error("Real PostgreSQL URLs are required");
    const administrator = postgres(adminUrl, { prepare: false, max: 1 });
    const runtime = postgres(runtimeUrl, { prepare: false, max: 2 });
    const tenants = [tenant("a"), tenant("b")] as const;
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

      const roles =
        await runtime`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
      expect(roles[0]).toEqual({ rolsuper: false, rolbypassrls: false });
      const owner =
        await runtime`select tableowner = current_user as owns from pg_tables where tablename = 'appointments' and schemaname = 'public'`;
      expect(owner[0]?.owns).toBe(false);
      const rls =
        await runtime`select relrowsecurity, relforcerowsecurity from pg_class where oid = 'appointments'::regclass`;
      expect(rls[0]).toEqual({
        relrowsecurity: true,
        relforcerowsecurity: true,
      });
      await use({ tenants, administrator, runtime });
    } finally {
      try {
        for (const item of tenants) {
          await deleteTenant(item.id);
          await administrator`delete from users where id = ${item.ownerId}`;
        }
      } finally {
        await Promise.all([administrator.end(), runtime.end()]);
      }
    }
  },
});
export { expect };
