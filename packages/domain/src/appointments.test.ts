import assert from "node:assert/strict";
import test from "node:test";
import {
  appointmentRequestIdentity,
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
        outcome: "created",
      };
    },
  };

  const result = await requestAppointment(repository, command);

  assert.deepEqual(received, [command]);
  assert.deepEqual(result, {
    ok: true,
    appointment: { id: "appointment-1", status: "pending" },
    outcome: "created",
  });
});

test("appointment request identity tolerates harmless name and contact formatting", () => {
  const common = {
    serviceId: "20000000-0000-4000-8000-000000000001",
    preferredTime: "2026-09-03T10:30",
  };

  assert.equal(
    appointmentRequestIdentity({
      ...common,
      customerName: "  Ada   OKAFOR ",
      contactDetail: " Ada@Example.TEST ",
    }),
    appointmentRequestIdentity({
      ...common,
      customerName: "ada okafor",
      contactDetail: "ada@example.test",
    }),
  );
});

test("appointment request identity keeps different services and times distinct", () => {
  const request = {
    serviceId: "20000000-0000-4000-8000-000000000001",
    customerName: "Ada Okafor",
    contactDetail: "ada@example.test",
    preferredTime: "2026-09-03T10:30",
  };

  assert.notEqual(
    appointmentRequestIdentity(request),
    appointmentRequestIdentity({
      ...request,
      serviceId: "20000000-0000-4000-8000-000000000002",
    }),
  );
  assert.notEqual(
    appointmentRequestIdentity(request),
    appointmentRequestIdentity({
      ...request,
      preferredTime: "2026-09-03T10:45",
    }),
  );
});
