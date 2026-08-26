import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { createDatabase, getPublishedBookingCatalog } from "./index";

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
    const userId = randomUUID();
    const requestedTenantId = randomUUID();
    const otherTenantId = randomUUID();
    const requestedSlug = `catalog-${randomUUID().slice(0, 12)}`;
    const otherSlug = `catalog-${randomUUID().slice(0, 12)}`;

    async function deleteTenant(tenantId: string) {
      await administrator.begin(async (transaction) => {
        await transaction`select set_config('app.tenant_id', ${tenantId}, true)`;
        await transaction`delete from services where tenant_id = ${tenantId}`;
        await transaction`delete from tenants where id = ${tenantId}`;
      });
    }

    try {
      await administrator`
        insert into users (id, oidc_issuer, oidc_subject, email, display_name)
        values (${userId}, 'integration-test', ${userId}, ${`${userId}@example.test`}, 'Catalog Test Owner')
      `;

      for (const tenant of [
        {
          id: requestedTenantId,
          slug: requestedSlug,
          name: "Requested Studio",
        },
        { id: otherTenantId, slug: otherSlug, name: "Other Studio" },
      ]) {
        await administrator.begin(async (transaction) => {
          await transaction`select set_config('app.tenant_id', ${tenant.id}, true)`;
          await transaction`
            insert into tenants (id, created_by_user_id, slug, display_name, status, is_published)
            values (${tenant.id}, ${userId}, ${tenant.slug}, ${tenant.name}, 'active', true)
          `;
        });
      }

      await administrator.begin(async (transaction) => {
        await transaction`select set_config('app.tenant_id', ${requestedTenantId}, true)`;
        await transaction`
          insert into services
            (id, tenant_id, name, duration_minutes, price_minor, currency, is_active, sort_order)
          values
            (${randomUUID()}, ${requestedTenantId}, 'Published service', 45, 1250000, 'NGN', true, 1),
            (${randomUUID()}, ${requestedTenantId}, 'Inactive service', 60, 2000000, 'NGN', false, 0)
        `;
      });

      await administrator.begin(async (transaction) => {
        await transaction`select set_config('app.tenant_id', ${otherTenantId}, true)`;
        await transaction`
          insert into services
            (id, tenant_id, name, duration_minutes, price_minor, currency, is_active, sort_order)
          values (${randomUUID()}, ${otherTenantId}, 'Other tenant service', 30, 500000, 'NGN', true, 0)
        `;
      });

      const catalog = await getPublishedBookingCatalog(
        runtime.db,
        requestedSlug,
      );

      assert.ok(catalog);
      assert.equal(catalog.tenantId, requestedTenantId);
      assert.equal(catalog.displayName, "Requested Studio");
      assert.deepEqual(
        catalog.services.map((service) => service.name),
        ["Published service"],
      );
    } finally {
      await deleteTenant(requestedTenantId);
      await deleteTenant(otherTenantId);
      await administrator`delete from users where id = ${userId}`;
      await Promise.all([administrator.end(), runtime.client.end()]);
    }
  },
);
