import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export { withTenantTransaction } from "./tenant-transaction";
export {
  getPublishedBookingCatalog,
  type PublicBookingCatalog,
  type PublicBookingService,
} from "./public-booking-catalog";
export {
  getOwnerPendingAppointments,
  PostgresAppointmentRequestRepository,
  type OwnerPendingAppointments,
  type PendingAppointment,
} from "./appointments";

/**
 * Creates the server-only database adapter. The caller owns lifecycle cleanup
 * and must use a non-owner runtime role in deployed environments.
 */
export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, { prepare: false, max: 10 });
  return { client, db: drizzle(client, { schema }) };
}

export type Database = ReturnType<typeof createDatabase>["db"];
