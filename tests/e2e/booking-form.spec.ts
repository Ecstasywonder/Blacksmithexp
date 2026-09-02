import { expect, test } from "@playwright/test";

test.describe("public booking form", () => {
  test("is usable on a phone and submits a complete request", async ({
    page,
  }) => {
    const unique = Date.now();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/luma-studio/book");

    await expect(
      page.getByRole("heading", { level: 1, name: "Request an appointment" }),
    ).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(3);
    await expect(page.getByLabel("Your name")).toBeVisible();
    await expect(page.getByLabel("Email or phone number")).toBeVisible();
    await expect(page.getByLabel("Preferred time")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Request appointment" }),
    ).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);

    await page.getByLabel("Signature silk press").check();
    const serviceSummary = page.getByRole("status", { name: "Your service" });
    await expect(serviceSummary).toContainText("Signature silk press");

    await page.getByLabel("Your name").fill(`Ada Okafor ${unique}`);
    await page
      .getByLabel("Email or phone number")
      .fill(`ada-${unique}@example.test`);
    await page.getByLabel("Preferred time").fill("2033-09-03T10:30");

    const submitButton = page.getByRole("button", {
      name: "Request appointment",
    });
    await submitButton.scrollIntoViewIfNeeded();
    await expect(serviceSummary).toBeInViewport();

    await submitButton.click();
    await expect(page.locator(".booking-error")).toHaveCount(0);
    await expect(
      page.getByRole("status", { name: "Submission status" }),
    ).toContainText("request was sent");
  });

  test("blocks an accidental double submit and reports a later duplicate exactly", async ({
    page,
  }) => {
    const requestKeys: string[] = [];
    let requestCount = 0;
    let markFirstRequestStarted = () => {};
    const firstRequestStarted = new Promise<void>((resolve) => {
      markFirstRequestStarted = resolve;
    });
    let releaseFirstResponse = () => {};
    const firstResponseGate = new Promise<void>((resolve) => {
      releaseFirstResponse = resolve;
    });

    await page.route(
      "**/api/public/luma-studio/appointments",
      async (route) => {
        requestCount += 1;
        requestKeys.push(route.request().headers()["idempotency-key"] ?? "");
        if (requestCount === 1) {
          markFirstRequestStarted();
          await firstResponseGate;
        }
        await route.fulfill({
          body: JSON.stringify({
            appointment: { id: "synthetic-appointment", status: "pending" },
            outcome: requestCount === 1 ? "created" : "duplicate",
          }),
          contentType: "application/json",
          status: requestCount === 1 ? 201 : 200,
        });
      },
    );

    await page.goto("/luma-studio/book");
    await page.getByLabel("Signature silk press").check();
    await page.getByLabel("Your name").fill("Ada Double Submit");
    await page
      .getByLabel("Email or phone number")
      .fill("ada-double-submit@example.test");
    await page.getByLabel("Preferred time").fill("2033-09-05T10:30");

    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();
    await firstRequestStarted;
    await expect(submitButton).toBeDisabled();
    await expect(submitButton).toHaveText("Submitting request…");
    await submitButton.evaluate((button) => button.click());
    await expect.poll(() => requestCount).toBe(1);

    releaseFirstResponse();
    const status = page.getByRole("status", { name: "Submission status" });
    await expect(status).toHaveText("Your appointment request was sent.");
    await submitButton.click();
    await expect(status).toHaveText(
      "We already received this booking request — no need to send it again.",
    );
    expect(requestCount).toBe(2);
    expect(new Set(requestKeys).size).toBe(1);
    await expect(status).toHaveCount(1);
  });

  test("shows all missing-field errors within one second and focuses the first invalid field", async ({
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
    await expect(
      page.getByRole("textbox", { name: "Your name", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", {
        name: "Email or phone number",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Preferred time", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/luma-studio\/book$/);
    await expect(page.getByLabel("Signature silk press")).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Request appointment" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("status", { name: "Submission status" }),
    ).toContainText("No payment is taken now.");
  });

  test("rejects a malformed preferred date-time and submits after correction", async ({
    page,
  }) => {
    const unique = Date.now();
    await page.goto("/luma-studio/book");

    await page.getByLabel("Wash and treatment").check();
    await page.getByLabel("Your name").fill(`Chidi Nwosu ${unique}`);
    await page
      .getByLabel("Email or phone number")
      .fill(`chidi-${unique}@example.test`);
    const preferredTime = page.getByLabel("Preferred time");
    await preferredTime.evaluate((element) => {
      const input = element as HTMLInputElement;
      input.type = "text";
      input.value = "2033-02-30T10:30";
    });
    await page.getByRole("button", { name: "Request appointment" }).click();

    await expect(
      page.getByText("Choose a valid preferred date and time", { exact: true }),
    ).toBeVisible({ timeout: 1_000 });
    await expect(preferredTime).toBeFocused();
    await expect(page).toHaveURL(/\/luma-studio\/book$/);
    await expect(
      page.getByRole("button", { name: "Request appointment" }),
    ).toBeEnabled();

    await preferredTime.evaluate((element) => {
      (element as HTMLInputElement).type = "datetime-local";
    });
    await preferredTime.fill("2033-09-04T14:00");
    await page.getByRole("button", { name: "Request appointment" }).click();
    await expect(page.locator(".booking-error")).toHaveCount(0);
    await expect(
      page.getByRole("status", { name: "Submission status" }),
    ).toContainText("request was sent");
  });

  test("shows a clear message when the business has no published services", async ({
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
    await expect(
      page.getByRole("button", { name: "Request appointment" }),
    ).toHaveCount(0);
  });
});
