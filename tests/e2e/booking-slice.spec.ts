import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";

const serviceA = "20000000-0000-4000-8000-000000000001";
const serviceB = "20000000-0000-4000-8000-000000000002";
const date = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

async function signIn(page: Page, business = "luma-studio") {
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  await page.getByLabel("Business").selectOption(business);
  await page.getByLabel("Password").fill("booking-demo");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/appointments$/);
  await expect(
    page.getByRole("heading", { name: "Pending appointments" }),
  ).toBeVisible();
}

async function fill(page: Page, name: string, time: string) {
  await page.goto("/luma-studio");
  await page.getByRole("link", { name: "Book an appointment" }).click();
  await page.getByLabel("Signature silk press").check();
  await page.getByLabel("Your name").fill(name);
  await page
    .getByLabel("Email or phone number")
    .fill("demo-customer@example.test");
  await page.getByLabel("Preferred time").fill(`${date}T${time}`);
}

function payload(serviceId: string) {
  return {
    serviceId,
    customerName: "Isolation demo",
    contactDetail: "isolation@example.test",
    preferredTime: `${date}T14:00`,
  };
}

test("validation errors: actionable form errors and safe malformed API response", async ({
  page,
}) => {
  await page.goto("/luma-studio/book");
  await page.getByRole("button", { name: "Request appointment" }).click();
  await expect(page.getByText("Choose a service to continue.")).toBeVisible();
  await expect(
    page.getByText("Enter your name", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Enter your contact detail", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Enter your preferred time", { exact: true }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const malformed = await page.request.post(
    "/api/public/luma-studio/appointments",
    {
      data: "{",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
    },
  );
  expect(malformed.status()).toBe(400);
  const error = await malformed.json();
  expect(error).toHaveProperty("error.requestId");
  expect(JSON.stringify(error)).toContain("Please try again");
  await fill(page, "Malformed demo", "09:00");
  await page.getByLabel("Preferred time").fill("2000-01-01T09:00");
  const rejected = page.waitForResponse(
    "**/api/public/luma-studio/appointments",
  );
  await page.getByRole("button", { name: "Request appointment" }).click();
  await expect(
    page.getByRole("status", { name: "Submission status" }),
  ).toContainText("Please try again");
  expect((await rejected).status()).toBe(422);
});

test("happy path: public request appears as pending for the authenticated business", async ({
  page,
  browser,
}) => {
  await signIn(page);
  // A separate browser context proves an anonymous customer can book and
  // the owner refreshes from persisted data without shared cookies/storage.
  const customer = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  try {
    const booking = await customer.newPage();
    await fill(booking, "Happy path demo", "10:00");
    expect(
      (await new AxeBuilder({ page: booking }).analyze()).violations,
    ).toEqual([]);
    const response = booking.waitForResponse(
      "**/api/public/luma-studio/appointments",
    );
    await booking.getByRole("button", { name: "Request appointment" }).click();
    expect((await response).status()).toBe(201);
    await expect(
      booking.getByRole("status", { name: "Submission status" }),
    ).toContainText("request was sent");
    await page.bringToFront();
    const card = page
      .getByRole("listitem")
      .filter({ hasText: "Happy path demo" });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText("Pending");
    await expect(card).toContainText("Signature silk press");
    await page.reload();
    await expect(card).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await customer.close();
  }
});

test("tenant isolation: owners cannot read or book using another business's service", async ({
  page,
  browser,
}) => {
  await signIn(page);
  const other = await browser.newContext();
  try {
    const ownerB = await other.newPage();
    await signIn(ownerB, "ember-studio");
    const foreignService = await page.request.post(
      "/api/public/luma-studio/appointments",
      { data: payload(serviceB), headers: { "idempotency-key": randomUUID() } },
    );
    expect(foreignService.status()).toBe(422);
    const [a, b] = await Promise.all([
      page.request.post("/api/public/luma-studio/appointments", {
        data: payload(serviceA),
        headers: { "idempotency-key": randomUUID() },
      }),
      ownerB.request.post("/api/public/ember-studio/appointments", {
        data: payload(serviceB),
        headers: { "idempotency-key": randomUUID() },
      }),
    ]);
    expect(a.status()).toBe(201);
    expect(b.status()).toBe(201);
    const idA = (await a.json()).appointment.id;
    const idB = (await b.json()).appointment.id;
    const inboxA = await (
      await page.request.get(
        "/api/dashboard/pending-appointments?tenant_id=10000000-0000-4000-8000-000000000002",
      )
    ).json();
    const inboxB = await (
      await ownerB.request.get("/api/dashboard/pending-appointments")
    ).json();
    expect(inboxA.appointments.map((row: { id: string }) => row.id)).toContain(
      idA,
    );
    expect(
      inboxA.appointments.map((row: { id: string }) => row.id),
    ).not.toContain(idB);
    expect(inboxB.appointments.map((row: { id: string }) => row.id)).toContain(
      idB,
    );
    expect(
      inboxB.appointments.map((row: { id: string }) => row.id),
    ).not.toContain(idA);
  } finally {
    await other.close();
  }
  const anonymous = await browser.newContext();
  try {
    expect(
      (
        await anonymous.request.get(
          "http://127.0.0.1:3310/api/dashboard/pending-appointments",
        )
      ).status(),
    ).toBe(401);
  } finally {
    await anonymous.close();
  }
});

test("duplicate submission: replay keeps one persisted pending appointment", async ({
  page,
}) => {
  await signIn(page);
  await fill(page, "Duplicate demo", "12:00");
  const first = page.waitForResponse("**/api/public/luma-studio/appointments");
  await page.getByRole("button", { name: "Request appointment" }).click();
  const response = await first;
  expect(response.status()).toBe(201);
  const created = await response.json();
  await expect(
    page.getByRole("status", { name: "Submission status" }),
  ).toContainText("request was sent");
  const replay = page.waitForResponse("**/api/public/luma-studio/appointments");
  await page.getByRole("button", { name: "Request appointment" }).click();
  const repeated = await replay;
  expect(repeated.status()).toBe(200);
  expect(await repeated.json()).toEqual({ ...created, outcome: "duplicate" });
  await expect(
    page.getByRole("status", { name: "Submission status" }),
  ).toContainText("already received");
  const inbox = await (
    await page.request.get("/api/dashboard/pending-appointments")
  ).json();
  expect(
    inbox.appointments.filter(
      (row: { id: string }) => row.id === created.appointment.id,
    ),
  ).toHaveLength(1);
});
