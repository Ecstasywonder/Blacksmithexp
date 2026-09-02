import "server-only";

import { randomUUID } from "node:crypto";
import type {
  AppointmentRequestRepository,
  RequestAppointmentCommand,
  RequestAppointmentResult,
} from "@chairly/domain";
import type { OwnerPendingAppointments } from "@chairly/database";
import { getSyntheticBookingCatalog } from "./public-booking-catalog";

type SyntheticAppointment = OwnerPendingAppointments["appointments"][number] & {
  tenantId: string;
};

const syntheticState = globalThis as typeof globalThis & {
  chairlySyntheticAppointments?: SyntheticAppointment[];
  chairlySyntheticAppointmentRequests?: Map<
    string,
    { command: string; result: RequestAppointmentResult }
  >;
};

function appointments(): SyntheticAppointment[] {
  syntheticState.chairlySyntheticAppointments ??= [];
  return syntheticState.chairlySyntheticAppointments;
}

function appointmentRequests() {
  syntheticState.chairlySyntheticAppointmentRequests ??= new Map();
  return syntheticState.chairlySyntheticAppointmentRequests;
}

export class SyntheticAppointmentRequestRepository implements AppointmentRequestRepository {
  async createPendingAppointment(
    command: RequestAppointmentCommand,
  ): Promise<RequestAppointmentResult> {
    const catalog = getSyntheticBookingCatalog(command.tenantSlug);
    if (!catalog) {
      return { ok: false, reason: "tenant_not_found" };
    }

    const requestKey = `${catalog.tenantId}:${command.idempotencyKey}`;
    const commandIdentity = JSON.stringify([
      command.serviceId,
      command.customerName,
      command.contactDetail,
      command.preferredTime,
    ]);
    const existingRequest = appointmentRequests().get(requestKey);
    if (existingRequest) {
      return existingRequest.command === commandIdentity
        ? existingRequest.result
        : { ok: false, reason: "idempotency_conflict" };
    }

    const service = catalog.services.find(
      (candidate) => candidate.id === command.serviceId,
    );
    if (!service) {
      return { ok: false, reason: "service_unavailable" };
    }

    const appointment: SyntheticAppointment = {
      id: randomUUID(),
      tenantId: catalog.tenantId,
      status: "pending",
      serviceName: service.name,
      preferredTime: command.preferredTime,
      timeZone: "Africa/Lagos",
      customerName: command.customerName,
      customerContact: command.contactDetail,
      createdAt: new Date(),
    };
    appointments().push(appointment);

    const result: RequestAppointmentResult = {
      ok: true,
      appointment: { id: appointment.id, status: appointment.status },
    };
    appointmentRequests().set(requestKey, { command: commandIdentity, result });
    return result;
  }
}

export function getSyntheticOwnerPendingAppointments(
  tenantSlug: string,
): OwnerPendingAppointments | null {
  const catalog = getSyntheticBookingCatalog(tenantSlug);
  if (!catalog) {
    return null;
  }

  return {
    tenantId: catalog.tenantId,
    tenantSlug,
    businessName: catalog.displayName,
    appointments: appointments()
      .filter((appointment) => appointment.tenantId === catalog.tenantId)
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      ),
  };
}
