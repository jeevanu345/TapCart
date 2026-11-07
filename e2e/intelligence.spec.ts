import { choose } from "./select.js";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function signIn(page: Page) {
  await page.goto("/store/login");
  await page.getByLabel("Email address").fill("store@tapcart.local");
  await page.getByLabel("Password", { exact: true }).fill("TapCartDemo123!");
  await page.getByRole("button", { name: "Sign in to your workspace" }).click();
  await expect(page).toHaveURL(/\/store\/overview$/);
}
test("intelligence forecasts, semantic search, multilingual evidence and invoice review", async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page);
  await page.getByRole("link", { name: "Intelligence lab", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Replenishment forecast" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /MAE/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "Edit policy" }).first().click();
  await page.getByLabel("Lead time override (days)").fill("4");
  await page.getByRole("button", { name: "Save replenishment policy" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Catalog search", exact: true }).click();
  await page.getByLabel("Catalog request").fill("coffee under ₹500");
  await page.getByRole("button", { name: "Search catalog", exact: true }).click();
  await expect(page.getByText(/Mode: semantic-local/)).toBeVisible();
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await choose(page, page.getByRole("combobox", { name: "Answer language" }), "हिन्दी");
  await page.getByRole("button", { name: "Ask store assistant" }).click();
  await expect(page.locator('[lang="hi"]')).toContainText("पुनर्भरण");
  await expect(page.getByRole("heading", { name: "Evidence", exact: true })).toBeVisible();
  const products = (await (await page.request.get("/api/products")).json()) as {
    id: string;
    sku: string;
    name: string;
  }[];
  const product = products[0];
  await page.getByRole("button", { name: "Invoice review", exact: true }).click();
  await page
    .getByLabel("Or paste invoice text")
    .fill(`Invoice # AI-E2E-${Date.now()}\n${product.sku}, 3, 90.00`);
  await page.getByRole("button", { name: "Extract for review" }).click();
  await expect(page.getByRole("heading", { name: "Review extracted lines" })).toBeVisible();
  await expect(page.getByLabel("Quantity for line 1")).toHaveValue("3");
  await page.getByLabel("Quantity for line 1").fill("2");
  await page.getByRole("button", { name: "Create reviewed receiving draft" }).click();
  await expect(page).toHaveURL(/\/store\/purchases\?draft=/);
  await expect(
    page.getByRole("button", { name: "Approve saved draft as purchase order" }),
  ).toBeVisible();
  await page.goto("/store/intelligence/lab?tab=alerts");
  await page.getByRole("button", { name: "Check store records" }).click();
  await expect(page.getByRole("button", { name: "Check store records" })).toBeEnabled();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((v) => v.impact === "critical" || v.impact === "serious"),
  ).toEqual([]);
  expect(errors).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/store/intelligence/lab?tab=search");
  await expect(page.getByRole("heading", { name: "Find products in your words" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("tag studio opens the encoder with an honest unsupported-device state", async ({ page }) => {
  await signIn(page);
  await page.goto("/store/tags");
  await page.getByRole("button", { name: "Encode & measure" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Web NFC/i).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("shoppers search an approved store catalog with a price limit", async ({ page }) => {
  await page.goto("/customer");
  const stores = (await (await page.request.get("/api/stores")).json()) as {
    id: string;
    status: string;
    name: string;
  }[];
  const store = stores.find((s) => s.status === "APPROVED");
  if (!store) throw Error("Seed requires an approved store.");
  await choose(page, page.getByRole("combobox", { name: "Browse store" }), store.name);
  await page.getByLabel("Search the catalog").fill("coffee under ₹500");
  await page.getByRole("button", { name: "Search by meaning" }).click();
  await expect(page.getByText("Search mode: semantic-local")).toBeVisible();
  await expect(page.getByRole("button", { name: /House Blend Coffee/ })).toBeVisible();
});
