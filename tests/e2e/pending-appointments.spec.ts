import { expect, test, type BrowserContext, type Page } from "@playwright/test";

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
    await dashboard.goto("/dashboard/appointments");
    await expect(
      dashboard.getByRole("heading", { name: "Pending appointments" }),
    ).toBeVisible();

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

    const idempotencyKey = firstRequest.headers()["idempotency-key"];
    expect(idempotencyKey).toBeTruthy();
    const replayResponse = await booking.request.post(firstRequest.url(), {
      data: firstRequest.postDataJSON(),
      headers: { "idempotency-key": idempotencyKey! },
    });
    expect(replayResponse.status()).toBe(201);
    expect(await replayResponse.json()).toEqual(await firstResponse.json());

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
      const [dashboardA, dashboardB, bookingA, bookingB] = await Promise.all([
        contextA.newPage(),
        contextB.newPage(),
        contextA.newPage(),
        contextB.newPage(),
      ]);
      await Promise.all([
        dashboardA.goto("/dashboard/appointments"),
        dashboardB.goto("/dashboard/appointments"),
        fillBooking(
          bookingA,
          "luma-studio",
          customerName,
          customerContact,
          preferredTime,
        ),
        fillBooking(
          bookingB,
          "ember-studio",
          customerName,
          customerContact,
          preferredTime,
        ),
      ]);

      await Promise.all([
        bookingA.getByRole("button", { name: "Request appointment" }).click(),
        bookingB.getByRole("button", { name: "Request appointment" }).click(),
      ]);
      await Promise.all([
        expect(
          bookingA.getByRole("status", { name: "Submission status" }),
        ).toContainText("request was sent"),
        expect(
          bookingB.getByRole("status", { name: "Submission status" }),
        ).toContainText("request was sent"),
      ]);

      const matchingA = dashboardA
        .getByRole("listitem")
        .filter({ hasText: customerName });
      const matchingB = dashboardB
        .getByRole("listitem")
        .filter({ hasText: customerName });
      await expect(matchingA).toHaveCount(1, { timeout: 2_000 });
      await expect(matchingB).toHaveCount(1, { timeout: 2_000 });
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
