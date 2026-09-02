import assert from "node:assert/strict";
import test from "node:test";

process.env.CHAIRLY_E2E_CATALOG = "synthetic";

const serviceId = "20000000-0000-4000-8000-000000000001";
const failureMessage = "We couldn't send your request. Please try again.";

async function post(
  tenantSlug: string,
  body: unknown,
  options: {
    clientIp?: string | null;
    contentType?: string;
    forwardedFor?: string;
    idempotencyKey?: string;
  } = {},
) {
  const { POST } =
    await import("../app/api/public/[tenantSlug]/appointments/route");
  const headers = new Headers({
    "content-type": options.contentType ?? "application/json",
    "idempotency-key":
      "idempotencyKey" in options && typeof options.idempotencyKey === "string"
        ? options.idempotencyKey
        : `contract-${crypto.randomUUID()}`,
  });
  if (options.clientIp !== null) {
    headers.set(
      "x-chairly-test-client-ip",
      options.clientIp ?? crypto.randomUUID(),
    );
  }
  if (options.forwardedFor) {
    headers.set("x-forwarded-for", options.forwardedFor);
  }

  return POST(
    new Request(`http://localhost:3000/api/public/${tenantSlug}/appointments`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tenantSlug }) },
  );
}

test("public appointment route returns the pending response contract", async () => {
  const response = await post("luma-studio", {
    serviceId,
    customerName: "  Contract Customer  ",
    contactDetail: "Contract.Case@Example.test",
    preferredTime: "2033-09-03T10:30",
  });

  assert.equal(response.status, 201);
  const payload: unknown = await response.json();
  assert.ok(
    typeof payload === "object" && payload !== null && "appointment" in payload,
  );
  const appointmentPayload = payload as unknown as {
    appointment: { status: string };
    outcome: string;
  };
  assert.equal(appointmentPayload.appointment.status, "pending");
  assert.equal(appointmentPayload.outcome, "created");
});

test("identical normalized requests return the duplicate contract and create once", async () => {
  const unique = crypto.randomUUID();
  const preferredTime = "2033-09-03T11:30";
  const first = await post("luma-studio", {
    serviceId,
    customerName: `  Ada   Duplicate ${unique}  `,
    contactDetail: `Ada.Duplicate+${unique}@Example.TEST`,
    preferredTime,
  });
  const duplicate = await post("luma-studio", {
    serviceId,
    customerName: `ada duplicate ${unique}`,
    contactDetail: `  ada.duplicate+${unique}@example.test  `,
    preferredTime,
  });

  assert.equal(first.status, 201);
  assert.equal(duplicate.status, 200);
  const firstPayload = (await first.json()) as {
    appointment: { id: string };
    outcome: string;
  };
  const duplicatePayload = (await duplicate.json()) as {
    appointment: { id: string };
    outcome: string;
  };
  assert.equal(duplicatePayload.outcome, "duplicate");
  assert.equal(duplicatePayload.appointment.id, firstPayload.appointment.id);

  const { getSyntheticOwnerPendingAppointments } =
    await import("@/server/synthetic-appointments");
  const matches =
    getSyntheticOwnerPendingAppointments("luma-studio")?.appointments.filter(
      (appointment) => appointment.customerContact.includes(unique),
    ) ?? [];
  assert.equal(matches.length, 1);
});

test("parallel identical requests create once while distinct requests remain separate", async () => {
  const unique = crypto.randomUUID();
  const baseRequest = {
    serviceId,
    customerName: `Parallel ${unique}`,
    contactDetail: `parallel-${unique}@example.test`,
    preferredTime: "2033-09-04T10:30",
  };
  const [left, right] = await Promise.all([
    post("luma-studio", baseRequest),
    post("luma-studio", baseRequest),
  ]);
  assert.deepEqual([left.status, right.status].sort(), [200, 201]);

  const differentService = await post("luma-studio", {
    ...baseRequest,
    serviceId: "20000000-0000-4000-8000-000000000002",
  });
  const differentTime = await post("luma-studio", {
    ...baseRequest,
    preferredTime: "2033-09-04T12:30",
  });
  assert.equal(differentService.status, 201);
  assert.equal(differentTime.status, 201);
});

test("identical customer details remain isolated by business", async () => {
  const unique = crypto.randomUUID();
  const details = {
    customerName: `Tenant scoped ${unique}`,
    contactDetail: `tenant-${unique}@example.test`,
    preferredTime: "2033-09-05T10:30",
  };
  const [luma, ember] = await Promise.all([
    post("luma-studio", { ...details, serviceId }),
    post("ember-studio", {
      ...details,
      serviceId: "20000000-0000-4000-8000-000000000004",
    }),
  ]);

  assert.equal(luma.status, 201);
  assert.equal(ember.status, 201);
  const [lumaPayload, emberPayload] = (await Promise.all([
    luma.json(),
    ember.json(),
  ])) as [{ appointment: { id: string } }, { appointment: { id: string } }];
  assert.notEqual(lumaPayload.appointment.id, emberPayload.appointment.id);
});

test("public appointment route returns the safe validation contract", async () => {
  const response = await post("luma-studio", {
    serviceId: "not-a-uuid",
    customerName: "",
    contactDetail: "",
    preferredTime: "not-a-time",
  });

  assert.equal(response.status, 400);
  const payload = (await response.json()) as {
    error: { code: string; message: string; requestId: string };
  };
  assert.equal(payload.error.code, "VALIDATION_FAILED");
  assert.equal(payload.error.message, failureMessage);
  assert.ok(payload.error.requestId);
});

test("an unresolved tenant returns the safe message and creates nothing", async () => {
  const customerName = `Unmatched contract ${crypto.randomUUID()}`;
  const { getSyntheticOwnerPendingAppointments } =
    await import("@/server/synthetic-appointments");
  const before = ["luma-studio", "ember-studio"].flatMap(
    (slug) => getSyntheticOwnerPendingAppointments(slug)?.appointments ?? [],
  );
  const response = await post("missing-business", {
    serviceId,
    customerName,
    contactDetail: "unmatched@example.test",
    preferredTime: "2033-09-03T10:30",
  });
  const after = ["luma-studio", "ember-studio"].flatMap(
    (slug) => getSyntheticOwnerPendingAppointments(slug)?.appointments ?? [],
  );

  assert.equal(response.status, 404);
  const payload = (await response.json()) as {
    error: { code: string; message: string };
  };
  assert.equal(payload.error.code, "NOT_FOUND");
  assert.equal(payload.error.message, failureMessage);
  assert.equal(after.length, before.length);
  assert.equal(
    after.some((appointment) => appointment.customerName === customerName),
    false,
  );
});

test("public appointment route applies its risk-based rate limit", async () => {
  const clientIp = `contract-rate-${crypto.randomUUID()}`;
  const responses = [];
  for (let index = 0; index < 21; index += 1) {
    responses.push(await post("luma-studio", {}, { clientIp }));
  }

  assert.equal(responses[19]?.status, 400);
  assert.equal(responses[20]?.status, 429);
  assert.equal(responses[20]?.headers.get("retry-after"), "60");
  const payload = (await responses[20]?.json()) as {
    error: { code: string; message: string };
  };
  assert.equal(payload.error.code, "RATE_LIMITED");
  assert.equal(payload.error.message, failureMessage);
});

test("untrusted forwarding headers cannot rotate around the rate limit", async () => {
  const responses = [];
  for (let index = 0; index < 21; index += 1) {
    responses.push(
      await post(
        "ember-studio",
        {},
        {
          clientIp: null,
          forwardedFor: `untrusted-${index}`,
        },
      ),
    );
  }

  assert.equal(responses[19]?.status, 400);
  assert.equal(responses[20]?.status, 429);
});
