import type { Sql } from "postgres";
import { bookingSliceFixtures } from "@chairly/shared";

const postgresIdentifierPattern = /^[a-z_][a-z0-9_]*$/i;

export async function grantRuntimePrivileges(
  administrator: Sql,
  runtimeRole = "chairly_app",
) {
  if (!postgresIdentifierPattern.test(runtimeRole)) {
    throw new TypeError("A valid PostgreSQL role name is required");
  }

  await administrator.unsafe(`
    GRANT USAGE ON SCHEMA public TO ${runtimeRole};
    GRANT USAGE ON SCHEMA app TO ${runtimeRole};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${runtimeRole};
    GRANT EXECUTE ON FUNCTION app.resolve_published_tenant(text) TO ${runtimeRole};
    GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO ${runtimeRole};
  `);
}

export async function resetBookingSliceFixtures(administrator: Sql) {
  await administrator.unsafe(`
    TRUNCATE TABLE
      audit_logs,
      outbox_events,
      idempotency_keys,
      appointment_events,
      appointment_services,
      appointments,
      customers,
      availability_exceptions,
      weekly_availability,
      staff_services,
      service_locations,
      services,
      staff_members,
      locations,
      booking_settings,
      tenant_members,
      tenants,
      users
    CASCADE
  `);

  const { owners, tenants, locations, staff, services } = bookingSliceFixtures;

  await administrator`
    insert into users (id, oidc_issuer, oidc_subject, email, display_name)
    values
      (${owners.luma.userId}, 'booking-slice', ${owners.luma.userId}, ${owners.luma.email}, ${owners.luma.displayName}),
      (${owners.nova.userId}, 'booking-slice', ${owners.nova.userId}, ${owners.nova.email}, ${owners.nova.displayName}),
      (${owners.quiet.userId}, 'booking-slice', ${owners.quiet.userId}, ${owners.quiet.email}, ${owners.quiet.displayName})
  `;

  await administrator`
    insert into tenants
      (id, created_by_user_id, slug, display_name, description, status, is_published, default_currency, contact_email, contact_phone, policy_version, published_at)
    values
      (${tenants.luma.id}, ${owners.luma.userId}, ${tenants.luma.slug}, ${tenants.luma.displayName}, 'Silk presses, braids, and treatments.', 'active', true, 'NGN', 'hello@luma.example.test', '+2348000000001', 'booking-slice-v1', now()),
      (${tenants.nova.id}, ${owners.nova.userId}, ${tenants.nova.slug}, ${tenants.nova.displayName}, 'Fades and grooming appointments.', 'active', true, 'NGN', 'hello@nova.example.test', '+2348000000002', 'booking-slice-v1', now()),
      (${tenants.quiet.id}, ${owners.quiet.userId}, ${tenants.quiet.slug}, ${tenants.quiet.displayName}, 'A draft business with no bookable catalog yet.', 'active', true, 'NGN', 'hello@quiet.example.test', '+2348000000003', 'booking-slice-v1', now())
  `;

  await administrator`
    insert into tenant_members
      (tenant_id, user_id, role, status, accepted_at)
    values
      (${tenants.luma.id}, ${owners.luma.userId}, 'owner', 'active', now()),
      (${tenants.nova.id}, ${owners.nova.userId}, 'owner', 'active', now()),
      (${tenants.quiet.id}, ${owners.quiet.userId}, 'owner', 'active', now())
  `;

  await administrator`
    insert into booking_settings
      (tenant_id, slot_interval_minutes, minimum_lead_minutes, booking_horizon_days, pending_expiry_minutes)
    values
      (${tenants.luma.id}, 15, 60, 90, 30),
      (${tenants.nova.id}, 15, 60, 90, 30),
      (${tenants.quiet.id}, 15, 60, 90, 30)
  `;

  await administrator`
    insert into locations
      (id, tenant_id, name, address_line_1, city, country_code, time_zone, is_primary, is_active)
    values
      (${locations.luma.id}, ${tenants.luma.id}, 'Luma Main Studio', '1 Glow Street', 'Lagos', 'NG', ${locations.luma.timeZone}, true, true),
      (${locations.nova.id}, ${tenants.nova.id}, 'Nova Grooming House', '2 Fade Avenue', 'Lagos', 'NG', ${locations.nova.timeZone}, true, true),
      (${locations.quiet.id}, ${tenants.quiet.id}, 'Quiet Studio', '3 Calm Road', 'Lagos', 'NG', ${locations.quiet.timeZone}, true, true)
  `;

  await administrator`
    insert into staff_members
      (id, tenant_id, display_name, is_active)
    values
      (${staff.luma.id}, ${tenants.luma.id}, ${staff.luma.displayName}, true),
      (${staff.nova.id}, ${tenants.nova.id}, ${staff.nova.displayName}, true)
  `;

  await administrator`
    insert into services
      (id, tenant_id, name, description, duration_minutes, price_minor, currency, is_active, sort_order)
    values
      (${services.lumaSilkPress.id}, ${services.lumaSilkPress.tenantId}, ${services.lumaSilkPress.name}, 'A smooth finish with a cleanse, treatment, and trim.', ${services.lumaSilkPress.durationMinutes}, ${services.lumaSilkPress.priceMinor}, ${services.lumaSilkPress.currency}, true, 0),
      (${services.lumaBraids.id}, ${services.lumaBraids.tenantId}, ${services.lumaBraids.name}, 'Lightweight, mid-back knotless braids with hair included.', ${services.lumaBraids.durationMinutes}, ${services.lumaBraids.priceMinor}, ${services.lumaBraids.currency}, true, 1),
      (${services.lumaWash.id}, ${services.lumaWash.tenantId}, ${services.lumaWash.name}, null, ${services.lumaWash.durationMinutes}, ${services.lumaWash.priceMinor}, ${services.lumaWash.currency}, true, 2),
      (${services.novaCut.id}, ${services.novaCut.tenantId}, ${services.novaCut.name}, 'A precise fade with beard cleanup.', ${services.novaCut.durationMinutes}, ${services.novaCut.priceMinor}, ${services.novaCut.currency}, true, 0)
  `;

  await administrator`
    insert into staff_services
      (tenant_id, staff_id, service_id)
    values
      (${tenants.luma.id}, ${staff.luma.id}, ${services.lumaSilkPress.id}),
      (${tenants.luma.id}, ${staff.luma.id}, ${services.lumaBraids.id}),
      (${tenants.luma.id}, ${staff.luma.id}, ${services.lumaWash.id}),
      (${tenants.nova.id}, ${staff.nova.id}, ${services.novaCut.id})
  `;

  await administrator`
    insert into service_locations
      (tenant_id, service_id, location_id)
    values
      (${tenants.luma.id}, ${services.lumaSilkPress.id}, ${locations.luma.id}),
      (${tenants.luma.id}, ${services.lumaBraids.id}, ${locations.luma.id}),
      (${tenants.luma.id}, ${services.lumaWash.id}, ${locations.luma.id}),
      (${tenants.nova.id}, ${services.novaCut.id}, ${locations.nova.id})
  `;
}
