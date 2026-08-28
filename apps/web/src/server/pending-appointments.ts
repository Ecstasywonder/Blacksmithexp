import "server-only";

import {
  getOwnerPendingAppointments,
  type OwnerPendingAppointments,
} from "@chairly/database";
import { getDashboardIdentity } from "./dashboard-session";
import { getDatabase } from "./database";
import { getSyntheticOwnerPendingAppointments } from "./synthetic-appointments";

export async function loadOwnerPendingAppointments(): Promise<OwnerPendingAppointments | null> {
  const identity = await getDashboardIdentity();
  if (!identity) {
    return null;
  }

  if (identity.kind === "synthetic") {
    return getSyntheticOwnerPendingAppointments(identity.tenantSlug);
  }

  return getOwnerPendingAppointments(
    getDatabase().db,
    identity.userId,
    identity.tenantId,
  );
}
