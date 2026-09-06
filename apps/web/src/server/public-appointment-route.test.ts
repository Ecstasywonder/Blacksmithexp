import assert from "node:assert/strict";
import test from "node:test";

process.env.CHAIRLY_E2E_CATALOG = "synthetic";

const serviceId = "20000000-0000-4000-8000-000000000001";
const failureMessage = "We couldn't send your request. Please try again.";

test("only a verified runtime can supply a per-client rate-limit identity", async () => {
  const { trustedRateLimitClientAddress } =
    await import("./public-booking-rate-limit");
  const previousVercel = process.env.VERCEL;

  try {
    delete process.env.VERCEL;
    const firstUntrustedRequest = new Request("http://localhost", {
      headers: {
        "x-forwarded-for": "198.51.100.1",
        "x-real-ip": "198.51.100.2",
        "x-vercel-forwarded-for": "198.51.100.3",
      },
    });
    const secondUntrustedRequest = new Request("http://localhost", {
      headers: {
        "x-forwarded-for": "203.0.113.1",
        "x-real-ip": "203.0.113.2",
        "x-vercel-forwarded-for": "203.0.113.3",
      },
    });
    assert.equal(
      trustedRateLimitClientAddress(firstUntrustedRequest),
      trustedRateLimitClientAddress(secondUntrustedRequest),
    );

    process.env.VERCEL = "1";
    const verifiedRequest = new Request("http://localhost", {
      headers: {
        "x-forwarded-for": "198.51.100.10",
        "x-vercel-forwarded-for": "spoofed-prefix, 203.0.113.10",
      },
    });
    assert.equal(
      trustedRateLimitClientAddress(verifiedRequest),
      "203.0.113.10",
    );
  } finally {
    if (previousVercel === undefined) {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = previousVercel;
    }
  }
});

async function post(
  tenantSlug: string,
  body: unknown,
  options: {
    clientId?: string;
    contentType?: string;
    forwardedFor?: string;
  } = {},
) {
  const { POST } =
    await import("../app/api/public/[tenantSlug]/appointments/route");
  return POST(
    new Request(`http://localhost:3000/api/public/${tenantSlug}/appointments`, {
      method: "POST",
      headers: {
        "content-type": options.contentType ?? "application/json",
        "idempotency-key": `contract-${crypto.randomUUID()}`,
        "x-chairly-test-client-id": options.clientId ?? crypto.randomUUID(),
        "x-forwarded-for": options.forwardedFor ?? crypto.randomUUID(),
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

test("browser-supplied forwarding headers cannot bypass the rate limit", async () => {
  const clientId = `contract-rate-${crypto.randomUUID()}`;
  const responses = [];
  for (let index = 0; index < 21; index += 1) {
    responses.push(
      await post(
        "luma-studio",
        {},
        {
          clientId,
          forwardedFor: `spoofed-${crypto.randomUUID()}`,
        },
      ),
    );
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

test("chunked request bodies are cancelled as soon as they exceed 8 KiB", async () => {
  const { POST } =
    await import("../app/api/public/[tenantSlug]/appointments/route");
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(4_096));
    },
    cancel() {
      cancelled = true;
    },
  });
  const requestInit: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `contract-${crypto.randomUUID()}`,
      "x-chairly-test-client-id": crypto.randomUUID(),
    },
    body,
    duplex: "half",
  };

  const response = await POST(
    new Request(
      "http://localhost:3000/api/public/luma-studio/appointments",
      requestInit,
    ),
    { params: Promise.resolve({ tenantSlug: "luma-studio" }) },
  );

  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
});

for (const [field, invalidValue, expectedMessage] of [
  ["serviceId", "not-a-uuid", "Choose a service to continue."],
  ["customerName", " ", "Enter your name (120 characters or fewer)"],
  ["contactDetail", " ", "Enter your contact detail (254 characters or fewer)"],
  [
    "preferredTime",
    "2033-02-30T10:30",
    "Choose a valid preferred date and time",
  ],
] as const) {
  test(`validation response names ${field} and does not echo input or write a booking`, async () => {
    const { getSyntheticOwnerPendingAppointments } =
      await import("./synthetic-appointments");
    const before =
      getSyntheticOwnerPendingAppointments("luma-studio")?.appointments.length;
    const response = await post("luma-studio", {
      serviceId,
      customerName: "Contract customer",
      contactDetail: "contract@example.test",
      preferredTime: "2033-09-03T10:30",
      [field]: invalidValue,
    });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.deepEqual(payload.error.fieldErrors, { [field]: [expectedMessage] });
    assert.equal(payload.error.message, failureMessage);
    assert.ok(payload.error.requestId);
    assert.equal(
      getSyntheticOwnerPendingAppointments("luma-studio")?.appointments.length,
      before,
    );
  });
}
