import assert from "node:assert/strict";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  grantRuntimePrivileges,
  resetBookingSliceFixtures,
} from "@chairly/database";
import { bookingSliceFixtures } from "@chairly/shared";
import postgres from "postgres";
import {
  signChairlySession,
  type ChairlySessionPayload,
} from "../../apps/web/src/server/chairly-session";

const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL;
const baseUrl = process.env.APP_ORIGIN ?? "http://127.0.0.1:3210";

async function resetFixtures() {
  assert.ok(
    migrationDatabaseUrl,
    "MIGRATION_DATABASE_URL is required for e2e fixture setup",
  );

  const administrator = postgres(migrationDatabaseUrl, {
    max: 1,
    prepare: false,
  });

  try {
    await grantRuntimePrivileges(administrator);
    await resetBookingSliceFixtures(administrator);
  } finally {
    await administrator.end();
  }
}

function buildOwnerSession(owner: "luma" | "nova" | "quiet") {
  const fixtureOwner = bookingSliceFixtures.owners[owner];
  const fixtureTenant = bookingSliceFixtures.tenants[owner];
  const payload: ChairlySessionPayload = {
    userId: fixtureOwner.userId,
    tenantId: fixtureTenant.id,
    tenantSlug: fixtureTenant.slug,
    role: "owner",
    displayName: fixtureOwner.displayName,
    expiresAt: "2031-01-01T00:00:00.000Z",
  };

  return signChairlySession(payload);
}

async function setOwnerSession(page: Page, owner: "luma" | "nova" | "quiet") {
  await page.context().addCookies([
    {
      name: "chairly_session",
      value: buildOwnerSession(owner),
      url: baseUrl,
      sameSite: "Lax",
      httpOnly: true,
      secure: false,
    },
  ]);
}

async function createBooking(
  request: APIRequestContext,
  payload: {
    tenantSlug: string;
    serviceId: string;
    customerName: string;
    contactDetail: string;
    preferredTime: string;
    idempotencyKey: string;
  },
) {
  const response = await request.post("/api/v1/public/booking-requests", {
    data: payload,
    headers: {
      "x-idempotency-key": payload.idempotencyKey,
    },
  });
  const json = (await response.json()) as {
    appointment?: {
      appointmentId: string;
      publicReference: string;
      customerName: string;
      preferredTime: string;
    };
  };

  return { response, json };
}

test.beforeEach(async () => {
  await resetFixtures();
});

test("renders the published booking catalog on mobile without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/luma-studio/book");

  await expect(
    page.getByRole("heading", { level: 1, name: "Request an appointment" }),
  ).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(3);
  await expect(page.getByLabel("Your name")).toBeVisible();
  await expect(page.getByLabel("Email or phone number")).toBeVisible();
  await expect(page.getByLabel("Preferred time")).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );

  expect(hasHorizontalOverflow).toBe(false);
});

test("submits a happy-path booking request from the public form", async ({
  page,
}) => {
  await page.goto("/luma-studio/book");

  await page.getByLabel("Signature silk press").check();
  await page.getByLabel("Your name").fill("Ada Okafor");
  await page.getByLabel("Email or phone number").fill("ada@example.test");
  await page.getByLabel("Preferred time").fill("10:30 AM");
  await page.getByRole("button", { name: "Request appointment" }).click();

  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "We saved your appointment request.",
    }),
  ).toBeVisible();
  await expect(page.getByText("REQ-", { exact: false })).toBeVisible();
  await expect(page.getByText("10:30 AM", { exact: true })).toBeVisible();
});

test("shows the dashboard row with business, service, preferred time, contact detail, and pending status", async ({
  page,
  request,
}) => {
  const booking = await createBooking(request, {
    tenantSlug: bookingSliceFixtures.tenants.luma.slug,
    serviceId: bookingSliceFixtures.services.lumaSilkPress.id,
    customerName: "Happy Path Customer",
    contactDetail: "happy@example.test",
    preferredTime: "11:30 AM",
    idempotencyKey: "dashboard-happy-path",
  });

  expect(booking.response.status()).toBe(201);

  await setOwnerSession(page, "luma");
  await page.goto("/dashboard/appointments");

  await expect(page.getByText("Luma Studio", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Happy Path Customer", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("happy@example.test", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Signature silk press", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("11:30 AM", { exact: true })).toBeVisible();
  await expect(page.getByText("pending", { exact: true })).toBeVisible();
});

test("shows field-specific validation errors and persists no booking when required fields are missing", async ({
  page,
}) => {
  await page.goto("/luma-studio/book");
  await page.getByRole("button", { name: "Request appointment" }).click();

  await Promise.all([
    expect(
      page.getByText("Choose a service to continue.", { exact: true }),
    ).toBeVisible({ timeout: 1_000 }),
    expect(page.getByText("Enter your name", { exact: true })).toBeVisible({
      timeout: 1_000,
    }),
    expect(
      page.getByText("Enter your contact detail", { exact: true }),
    ).toBeVisible({ timeout: 1_000 }),
    expect(
      page.getByText("Enter your preferred time", { exact: true }),
    ).toBeVisible({ timeout: 1_000 }),
  ]);

  await expect(page.getByLabel("Signature silk press")).toBeFocused();

  await setOwnerSession(page, "luma");
  await page.goto("/dashboard/appointments");
  await expect(
    page.getByText("No pending appointments yet.", { exact: true }),
  ).toBeVisible();
});

test("rejects a malformed preferred time, then stores the corrected value", async ({
  page,
}) => {
  await page.goto("/luma-studio/book");

  await page.getByLabel("Wash and treatment").check();
  await page.getByLabel("Your name").fill("Chidi Nwosu");
  await page.getByLabel("Email or phone number").fill("+234 801 234 5678");
  const preferredTime = page.getByLabel("Preferred time");
  await preferredTime.fill("tomorrow-ish");
  await page.getByRole("button", { name: "Request appointment" }).click();

  await expect(
    page.getByText("Enter a valid time, like 2:30 PM", { exact: true }),
  ).toBeVisible({ timeout: 1_000 });
  await expect(preferredTime).toBeFocused();

  await preferredTime.fill("2:30 PM");
  await page.getByRole("button", { name: "Request appointment" }).click();

  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "We saved your appointment request.",
    }),
  ).toBeVisible();

  await setOwnerSession(page, "luma");
  await page.goto("/dashboard/appointments");
  await expect(page.getByText("Chidi Nwosu", { exact: true })).toBeVisible();
  await expect(page.getByText("2:30 PM", { exact: true })).toBeVisible();
  await expect(
    page.getByText("+234 801 234 5678", { exact: true }),
  ).toBeVisible();
});

test("shows a clear empty-state message when a business has no published services", async ({
  page,
}) => {
  await page.goto("/quiet-studio/book");

  await expect(
    page.getByRole("heading", {
      name: "This business isn't taking bookings yet",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("form", { name: "Book an appointment" }),
  ).toHaveCount(0);
});

test("keeps dashboard appointments isolated between reciprocal tenants", async ({
  browser,
  request,
}) => {
  await createBooking(request, {
    tenantSlug: bookingSliceFixtures.tenants.luma.slug,
    serviceId: bookingSliceFixtures.services.lumaBraids.id,
    customerName: "Luma Only Customer",
    contactDetail: "luma-only@example.test",
    preferredTime: "1:15 PM",
    idempotencyKey: "tenant-isolation-luma",
  });
  await createBooking(request, {
    tenantSlug: bookingSliceFixtures.tenants.nova.slug,
    serviceId: bookingSliceFixtures.services.novaCut.id,
    customerName: "Nova Only Customer",
    contactDetail: "nova-only@example.test",
    preferredTime: "3:00 PM",
    idempotencyKey: "tenant-isolation-nova",
  });

  const lumaContext = await browser.newContext({ baseURL: baseUrl });
  const lumaPage = await lumaContext.newPage();
  await setOwnerSession(lumaPage, "luma");
  await lumaPage.goto("/dashboard/appointments");
  await expect(
    lumaPage.getByText("Luma Only Customer", { exact: true }),
  ).toBeVisible();
  await expect(
    lumaPage.getByText("Nova Only Customer", { exact: true }),
  ).toHaveCount(0);
  await lumaContext.close();

  const novaContext = await browser.newContext({ baseURL: baseUrl });
  const novaPage = await novaContext.newPage();
  await setOwnerSession(novaPage, "nova");
  await novaPage.goto("/dashboard/appointments");
  await expect(
    novaPage.getByText("Nova Only Customer", { exact: true }),
  ).toBeVisible();
  await expect(
    novaPage.getByText("Luma Only Customer", { exact: true }),
  ).toHaveCount(0);
  await novaContext.close();
});

test("returns the same appointment for rapid duplicate submissions with one dashboard row", async ({
  page,
  request,
}) => {
  const payload = {
    tenantSlug: bookingSliceFixtures.tenants.luma.slug,
    serviceId: bookingSliceFixtures.services.lumaSilkPress.id,
    customerName: "Concurrent Ada",
    contactDetail: "concurrent@example.test",
    preferredTime: "4:45 PM",
    idempotencyKey: "rapid-duplicate-key",
  };

  const [first, second] = await Promise.all([
    createBooking(request, payload),
    createBooking(request, payload),
  ]);

  expect(first.response.status()).toBe(201);
  expect(second.response.status()).toBe(201);
  expect(first.json.appointment?.appointmentId).toBe(
    second.json.appointment?.appointmentId,
  );
  expect(first.json.appointment?.publicReference).toBe(
    second.json.appointment?.publicReference,
  );

  await setOwnerSession(page, "luma");
  await page.goto("/dashboard/appointments");
  await expect(
    page.locator("tbody tr").filter({ hasText: "Concurrent Ada" }),
  ).toHaveCount(1);
});
