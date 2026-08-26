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
    await page.getByLabel("Preferred time").fill("2026-09-03T10:30");

    const submitButton = page.getByRole("button", {
      name: "Request appointment",
    });
    await submitButton.scrollIntoViewIfNeeded();
    await expect(serviceSummary).toBeInViewport();

    await submitButton.click();
    await expect(
      page.getByRole("button", { name: "Submitting request…" }),
    ).toBeVisible({ timeout: 1_000 });
    await expect(
      page.getByRole("status", { name: "Submission status" }),
    ).toContainText("being submitted");
  });

  test("an incomplete submit preserves entered details and allows correction", async ({
    page,
  }) => {
    await page.goto("/luma-studio/book");
    const nameInput = page.getByLabel("Your name");

    await nameInput.fill("Chidi Nwosu");
    await page.getByRole("button", { name: "Request appointment" }).click();

    await expect(page).toHaveURL(/\/luma-studio\/book$/);
    await expect(nameInput).toHaveValue("Chidi Nwosu");
    await expect(
      page.getByRole("button", { name: "Request appointment" }),
    ).toBeEnabled();

    await page.getByLabel("Wash and treatment").check();
    await page.getByLabel("Email or phone number").fill("+234 801 234 5678");
    await page.getByLabel("Preferred time").fill("2026-09-04T14:00");
    await page.getByRole("button", { name: "Request appointment" }).click();
    await expect(
      page.getByRole("button", { name: "Submitting request…" }),
    ).toBeVisible();
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
