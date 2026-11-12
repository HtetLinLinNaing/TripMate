import { test, expect, type Page } from "@playwright/test";
async function fill(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
}
test("TC16 TC20 complete all three workflows across browser presentation, Next API and real PostgreSQL (Auth/realtime substituted)", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create a trip", exact: false })
    .click();
  await fill(page, "Your display name", "May");
  await fill(page, "Trip name", "Mom Jam");
  await fill(page, "Start date", "2026-07-11");
  await fill(page, "End date", "2026-07-14");
  await page.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByRole("heading", { name: "Mom Jam" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start trip" })).toBeDisabled();
  await page.getByRole("button", { name: "Share" }).click();
  const invite = await page.evaluate(() => navigator.clipboard.readText());
  const other = await page
    .context()
    .browser()!
    .newContext({ viewport: { width: 390, height: 844 } });
  const guest = await other.newPage();
  await guest.goto(invite);
  await expect(
    guest.getByText("No account. Add your display name and you’re in."),
  ).toBeVisible();
  await fill(guest, "Your display name", "Niran");
  await guest.getByRole("button", { name: "Join Mom Jam" }).click();
  await expect(guest.getByRole("heading", { name: "Mom Jam" })).toBeVisible();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByLabel("Choose cash holder").selectOption({ label: "Niran" });
  await expect(page.getByRole("button", { name: "Start trip" })).toBeEnabled();
  await page.getByRole("button", { name: "Start trip" }).click();
  await page.getByRole("button", { name: "Add funds", exact: false }).click();
  await fill(page, "Amount (THB)", "2000");
  await page.getByRole("button", { name: "Save contribution" }).click();
  await expect(
    page.getByText("฿2,000.00", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add expense", exact: false }).click();
  await fill(page, "What was it?", "Transport");
  await page.getByLabel("Shared pool", { exact: true }).check();
  await fill(page, "Total (THB)", "761");
  await expect(
    page.getByRole("region", { name: "Split preview" }),
  ).toContainText("฿380.50");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(page.getByText("฿1,239.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Transport/ }).click();
  await expect(page.getByText("Paid by", { exact: true })).toBeVisible();
  await expect(page.getByText("Shared pool", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Add expense", exact: false }).click();
  await fill(page, "What was it?", "Coffee");
  await fill(page, "Total (THB)", "121");
  await page.getByRole("radio", { name: /Selected people/ }).check();
  await page.getByRole("checkbox", { name: "May" }).check();
  await expect(
    page.getByRole("region", { name: "Split preview" }),
  ).toContainText("฿121.00");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await page.getByRole("button", { name: "Add expense", exact: false }).click();
  await fill(page, "What was it?", "Mixed outing");
  await fill(page, "Total (THB)", "144");
  await page.getByRole("radio", { name: /Mixed expense/ }).check();
  await fill(page, "Part 1 name", "Coffee");
  await fill(page, "Part 1 amount (THB)", "69");
  await page
    .locator(".part")
    .first()
    .getByRole("checkbox", { name: "May" })
    .check();
  await page.getByRole("button", { name: "+ Add part", exact: true }).click();
  await fill(page, "Part 2 name", "Driver");
  await fill(page, "Part 2 amount (THB)", "75");
  await page
    .locator(".part")
    .nth(1)
    .getByRole("checkbox", { name: "May" })
    .check();
  await page
    .locator(".part")
    .nth(1)
    .getByRole("checkbox", { name: "Niran" })
    .check();
  await expect(
    page.getByRole("region", { name: "Split preview" }),
  ).toContainText("Total per person");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await page.getByRole("button", { name: "View your personal bill" }).click();
  await expect(
    page.getByText("Paid personally", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your bill" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/tripmate-bill-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Review shared ledger" }).click();
  await page.getByRole("button", { name: "Add expense", exact: false }).click();
  await fill(page, "What was it?", "Overdraw");
  await fill(page, "Total (THB)", "2000");
  await page.getByLabel("Shared pool", { exact: true }).check();
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("฿761.00 below zero");
  await page.getByRole("button", { name: "Save anyway" }).click();
  await expect(page.getByText("-฿761.00", { exact: true })).toBeVisible();
  await guest.goto(invite);
  await expect(guest.getByRole("heading", { name: "Mom Jam" })).toBeVisible();
  await expect(guest.getByRole("button", { name: "Join Mom Jam" })).toHaveCount(
    0,
  );
  await other.close();
});
test("TC15 exposes no payment/settlement controls; invalid invitation explains recovery", async ({
  page,
}) => {
  await page.goto("/?invite=invalid");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "This invitation is no longer valid. Ask the organiser for a new link.",
  );
  await expect(
    page.getByRole("button", { name: /pay now|settle now|transfer/i }),
  ).toHaveCount(0);
});
