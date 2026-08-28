import "server-only";

import { requestAppointment } from "@chairly/domain";
import { PostgresAppointmentRequestRepository } from "@chairly/database";
import type { PublicAppointmentRequest } from "@chairly/shared";
import { getDatabase } from "./database";
import { isSyntheticBookingEnvironment } from "./public-booking-catalog";
import { SyntheticAppointmentRequestRepository } from "./synthetic-appointments";

export function submitPublicAppointmentRequest(
  tenantSlug: string,
  input: PublicAppointmentRequest,
  idempotencyKey: string,
  requestId: string,
) {
  const repository = isSyntheticBookingEnvironment()
    ? new SyntheticAppointmentRequestRepository()
    : new PostgresAppointmentRequestRepository(getDatabase().db);

  return requestAppointment(repository, {
    tenantSlug,
    ...input,
    idempotencyKey,
    requestId,
  });
}
