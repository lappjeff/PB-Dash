import { expect, test, type Page } from "@playwright/test";

async function viewAs(page: Page, label: RegExp) {
  await page.goto("/dashboard");
  const select = page.getByLabel("Viewing as");
  const value = await select.locator("option", { hasText: label }).first().getAttribute("value");
  await select.selectOption(value!);
  await page.waitForURL(/\/(dashboard|my-dashboard)/);
}

test("admin overview shows demo banner, KPIs and drills into records", async ({ page }) => {
  await viewAs(page, /Demo Admin/);
  await expect(page.getByText(/DEMO DATA/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Company overview" })).toBeVisible();
  for (const k of ["Open pipeline", "Won Sales", "Win rate", "Needs attention"]) await expect(page.getByText(k, { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: /Active opportunities/ }).click();
  await expect(page).toHaveURL(/\/opportunities\?status=open/);
  await expect(page.getByRole("heading", { name: "Opportunities" })).toBeVisible();
});

test("filters persist in the URL and narrow the table", async ({ page }) => {
  await viewAs(page, /Demo Admin/);
  await page.goto("/opportunities?status=won");
  const before = await page.getByText(/–[\d,]+ of [\d,]+$/).textContent();
  await page.getByLabel("Search opportunities").fill("Roofing");
  await expect(page).toHaveURL(/q=Roofing/);
  await expect(page.getByText(/–[\d,]+ of [\d,]+$/)).not.toHaveText(before!);
  await page.locator("tbody a").first().click();
  await expect(page.getByRole("heading", { name: "Stage history" })).toBeVisible();
  await expect(page.getByText("Last synced from PB")).toBeVisible();
});

test("salesperson sees only their workspace", async ({ page }) => {
  await viewAs(page, /Avery Collins/);
  await page.goto("/my-dashboard");
  await expect(page.getByRole("heading", { name: /Hi, Avery/ })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Overview" })).toHaveCount(0);
  await page.goto("/settings");
  await expect(page.getByText("Not available")).toBeVisible();
  const res = await page.request.get("/api/analytics");
  expect(res.status()).toBe(403);
  await page.goto("/opportunities");
  await expect(page.getByRole("columnheader", { name: /Salesperson/ })).toHaveCount(0);
});

test("simulated webhook is processed and shows in sync status", async ({ page }) => {
  await viewAs(page, /Demo Admin/);
  await page.goto("/settings");
  const processed = page.getByText("processed webhooks").locator("..").locator("div").first();
  const before = Number(await processed.textContent());
  await page.getByRole("button", { name: /Simulate 5/ }).click();
  await expect(page.getByRole("status").filter({ hasText: /Delivered/ })).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => Number(await processed.textContent())).toBeGreaterThan(before);
});
