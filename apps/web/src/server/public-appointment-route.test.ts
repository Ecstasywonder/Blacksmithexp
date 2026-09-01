import assert from "node:assert/strict";
import test from "node:test";

process.env.CHAIRLY_E2E_CATALOG = "synthetic";

const serviceId = "20000000-0000-4000-8000-000000000001";
const failureMessage = "We couldn't send your request. Please try again.";

async function post(
  tenantSlug: string,
  body: unknown,
  options: { clientIp?: string; contentType?: string } = {},
) {
  const { POST } =
    await import("../app/api/public/[tenantSlug]/appointments/route");
  return POST(
    new Request(`http://localhost:3000/api/public/${tenantSlug}/appointments`, {
      method: "POST",
      headers: {
        "content-type": options.contentType ?? "application/json",
        "idempotency-key": `contract-${crypto.randomUUID()}`,
        "x-forwarded-for": options.clientIp ?? crypto.randomUUID(),
      },
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
  assert.equal(
    (payload as { appointment: { status: string } }).appointment.status,
    "pending",
  );
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
