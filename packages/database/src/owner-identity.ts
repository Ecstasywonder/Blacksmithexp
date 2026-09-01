import { sql } from "drizzle-orm";
import type { Database } from "./index";

export type OwnerIdentity = Readonly<{
  userId: string;
  tenantId: string;
}>;

/**
 * Resolves the first active owner membership for a server-verified OIDC
 * identity. The SECURITY DEFINER function is the narrow bootstrap boundary;
 * all tenant data reads after this use normal tenant-scoped RLS transactions.
 */
export async function resolveOwnerIdentity(
  database: Database,
  issuer: string,
  subject: string,
): Promise<OwnerIdentity | null> {
  const rows = await database.execute<OwnerIdentity>(sql`
    select
      membership.user_id as "userId",
      membership.tenant_id as "tenantId"
    from app.resolve_owner_membership(${issuer}, ${subject}) as membership
  `);
  return rows[0] ?? null;
}
