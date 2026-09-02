import assert from "node:assert/strict";
import test from "node:test";
import {
  requestAppointment,
  type AppointmentRequestRepository,
  type RequestAppointmentCommand,
} from "./index";

test("requestAppointment delegates the validated command exactly once", async () => {
  const command: RequestAppointmentCommand = {
    tenantSlug: "luma-studio",
    serviceId: "20000000-0000-4000-8000-000000000001",
    customerName: "  Ada Okafor  ",
    contactDetail: "Ada@Example.test",
    preferredTime: "2026-09-03T10:30",
    idempotencyKey: "appointment-request-1",
    requestId: "request-1",
  };
  const received: RequestAppointmentCommand[] = [];
  const repository: AppointmentRequestRepository = {
    async createPendingAppointment(value) {
      received.push(value);
      return {
        ok: true,
        appointment: { id: "appointment-1", status: "pending" },
      };
    },
  };

  const result = await requestAppointment(repository, command);

  assert.deepEqual(received, [command]);
  assert.deepEqual(result, {
    ok: true,
    appointment: { id: "appointment-1", status: "pending" },
  });
});
