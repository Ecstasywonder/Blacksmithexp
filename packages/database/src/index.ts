import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export { withTenantTransaction } from "./tenant-transaction";
export {
  getPublishedBookingCatalog,
  resolvePublishedTenantId,
  type PublicBookingCatalog,
  type PublicBookingService,
} from "./public-booking-catalog";
export {
  BookingSliceError,
  getDashboardMembership,
  listDashboardAppointments,
  requestPublicAppointment,
  type DashboardAppointmentRecord,
  type DashboardMembership,
  type RequestPublicAppointmentInput,
  type RequestedAppointmentRecord,
} from "./booking-slice";
export {
  grantRuntimePrivileges,
  resetBookingSliceFixtures,
} from "./booking-slice-fixtures";

/**
 * Creates the server-only database adapter. The caller owns lifecycle cleanup
 * and must use a non-owner runtime role in deployed environments.
 */
export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, { prepare: false, max: 10 });
  return { client, db: drizzle(client, { schema }) };
}

export type Database = ReturnType<typeof createDatabase>["db"];
