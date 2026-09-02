import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const appUrl = "http://127.0.0.1:3210";

async function authenticateOwner(context: BrowserContext, tenantSlug: string) {
  await context.addCookies([
    {
      name: "chairly_e2e_tenant_slug",
      value: tenantSlug,
      url: appUrl,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
}

async function fillBooking(
  page: Page,
  tenantSlug: string,
  customerName: string,
  contactDetail: string,
  preferredTime: string,
) {
  await page.goto(`/${tenantSlug}/book`);
  await page.getByLabel("Signature silk press").check();
  await page.getByLabel("Your name").fill(customerName);
  await page.getByLabel("Email or phone number").fill(contactDetail);
  await page.getByLabel("Preferred time").fill(preferredTime);
}

test.describe("pending appointment inbox", () => {
  test("shows an accepted request to its owner within two seconds with exact details", async ({
    context,
  }) => {
    const unique = Date.now();
    const customerName = `Ada exact ${unique}`;
    const customerContact = `Ada.Exact+${unique}@Example.test`;
    const preferredTime = "2032-09-03T10:30";

    await authenticateOwner(context, "luma-studio");
    const dashboard = await context.newPage();
    const dashboardRefreshReady = dashboard.waitForResponse(
      (response) =>
        response.url().endsWith("/api/dashboard/pending-appointments") &&
        response.ok(),
    );
    await dashboard.goto("/dashboard/appointments");
    await expect(
      dashboard.getByRole("heading", { name: "Pending appointments" }),
    ).toBeVisible();
    await dashboardRefreshReady;

    const booking = await context.newPage();
    await fillBooking(
      booking,
      "luma-studio",
      customerName,
      customerContact,
      preferredTime,
    );

    await booking.getByRole("button", { name: "Request appointment" }).click();
    await expect(
      booking.getByRole("status", { name: "Submission status" }),
    ).toContainText("request was sent");
    await dashboard.bringToFront();
    const acceptedAt = Date.now();

    const requestCard = dashboard
      .getByRole("listitem")
      .filter({ hasText: customerName });
    await expect(requestCard).toBeVisible({ timeout: 2_000 });
    expect(Date.now() - acceptedAt).toBeLessThan(2_000);
    await expect(requestCard).toContainText("Signature silk press");
    await expect(requestCard).toContainText(preferredTime);
    await expect(requestCard).toContainText(customerName);
    await expect(requestCard).toContainText(customerContact);
    await expect(requestCard).toContainText("Pending");
    await expect(
      requestCard.getByRole("button", { name: /confirm|decline/i }),
    ).toHaveCount(0);
    const accessibility = await new AxeBuilder({ page: dashboard }).analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test("replays the same booking request without creating a duplicate", async ({
    context,
  }) => {
    const unique = Date.now();
    const customerName = `Ada replay ${unique}`;
    const customerContact = `ada-replay-${unique}@example.test`;
    const preferredTime = "2032-09-03T12:30";

    await authenticateOwner(context, "luma-studio");
    const booking = await context.newPage();
    await fillBooking(
      booking,
      "luma-studio",
      customerName,
      customerContact,
      preferredTime,
    );

    const submittedRequest = booking.waitForRequest(
      "**/api/public/luma-studio/appointments",
    );
    const submittedResponse = booking.waitForResponse(
      "**/api/public/luma-studio/appointments",
    );
    await booking.getByRole("button", { name: "Request appointment" }).click();
    const [firstRequest, firstResponse] = await Promise.all([
      submittedRequest,
      submittedResponse,
    ]);
    expect(firstResponse.status()).toBe(201);

    await booking.getByRole("button", { name: "Request appointment" }).click();
    await expect(
      booking.getByRole("status", { name: "Submission status" }),
    ).toHaveText(
      "We already received this booking request — no need to send it again.",
    );

    const idempotencyKey = firstRequest.headers()["idempotency-key"];
    expect(idempotencyKey).toBeTruthy();
    const replayResponse = await booking.request.post(firstRequest.url(), {
      data: firstRequest.postDataJSON(),
      headers: { "idempotency-key": idempotencyKey! },
    });
    expect(replayResponse.status()).toBe(200);
    const replayPayload = (await replayResponse.json()) as {
      appointment: { id: string };
      outcome: string;
    };
    const firstPayload = (await firstResponse.json()) as {
      appointment: { id: string };
      outcome: string;
    };
    expect(replayPayload).toEqual({
      appointment: firstPayload.appointment,
      outcome: "duplicate",
    });

    const dashboardResponse = await booking.request.get(
      `${appUrl}/api/dashboard/pending-appointments`,
    );
    expect(dashboardResponse.status()).toBe(200);
    const dashboardPayload: unknown = await dashboardResponse.json();
    expect(
      typeof dashboardPayload === "object" &&
        dashboardPayload !== null &&
        "appointments" in dashboardPayload &&
        Array.isArray(dashboardPayload.appointments)
        ? dashboardPayload.appointments.filter(
            (appointment) =>
              typeof appointment === "object" &&
              appointment !== null &&
              "customerName" in appointment &&
              appointment.customerName === customerName,
          )
        : [],
    ).toHaveLength(1);
  });

  test("a second submit during a slow response ends on one confirmation and creates once", async ({
    context,
  }) => {
    const unique = Date.now();
    const customerName = `Ada slow ${unique}`;
    const booking = await context.newPage();
    await authenticateOwner(context, "luma-studio");
    await fillBooking(
      booking,
      "luma-studio",
      customerName,
      `ada-slow-${unique}@example.test`,
      "2032-09-03T15:30",
    );

    let requestCount = 0;
    let releaseFirstResponse = () => {};
    const firstResponseGate = new Promise<void>((resolve) => {
      releaseFirstResponse = resolve;
    });
    let markFirstProcessed = () => {};
    const firstProcessed = new Promise<void>((resolve) => {
      markFirstProcessed = resolve;
    });
    await booking.route(
      "**/api/public/luma-studio/appointments",
      async (route) => {
        requestCount += 1;
        const currentRequest = requestCount;
        if (currentRequest === 1) {
          const response = await route.fetch();
          markFirstProcessed();
          await firstResponseGate;
          await route.fulfill({ response });
          return;
        }

        await firstResponseGate;
        const response = await route.fetch();
        await route.fulfill({ response });
      },
    );

    await booking.getByRole("button", { name: "Request appointment" }).click();
    await firstProcessed;
    await expect(
      booking.getByRole("button", { name: "Submitting request…" }),
    ).toBeDisabled();
    await booking
      .getByRole("form", { name: "Book an appointment" })
      .evaluate((form) => {
        form.dispatchEvent(
          new SubmitEvent("submit", { bubbles: true, cancelable: true }),
        );
      });
    await expect.poll(() => requestCount).toBe(2);
    releaseFirstResponse();

    const confirmation = booking.getByRole("status", {
      name: "Submission status",
    });
    await expect(confirmation).not.toContainText("being submitted");
    await expect(confirmation).toHaveCount(1);

    const dashboardResponse = await booking.request.get(
      `${appUrl}/api/dashboard/pending-appointments`,
    );
    expect(dashboardResponse.status()).toBe(200);
    const dashboardPayload = (await dashboardResponse.json()) as {
      appointments: { customerName: string }[];
    };
    expect(
      dashboardPayload.appointments.filter(
        (appointment) => appointment.customerName === customerName,
      ),
    ).toHaveLength(1);
  });

  test("keeps simultaneous identical requests in their originating businesses", async ({
    browser,
  }) => {
    const unique = Date.now();
    const customerName = `Shared customer ${unique}`;
    const customerContact = `shared-${unique}@example.test`;
    const preferredTime = "2032-09-04T13:15";
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      await Promise.all([
        authenticateOwner(contextA, "luma-studio"),
        authenticateOwner(contextB, "ember-studio"),
      ]);
      const [dashboardA, dashboardB] = await Promise.all([
        contextA.newPage(),
        contextB.newPage(),
      ]);
      const dashboardAReady = dashboardA.waitForResponse(
        (response) =>
          response.url().endsWith("/api/dashboard/pending-appointments") &&
          response.ok(),
      );
      const dashboardBReady = dashboardB.waitForResponse(
        (response) =>
          response.url().endsWith("/api/dashboard/pending-appointments") &&
          response.ok(),
      );
      await Promise.all([
        dashboardA.goto("/dashboard/appointments"),
        dashboardB.goto("/dashboard/appointments"),
      ]);
      await Promise.all([dashboardAReady, dashboardBReady]);

      const [responseA, responseB] = await Promise.all([
        contextA.request.post(`${appUrl}/api/public/luma-studio/appointments`, {
          data: {
            serviceId: "20000000-0000-4000-8000-000000000001",
            customerName,
            contactDetail: customerContact,
            preferredTime,
          },
          headers: { "idempotency-key": crypto.randomUUID() },
        }),
        contextB.request.post(
          `${appUrl}/api/public/ember-studio/appointments`,
          {
            data: {
              serviceId: "20000000-0000-4000-8000-000000000004",
              customerName,
              contactDetail: customerContact,
              preferredTime,
            },
            headers: { "idempotency-key": crypto.randomUUID() },
          },
        ),
      ]);
      expect(responseA.status()).toBe(201);
      expect(responseB.status()).toBe(201);
      const acceptedAt = Date.now();

      const matchingA = dashboardA
        .getByRole("listitem")
        .filter({ hasText: customerName });
      const matchingB = dashboardB
        .getByRole("listitem")
        .filter({ hasText: customerName });
      await expect(matchingA).toHaveCount(1, { timeout: 2_000 });
      await expect(matchingB).toHaveCount(1, { timeout: 2_000 });
      expect(Date.now() - acceptedAt).toBeLessThan(2_000);
      await expect(dashboardA.getByText("Luma Studio")).toBeVisible();
      await expect(dashboardB.getByText("Ember Studio")).toBeVisible();
    } finally {
      await Promise.all([contextA.close(), contextB.close()]);
    }
  });

  test("shows the safe failure message and creates nothing when tenant resolution fails", async ({
    context,
  }) => {
    const customerName = `Unmatched customer ${Date.now()}`;

    await authenticateOwner(context, "luma-studio");
    const dashboard = await context.newPage();
    await dashboard.goto("/dashboard/appointments");
    const booking = await context.newPage();
    await booking.route(
      "**/api/public/luma-studio/appointments",
      async (route) => {
        const response = await route.fetch({
          url: `${appUrl}/api/public/missing-business/appointments`,
        });
        await route.fulfill({ response });
      },
    );
    await fillBooking(
      booking,
      "luma-studio",
      customerName,
      "unmatched@example.test",
      "2032-09-05T09:45",
    );

    await booking.getByRole("button", { name: "Request appointment" }).click();
    await expect(
      booking.getByRole("status", { name: "Submission status" }),
    ).toHaveText("We couldn't send your request. Please try again.");
    await dashboard.waitForTimeout(1_000);
    await expect(dashboard.getByText(customerName)).toHaveCount(0);
  });
});
