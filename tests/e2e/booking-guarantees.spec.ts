import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page, APIRequestContext } from "@playwright/test";
import {
  test,
  expect,
  authenticate,
  inputFor,
  type BookingInput,
  type Fixture,
  type Tenant,
} from "./support/booking-fixtures";

async function fill(page: Page, tenant: Tenant, input: BookingInput) {
  await page.goto(`/${tenant.slug}/book`);
  await page.getByLabel("Identical service").check();
  await page.getByLabel("Your name", { exact: true }).fill(input.customerName);
  await page
    .getByLabel("Email or phone number", { exact: true })
    .fill(input.contactDetail);
  await page
    .getByLabel("Preferred time", { exact: true })
    .fill(input.preferredTime);
}
async function submit(page: Page, tenant: Tenant) {
  const accepted = page.waitForResponse(
    `**/api/public/${tenant.slug}/appointments`,
  );
  await page.getByRole("button", { name: "Request appointment" }).click();
  const response = await accepted;
  expect(response.status()).toBe(201);
  await expect(
    page.getByRole("status", { name: "Submission status" }),
  ).toContainText("request was sent");
  return response;
}
async function rows(booking: Fixture) {
  return booking.administrator`
    select a.id, a.tenant_id, a.status, a.customer_name_snapshot as customer_name,
      a.customer_contact_snapshot as contact, a.preferred_time_local_snapshot as preferred_time,
      s.service_id, s.name_snapshot as service_name
    from appointments a left join appointment_services s
      on s.tenant_id = a.tenant_id and s.appointment_id = a.id
    where a.tenant_id in (${booking.tenants[0].id}, ${booking.tenants[1].id})`;
}
async function assertOne(
  booking: Fixture,
  tenant: Tenant,
  input: BookingInput,
) {
  const stored = (await rows(booking)).filter(
    (row) => row.tenant_id === tenant.id,
  );
  expect(stored).toHaveLength(1);
  expect(stored[0]).toEqual({
    id: expect.any(String),
    tenant_id: tenant.id,
    status: "pending",
    customer_name: input.customerName,
    contact: input.contactDetail,
    preferred_time: input.preferredTime,
    service_id: input.serviceId,
    service_name: "Identical service",
  });
  const counts = await booking.administrator`
    select (select count(*)::int from appointments where tenant_id = ${tenant.id}) as appointments,
      (select count(*)::int from appointment_events where tenant_id = ${tenant.id}) as events,
      (select count(*)::int from audit_logs where tenant_id = ${tenant.id}) as audits,
      (select count(*)::int from outbox_events where tenant_id = ${tenant.id}) as outbox`;
  expect(counts[0]).toEqual({
    appointments: 1,
    events: 1,
    audits: 1,
    outbox: 1,
  });
  return stored[0]!.id as string;
}
async function post(
  request: APIRequestContext,
  tenant: Tenant,
  input: unknown,
  key = randomUUID(),
) {
  return request.post(`/api/public/${tenant.slug}/appointments`, {
    data: input,
    headers: { "idempotency-key": key },
  });
}

test("01: public form persists exactly one pending appointment with unchanged details", async ({
  page,
  context,
  booking,
}) => {
  const [tenant, other] = booking.tenants;
  const input = inputFor(tenant);
  await page.setViewportSize({ width: 390, height: 844 });
  await fill(page, tenant, input);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
  expect(
    (await new AxeBuilder({ page }).include(".booking-form").analyze())
      .violations,
  ).toEqual([]);
  const response = await submit(page, tenant);
  const id = await assertOne(booking, tenant, input);
  expect((await response.json()).appointment.id).toBe(id);
  expect(
    (await rows(booking)).filter((row) => row.tenant_id === other.id),
  ).toHaveLength(0);
  await authenticate(context, tenant);
  const dashboard = await context.request.get(
    "/api/dashboard/pending-appointments",
  );
  expect(dashboard.status()).toBe(200);
  expect((await dashboard.json()).appointments).toEqual([
    {
      id,
      status: "pending",
      serviceName: "Identical service",
      preferredTime: input.preferredTime,
      timeZone: tenant.timeZone,
      customerName: input.customerName,
      customerContact: input.contactDetail,
    },
  ]);
});

const missingFields = [
  ["serviceId", "Choose a service to continue."],
  ["customerName", "Enter your name"],
  ["contactDetail", "Enter your contact detail"],
  ["preferredTime", "Enter your preferred time"],
] as const;
for (const [field, message] of missingFields) {
  test(`02: missing ${field} is rejected in the browser and API without persistence`, async ({
    page,
    request,
    booking,
  }) => {
    const [tenant] = booking.tenants;
    const input = inputFor(tenant);
    await fill(page, tenant, input);
    if (field === "serviceId") {
      await page.goto(`/${tenant.slug}/book`);
      await page
        .getByLabel("Your name", { exact: true })
        .fill(input.customerName);
      await page
        .getByLabel("Email or phone number", { exact: true })
        .fill(input.contactDetail);
      await page
        .getByLabel("Preferred time", { exact: true })
        .fill(input.preferredTime);
    } else {
      await page.locator(`[name="${field}"]`).fill("");
    }
    await page.getByRole("button", { name: "Request appointment" }).click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(page.locator(`[name="${field}"]`).first()).toBeFocused();
    expect(await rows(booking)).toHaveLength(0);
    const invalid: Partial<BookingInput> = { ...input };
    delete invalid[field];
    const response = await post(request, tenant, invalid);
    expect(response.status()).toBe(400);
    const payload = await response.json();
    expect(payload.error.code).toBe("VALIDATION_FAILED");
    expect(payload.error.requestId).toEqual(expect.any(String));
    expect(payload.error.fieldErrors[field][0]).toContain(
      field === "preferredTime" ? "preferred" : message.replace(/\.$/, ""),
    );
    expect(await rows(booking)).toHaveLength(0);
  });
}

test("02: malformed date is rejected with no row before correction; server field errors reach the form", async ({
  page,
  request,
  booking,
}) => {
  const [tenant] = booking.tenants;
  const input = inputFor(tenant);
  await fill(page, tenant, input);
  const time = page.getByLabel("Preferred time", { exact: true });
  // Submit the malformed value synchronously: a datetime-local input otherwise
  // sanitizes it to an empty string when React restores the native input type.
  await time.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.type = "text";
    input.value = "2033-02-30T10:30";
    input.form?.requestSubmit();
  });
  await expect(
    page.getByText("Choose a valid preferred date and time", { exact: true }),
  ).toBeVisible();
  expect(await rows(booking)).toHaveLength(0);
  const rejected = await post(request, tenant, {
    ...input,
    preferredTime: "2033-02-30T10:30",
  });
  expect(rejected.status()).toBe(400);
  expect((await rejected.json()).error.fieldErrors.preferredTime).toEqual([
    "Choose a valid preferred date and time",
  ]);
  expect(await rows(booking)).toHaveLength(0);
  // Change the outgoing payload, but let the real server generate the response.
  await page.route(`**/api/public/${tenant.slug}/appointments`, (route) =>
    route.continue({
      postData: JSON.stringify({ ...input, preferredTime: "not-a-time" }),
    }),
  );
  await time.fill(input.preferredTime);
  const serverRejection = page.waitForResponse(
    `**/api/public/${tenant.slug}/appointments`,
  );
  await page.getByRole("button", { name: "Request appointment" }).click();
  expect((await serverRejection).status()).toBe(400);
  await expect(
    page.getByText("Choose a valid preferred date and time", { exact: true }),
  ).toBeVisible();
  await expect(time).toBeFocused();
  expect(await rows(booking)).toHaveLength(0);
  await page.unroute(`**/api/public/${tenant.slug}/appointments`);
  await submit(page, tenant);
  await assertOne(booking, tenant, input);
});

for (const [field, value] of [
  ["serviceId", "not-a-uuid"],
  ["customerName", "   "],
  ["customerName", "a".repeat(121)],
  ["contactDetail", "   "],
  ["contactDetail", "a".repeat(255)],
  ["preferredTime", "10:30 AM"],
  ["preferredTime", "2033-13-01T10:30"],
] as const) {
  test(`02: shipped validation rejects ${field}: ${value.length > 30 ? `length ${value.length}` : value}`, async ({
    request,
    booking,
  }) => {
    const [tenant] = booking.tenants;
    const response = await post(request, tenant, {
      ...inputFor(tenant),
      [field]: value,
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error.fieldErrors[field][0]).toEqual(
      expect.any(String),
    );
    expect(await rows(booking)).toHaveLength(0);
  });
}

test("01/02: shipped maximum lengths and phone contact remain accepted unchanged", async ({
  page,
  booking,
}) => {
  const [tenant] = booking.tenants;
  const input = {
    ...inputFor(tenant),
    customerName: "A".repeat(120),
    contactDetail: "1".repeat(254),
  };
  await fill(page, tenant, input);
  await submit(page, tenant);
  await assertOne(booking, tenant, input);
});

test("03: both public pages route to their own tenant and reciprocal owner reads stay isolated", async ({
  browser,
  booking,
}) => {
  const [a, b] = booking.tenants;
  const origin = `http://127.0.0.1:${process.env.CHAIRLY_E2E_PORT ?? 3215}`;
  const contextA = await browser.newContext({ baseURL: origin });
  const contextB = await browser.newContext({ baseURL: origin });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  try {
    const inputA = inputFor(a),
      inputB = { ...inputFor(b), customerName: "Other tenant customer" };
    await Promise.all([fill(pageA, a, inputA), fill(pageB, b, inputB)]);
    await Promise.all([submit(pageA, a), submit(pageB, b)]);
    const idA = await assertOne(booking, a, inputA),
      idB = await assertOne(booking, b, inputB);
    expect(idA).not.toBe(idB);
    for (const [context, tenant, id] of [
      [contextA, a, idA],
      [contextB, b, idB],
    ] as const) {
      await authenticate(context, tenant);
      const response = await context.request.get(
        `${origin}/api/dashboard/pending-appointments`,
      );
      expect(response.status()).toBe(200);
      expect(
        (await response.json()).appointments.map(
          (row: { id: string }) => row.id,
        ),
      ).toEqual([id]);
    }
    // A valid signature with a user who is not a member cannot select another tenant.
    await authenticate(contextA, b, a.ownerId);
    expect(
      (
        await contextA.request.get(
          `${origin}/api/dashboard/pending-appointments`,
        )
      ).status(),
    ).toBe(401);
    await booking.runtime.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${a.id}, true)`;
      expect(
        await tx`select id from appointments where tenant_id = ${b.id}`,
      ).toHaveLength(0);
      expect(
        await tx`update appointments set customer_name_snapshot = 'Forbidden change' where tenant_id = ${b.id} returning id`,
      ).toHaveLength(0);
    });
    await assertOne(booking, b, inputB);
  } finally {
    await Promise.all([contextA.close(), contextB.close()]);
  }
});

test("03: a foreign service cannot book into the page tenant; unauthenticated reads reveal nothing", async ({
  request,
  booking,
}) => {
  const [a, b] = booking.tenants;
  const response = await post(request, a, {
    ...inputFor(a),
    serviceId: b.serviceId,
  });
  expect(response.ok()).toBe(false);
  expect(await rows(booking)).toHaveLength(0);
  expect(
    (await request.get("/api/dashboard/pending-appointments")).status(),
  ).toBe(401);
});

test("04: browser rapid double-submit and sequential retry use one key and create one appointment", async ({
  page,
  booking,
}) => {
  const [tenant] = booking.tenants;
  const input = inputFor(tenant);
  await fill(page, tenant, input);
  const requests: import("@playwright/test").Request[] = [];
  const responses: import("@playwright/test").Response[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith(`/api/public/${tenant.slug}/appointments`))
      requests.push(request);
  });
  page.on("response", (response) => {
    if (response.url().endsWith(`/api/public/${tenant.slug}/appointments`))
      responses.push(response);
  });
  // Two synchronous submit events exercise the race before React disables the button.
  await page
    .getByRole("form", { name: "Book an appointment" })
    .evaluate((form) => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
  await expect.poll(() => responses.length).toBe(2);
  expect(requests).toHaveLength(2);
  const key = requests[0]!.headers()["idempotency-key"];
  expect(key).toBeTruthy();
  expect(requests[1]!.headers()["idempotency-key"]).toBe(key);
  expect(responses.map((response) => response.status())).toEqual([201, 201]);
  const first = await responses[0]!.json();
  expect(await responses[1]!.json()).toEqual(first);
  await expect(
    page.getByRole("button", { name: "Request appointment" }),
  ).toBeEnabled();
  await submit(page, tenant);
  expect(requests[2]!.headers()["idempotency-key"]).toBe(key);
  expect(await assertOne(booking, tenant, input)).toBe(first.appointment.id);
});
