/** Statuses that reserve staff capacity in the database and availability engine. */
export const activeAppointmentStatuses = ["pending", "confirmed"] as const;

export type AppointmentStatus =
  "pending" | "confirmed" | "declined" | "cancelled" | "completed" | "no_show";

const transitions: Readonly<
  Record<AppointmentStatus, readonly AppointmentStatus[]>
> = {
  pending: ["confirmed", "declined", "cancelled"],
  confirmed: ["cancelled", "completed", "no_show"],
  declined: [],
  cancelled: [],
  completed: [],
  no_show: [],
};

/**
 * Keeps lifecycle policy framework-independent and testable. Callers must also
 * persist the transition and its audit/outbox records in one transaction.
 */
export function canTransitionAppointment(
  from: AppointmentStatus,
  to: AppointmentStatus,
): boolean {
  return transitions[from].includes(to);
}

export type RequestAppointmentCommand = Readonly<{
  tenantSlug: string;
  serviceId: string;
  customerName: string;
  contactDetail: string;
  preferredTime: string;
  idempotencyKey: string;
  requestId: string;
}>;

export type RequestedAppointment = Readonly<{
  id: string;
  status: "pending";
}>;

export type AppointmentRequestOutcome = "created" | "duplicate";

export type RequestAppointmentFailure =
  | "tenant_not_found"
  | "service_unavailable"
  | "assignment_unavailable"
  | "invalid_preferred_time"
  | "slot_unavailable"
  | "idempotency_conflict";

export type RequestAppointmentResult =
  | Readonly<{
      ok: true;
      appointment: RequestedAppointment;
      outcome: AppointmentRequestOutcome;
    }>
  | Readonly<{ ok: false; reason: RequestAppointmentFailure }>;

export interface AppointmentRequestRepository {
  createPendingAppointment(
    command: RequestAppointmentCommand,
  ): Promise<RequestAppointmentResult>;
}

function normalizeIdentityText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

/**
 * Produces the stable, non-secret identity used to hash duplicate public
 * booking requests. Display values remain untouched; this only makes harmless
 * whitespace and capitalization differences compare equally.
 */
export function appointmentRequestIdentity(
  command: Pick<
    RequestAppointmentCommand,
    "serviceId" | "customerName" | "contactDetail" | "preferredTime"
  >,
): string {
  return JSON.stringify([
    command.serviceId.toLowerCase(),
    normalizeIdentityText(command.customerName),
    normalizeIdentityText(command.contactDetail),
    command.preferredTime,
  ]);
}

/** Creates one pending appointment through the configured transactional port. */
export function requestAppointment(
  repository: AppointmentRequestRepository,
  command: RequestAppointmentCommand,
): Promise<RequestAppointmentResult> {
  return repository.createPendingAppointment(command);
}
