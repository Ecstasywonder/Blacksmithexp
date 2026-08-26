/** Statuses that reserve staff capacity in the database and availability engine. */
export const activeAppointmentStatuses = ["pending", "confirmed"] as const;

export type AppointmentStatus =
  | "pending"
  | "confirmed"
  | "declined"
  | "cancelled"
  | "completed"
  | "no_show";

const transitions: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
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
export function canTransitionAppointment(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return transitions[from].includes(to);
}
