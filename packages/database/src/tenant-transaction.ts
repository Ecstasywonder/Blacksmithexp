import { sql } from "drizzle-orm";
import type { Database } from "./index";

type TransactionCallback = Parameters<Database["transaction"]>[0];
export type TenantTransaction = Parameters<TransactionCallback>[0];

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Establishes transaction-local tenant context for PostgreSQL RLS.
 * `SET LOCAL`/`set_config(..., true)` prevents tenant identity from leaking
 * when a pooled connection is later reused by another request.
 */
export async function withTenantTransaction<T>(
  database: Database,
  tenantId: string,
  work: (transaction: TenantTransaction) => Promise<T>,
): Promise<T> {
  if (!uuidPattern.test(tenantId)) {
    throw new TypeError("A valid tenant UUID is required");
  }

  return database.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return work(transaction);
  });
}
