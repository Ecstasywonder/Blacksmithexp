import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

process.env.CHAIRLY_E2E_CATALOG = "synthetic";

const serviceId = "20000000-0000-4000-8000-000000000001";
const failureMessage = "We couldn't send your request. Please try again.";
const trustedProxySecret = "test-only-trusted-proxy-client-ip-secret";

function signTrustedClientIp(
  address: string,
  headerName = "x-chairly-client-ip",
): string {
  return createHmac("sha256", trustedProxySecret)
    .update(`client-ip:v1\0${headerName}\0${address}`)
    .digest("hex");
}

async function post(
  tenantSlug: string,
  body: unknown,
  options: {
    clientIp?: string | null;
    contentLength?: string;
    contentType?: string;
    forwardedFor?: string;
    idempotencyKey?: string;
    trustedClientIp?: string;
    trustedClientIpSignature?: string;
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
  if (options.contentLength) {
    headers.set("content-length", options.contentLength);
  }
  if (options.trustedClientIp) {
    headers.set("x-chairly-client-ip", options.trustedClientIp);
  }
  if (options.trustedClientIpSignature) {
    headers.set(
      "x-chairly-client-ip-signature",
      options.trustedClientIpSignature,
    );
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

test("self-hosting authenticates a single proxy-supplied client IP", async () => {
  const previousVercel = process.env.VERCEL;
  const previousTrustedHeader = process.env.TRUSTED_PROXY_CLIENT_IP_HEADER;
  const previousTrustedSecret = process.env.TRUSTED_PROXY_CLIENT_IP_SECRET;
  try {
    delete process.env.VERCEL;
    process.env.TRUSTED_PROXY_CLIENT_IP_HEADER = "x-chairly-client-ip";
    process.env.TRUSTED_PROXY_CLIENT_IP_SECRET = trustedProxySecret;
    const { resolveDeployedPublicBookingClientAddress } =
      await import("@/server/public-booking-rate-limit");

    const address = "198.51.100.8";
    const request = new Request("http://localhost", {
      headers: {
        "x-chairly-client-ip": address,
        "x-chairly-client-ip-signature": signTrustedClientIp(address),
        "x-forwarded-for": "attacker-controlled",
      },
    });
    assert.equal(resolveDeployedPublicBookingClientAddress(request), address);

    assert.throws(
      () =>
        resolveDeployedPublicBookingClientAddress(
          new Request("http://localhost", {
            headers: { "x-chairly-client-ip": "203.0.113.9" },
          }),
        ),
      /signature is invalid/,
    );
    assert.throws(
      () =>
        resolveDeployedPublicBookingClientAddress(
          new Request("http://localhost", {
            headers: {
              "x-chairly-client-ip": "203.0.113.9",
              "x-chairly-client-ip-signature": signTrustedClientIp(address),
            },
          }),
        ),
      /signature is invalid/,
    );
    assert.throws(
      () =>
        resolveDeployedPublicBookingClientAddress(
          new Request("http://localhost", {
            headers: {
              "x-chairly-client-ip": "198.51.100.8, 203.0.113.9",
              "x-chairly-client-ip-signature": signTrustedClientIp(address),
            },
          }),
        ),
      /must contain exactly one valid client IP address/,
    );

    process.env.TRUSTED_PROXY_CLIENT_IP_SECRET = "too-short";
    assert.throws(
      () => resolveDeployedPublicBookingClientAddress(request),
      /TRUSTED_PROXY_CLIENT_IP_SECRET must contain at least 32 characters/,
    );
    process.env.TRUSTED_PROXY_CLIENT_IP_SECRET = trustedProxySecret;

    assert.throws(
      () =>
        resolveDeployedPublicBookingClientAddress(
          new Request("http://localhost", {
            headers: { "x-chairly-client-ip": "not-an-ip-address" },
          }),
        ),
      /must contain exactly one valid client IP address/,
    );

    delete process.env.TRUSTED_PROXY_CLIENT_IP_HEADER;
    assert.throws(
      () => resolveDeployedPublicBookingClientAddress(request),
      /TRUSTED_PROXY_CLIENT_IP_HEADER is required outside Vercel/,
    );
  } finally {
    if (previousVercel === undefined) {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = previousVercel;
    }
    if (previousTrustedHeader === undefined) {
      delete process.env.TRUSTED_PROXY_CLIENT_IP_HEADER;
    } else {
      process.env.TRUSTED_PROXY_CLIENT_IP_HEADER = previousTrustedHeader;
    }
    if (previousTrustedSecret === undefined) {
      delete process.env.TRUSTED_PROXY_CLIENT_IP_SECRET;
    } else {
      process.env.TRUSTED_PROXY_CLIENT_IP_SECRET = previousTrustedSecret;
    }
  }
});

test("the public booking route fails closed when self-hosted client identity is not configured", async () => {
  const previousCatalog = process.env.CHAIRLY_E2E_CATALOG;
  const previousVercel = process.env.VERCEL;
  const previousTrustedHeader = process.env.TRUSTED_PROXY_CLIENT_IP_HEADER;
  const previousTrustedSecret = process.env.TRUSTED_PROXY_CLIENT_IP_SECRET;
  try {
    delete process.env.CHAIRLY_E2E_CATALOG;
    delete process.env.VERCEL;
    delete process.env.TRUSTED_PROXY_CLIENT_IP_HEADER;
    delete process.env.TRUSTED_PROXY_CLIENT_IP_SECRET;

    const response = await post("luma-studio", {});
    assert.equal(response.status, 500);
    const payload = (await response.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    assert.equal(payload.error.code, "INTERNAL_ERROR");
    assert.equal(payload.error.message, failureMessage);
    assert.ok(payload.error.requestId);

    process.env.TRUSTED_PROXY_CLIENT_IP_HEADER = "x-chairly-client-ip";
    process.env.TRUSTED_PROXY_CLIENT_IP_SECRET = trustedProxySecret;
    const unsignedResponse = await post(
      "luma-studio",
      {},
      { trustedClientIp: "198.51.100.8" },
    );
    assert.equal(unsignedResponse.status, 500);
    const unsignedPayload = (await unsignedResponse.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    assert.equal(unsignedPayload.error.code, "INTERNAL_ERROR");
    assert.equal(unsignedPayload.error.message, failureMessage);
    assert.ok(unsignedPayload.error.requestId);
  } finally {
    if (previousCatalog === undefined) {
      delete process.env.CHAIRLY_E2E_CATALOG;
    } else {
      process.env.CHAIRLY_E2E_CATALOG = previousCatalog;
    }
    if (previousVercel === undefined) {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = previousVercel;
    }
    if (previousTrustedHeader === undefined) {
      delete process.env.TRUSTED_PROXY_CLIENT_IP_HEADER;
    } else {
      process.env.TRUSTED_PROXY_CLIENT_IP_HEADER = previousTrustedHeader;
    }
    if (previousTrustedSecret === undefined) {
      delete process.env.TRUSTED_PROXY_CLIENT_IP_SECRET;
    } else {
      process.env.TRUSTED_PROXY_CLIENT_IP_SECRET = previousTrustedSecret;
    }
  }
});

test("invalid content lengths reject an otherwise valid request before parsing", async () => {
  const validBody = {
    serviceId,
    customerName: "Content Length Customer",
    contactDetail: "content-length@example.test",
    preferredTime: "2033-09-03T10:30",
  };

  for (const contentLength of ["not-a-length", "-1", "1e3", "0x20"]) {
    const response = await post("luma-studio", validBody, { contentLength });

    assert.equal(response.status, 400);
    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };
    assert.equal(payload.error.code, "VALIDATION_FAILED");
    assert.equal(payload.error.message, failureMessage);
  }

  const oversized = await post("luma-studio", validBody, {
    contentLength: "8193",
  });
  assert.equal(oversized.status, 413);
});

test("malformed UTF-8 request streams are cancelled", async () => {
  const { POST } =
    await import("../app/api/public/[tenantSlug]/appointments/route");
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
    pull(controller) {
      controller.enqueue(Uint8Array.from([0xc3, 0x28]));
    },
  });
  const request = new Request(
    "http://localhost:3000/api/public/luma-studio/appointments",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `utf8-${crypto.randomUUID()}`,
        "x-chairly-test-client-ip": crypto.randomUUID(),
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" },
  );

  const response = await POST(request, {
    params: Promise.resolve({ tenantSlug: "luma-studio" }),
  });

  assert.equal(response.status, 400);
  assert.equal(cancelled, true);
});

test("oversized streamed bodies are cancelled before they are fully read", async () => {
  const { POST } =
    await import("../app/api/public/[tenantSlug]/appointments/route");
  const totalChunks = 10;
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(pulls === 1 ? 8_192 : 1));
      if (pulls === totalChunks) {
        controller.close();
      }
    },
  });
  const request = new Request(
    "http://localhost:3000/api/public/luma-studio/appointments",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `stream-${crypto.randomUUID()}`,
        "x-chairly-test-client-ip": crypto.randomUUID(),
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" },
  );

  const response = await POST(request, {
    params: Promise.resolve({ tenantSlug: "luma-studio" }),
  });

  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.ok(pulls < totalChunks);
});
