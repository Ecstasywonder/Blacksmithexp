import { expect, test } from "@playwright/test";

test.describe("public booking form", () => {
  test("is usable on a phone and visibly begins a complete submission", async ({
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

    await page.getByLabel("Your name").fill("Ada Okafor");
    await page.getByLabel("Email or phone number").fill("ada@example.test");
    await page.getByLabel("Preferred time").fill("10:30 AM");

    const submitButton = page.getByRole("button", {
      name: "Request appointment",
    });
    await submitButton.scrollIntoViewIfNeeded();
    await expect(serviceSummary).toBeInViewport();

    await submitButton.click();
    await expect(page.locator(".booking-error")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Submitting request…" }),
    ).toBeVisible({ timeout: 1_000 });
    await expect(
      page.getByRole("status", { name: "Submission status" }),
    ).toContainText("being submitted");
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
    await expect(page).toHaveURL(/\/luma-studio\/book$/);
    await expect(page.getByLabel("Signature silk press")).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Request appointment" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("status", { name: "Submission status" }),
    ).toContainText("No payment is taken now.");
  });

  test("rejects a malformed preferred time and submits after correction", async ({
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
    await expect(page).toHaveURL(/\/luma-studio\/book$/);
    await expect(
      page.getByRole("button", { name: "Request appointment" }),
    ).toBeEnabled();

    await preferredTime.fill("2:30 PM");
    await page.getByRole("button", { name: "Request appointment" }).click();
    await expect(
      page.getByRole("button", { name: "Submitting request…" }),
    ).toBeVisible({ timeout: 1_000 });
    await expect(page.locator(".booking-error")).toHaveCount(0);
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
