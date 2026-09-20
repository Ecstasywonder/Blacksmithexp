import postgres from "postgres";

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
const issuer = process.env.AUTH_ISSUER_URL;
if (!migrationUrl || issuer !== "http://127.0.0.1:3310/local-oidc") {
  console.error(
    "Booking fixtures require the disposable slice database and local OIDC configuration. Use the documented slice command.",
  );
  process.exit(1);
}
const sql = postgres(migrationUrl, {
  max: 1,
  onnotice: () => {},
});
try {
  await sql.begin(async (tx) => {
    if (process.argv.includes("--reset-appointments")) {
      // Explicit reset of this disposable slice only; never accept an arbitrary tenant.
      for (const tenant of [
        "10000000-0000-4000-8000-000000000001",
        "10000000-0000-4000-8000-000000000002",
      ]) {
        for (const table of [
          "outbox_events",
          "audit_logs",
          "idempotency_keys",
          "appointment_events",
          "appointment_services",
          "appointments",
          "customers",
        ]) {
          await tx`delete from ${tx(table)} where tenant_id = ${tenant}`;
        }
      }
      await tx`delete from public_endpoint_rate_limits`;
    }
    await tx`revoke all on public_endpoint_rate_limits, chairly_schema_migrations from chairly_app`;
    await tx`grant usage on schema public, app to chairly_app`;
    await tx`grant execute on function app.resolve_published_tenant(text), app.resolve_owner_membership(text, text), app.consume_public_booking_rate_limit(text, integer, integer) to chairly_app`;
    for (const [suffix, slug, name] of [
      ["1", "luma-studio", "Luma Studio"],
      ["2", "ember-studio", "Ember Studio"],
    ] as const) {
      const id = (prefix: string) =>
        `${prefix}0000000-0000-4000-8000-00000000000${suffix}`;
      const tenant = id("1"),
        user = id("3"),
        service = id("2"),
        location = id("4"),
        staff = id("5");
      await tx`insert into users (id, oidc_issuer, oidc_subject, email, display_name) values (${user}, ${issuer}, ${slug}, ${`${slug}@example.test`}, ${name}) on conflict do nothing`;
      await tx`insert into tenants (id, created_by_user_id, slug, display_name, is_published) values (${tenant}, ${user}, ${slug}, ${name}, true) on conflict do nothing`;
      await tx`insert into tenant_members (tenant_id,user_id,role,status) values (${tenant},${user},'owner','active') on conflict do nothing`;
      await tx`insert into booking_settings (tenant_id,minimum_lead_minutes,booking_horizon_days) values (${tenant},0,90) on conflict do nothing`;
      await tx`insert into locations (id,tenant_id,name,address_line_1,city,country_code,time_zone,is_primary) values (${location},${tenant},'Local studio','Fictional demo address','Lagos','NG','Africa/Lagos',true) on conflict do nothing`;
      await tx`insert into staff_members (id,tenant_id,display_name) values (${staff},${tenant},'Demo professional') on conflict do nothing`;
      await tx`insert into services (id,tenant_id,name,duration_minutes,price_minor,currency) values (${service},${tenant},'Signature silk press',60,3500000,'NGN') on conflict do nothing`;
      await tx`insert into service_locations (tenant_id,service_id,location_id) values (${tenant},${service},${location}) on conflict do nothing`;
      await tx`insert into staff_services (tenant_id,staff_id,service_id) values (${tenant},${staff},${service}) on conflict do nothing`;
      await tx`insert into weekly_availability (tenant_id,location_id,staff_id,day_of_week,starts_local_at,ends_local_at)
        select ${tenant},${location},${staff},day,'08:00'::time,'18:00'::time from generate_series(0,6) day
        where not exists (select 1 from weekly_availability where tenant_id=${tenant} and staff_id=${staff} and day_of_week=day)`;
    }
  });
  console.log("Booking slice: two businesses seeded; runtime grants ready.");
} catch {
  console.error(
    "Booking slice: fixture/grant setup failed. Check that the slice database is healthy and migrations succeeded. Reset only this slice using the documented down command.",
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
