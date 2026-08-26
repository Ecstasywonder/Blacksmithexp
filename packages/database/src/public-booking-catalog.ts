import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./index";
import { services, tenants } from "./schema";
import { withTenantTransaction } from "./tenant-transaction";

const tenantSlugPattern = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/;

export type PublicBookingService = {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceMinor: number;
  currency: string;
};

export type PublicBookingCatalog = {
  tenantId: string;
  displayName: string;
  services: PublicBookingService[];
};

/**
 * Resolves a public slug through the narrow database function, then reloads
 * the published tenant and active services inside tenant-scoped RLS context.
 */
export async function getPublishedBookingCatalog(
  database: Database,
  tenantSlug: string,
): Promise<PublicBookingCatalog | null> {
  const normalizedSlug = tenantSlug.trim().toLowerCase();
  if (!tenantSlugPattern.test(normalizedSlug)) {
    return null;
  }

  const resolvedRows = await database.execute<{ tenantId: string | null }>(
    sql`select app.resolve_published_tenant(${normalizedSlug}) as "tenantId"`,
  );
  const tenantId = resolvedRows[0]?.tenantId;

  if (!tenantId) {
    return null;
  }

  return withTenantTransaction(database, tenantId, async (transaction) => {
    const [tenant] = await transaction
      .select({ id: tenants.id, displayName: tenants.displayName })
      .from(tenants)
      .where(
        and(
          eq(tenants.id, tenantId),
          eq(tenants.slug, normalizedSlug),
          eq(tenants.status, "active"),
          eq(tenants.isPublished, true),
          isNull(tenants.archivedAt),
        ),
      )
      .limit(1);

    if (!tenant) {
      return null;
    }

    const publishedServices = await transaction
      .select({
        id: services.id,
        name: services.name,
        description: services.description,
        durationMinutes: services.durationMinutes,
        priceMinor: services.priceMinor,
        currency: services.currency,
      })
      .from(services)
      .where(
        and(
          eq(services.tenantId, tenantId),
          eq(services.isActive, true),
          isNull(services.archivedAt),
        ),
      )
      .orderBy(asc(services.sortOrder), asc(services.name));

    return {
      tenantId: tenant.id,
      displayName: tenant.displayName,
      services: publishedServices,
    };
  });
}
