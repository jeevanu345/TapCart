import { choose } from "./select.js";
import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("TapCartDemo123!");
  await page.getByRole("button", { name: "Sign in to your workspace" }).click();
  await expect(page).toHaveURL(email.startsWith("store@") ? /\/store\/overview$/ : /\/customer$/);
}

test("supplier draft approval and partial receipts create exact physical stock", async ({
  page,
}) => {
  const suffix = Date.now().toString(),
    supplierName = `E2E Supplier ${suffix}`,
    invoice = `E2E-INV-${suffix}`;
  await signIn(page, "store@tapcart.local");
  const products = (await (await page.request.get("/api/products")).json()) as {
    id: string;
    name: string;
    active: boolean;
    available: number;
  }[];
  const product = products.find((entry) => entry.active);
  if (!product) throw new Error("Seed requires a catalog product.");
  const before = product.available;
  await page.goto("/store/suppliers");
  await page.getByRole("button", { name: "Add supplier", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill(supplierName);
  await page.getByLabel("Email", { exact: true }).fill("purchasing@example.com");
  await page.getByLabel("Lead time in days").fill("4");
  await page.getByRole("button", { name: "Save supplier", exact: true }).click();
  await expect(page.getByRole("cell", { name: supplierName, exact: true })).toBeVisible();
  await page.goto("/store/purchases");
  await page.getByRole("button", { name: "New purchase draft" }).click();
  await choose(page, page.getByRole("combobox", { name: "Supplier", exact: true }), supplierName);
  await page.getByLabel("Invoice number").fill(invoice);
  const productPicker = page.getByRole("combobox", { name: "Product for line 1", exact: true });
  await productPicker.click();
  await page.getByRole("option").filter({ hasText: product.name }).click();
  await expect(productPicker).toBeFocused();
  await page.getByLabel("Quantity for line 1", { exact: true }).fill("3");
  await page.getByLabel("Unit cost for line 1", { exact: true }).fill("6400");
  await expect(page.getByLabel("Quantity for line 1", { exact: true })).toHaveValue("3");
  await page.getByRole("button", { name: "Save reviewed draft" }).click();
  await expect(
    page.getByRole("button", { name: "Approve saved draft as purchase order" }),
  ).toBeVisible();
  const unchanged = (await (await page.request.get("/api/products")).json()) as {
    id: string;
    available: number;
  }[];
  expect(unchanged.find((entry) => entry.id === product.id)?.available).toBe(before);
  await page.getByRole("button", { name: "Approve saved draft as purchase order" }).click();
  await expect(
    page.getByRole("heading", { name: `Receive ${invoice}`, exact: true }),
  ).toBeVisible();
  await page.getByLabel(`Receive ${product.name}`, { exact: true }).fill("1");
  await page.getByLabel("Receipt reference").fill(`${invoice}-FIRST`);
  await page.getByRole("button", { name: "Confirm received units" }).click();
  const poRow = page
    .locator("tr")
    .filter({ has: page.getByRole("cell", { name: invoice, exact: false }) })
    .last();
  await expect(poRow).toContainText("partial");
  await expect(page.getByLabel(`Receive ${product.name}`, { exact: true })).toHaveAttribute(
    "max",
    "2",
  );
  await page.getByLabel(`Receive ${product.name}`, { exact: true }).fill("2");
  await page.getByRole("button", { name: "Confirm received units" }).click();
  await expect(poRow).toContainText("received");
  const after = (await (await page.request.get("/api/products")).json()) as {
    id: string;
    available: number;
  }[];
  expect(after.find((entry) => entry.id === product.id)?.available).toBe(before + 3);
});

test("coupon quote and shopper checkout persist discounted unit amounts", async ({ browser }) => {
  const store = await browser.newContext(),
    shopper = await browser.newContext();
  const staff = await store.newPage(),
    page = await shopper.newPage(),
    code = `E2E-${Date.now()}`;
  try {
    await signIn(staff, "store@tapcart.local");
    await staff.goto("/store/coupons");
    await staff.getByRole("button", { name: "Create coupon", exact: true }).click();
    await staff.getByLabel("Code", { exact: true }).fill(code);
    await staff.getByLabel(/^Value/).fill("25");
    await staff.getByLabel("Maximum uses").fill("1");
    await staff.getByLabel("Uses per customer").fill("1");
    await staff.getByRole("button", { name: "Create coupon", exact: true }).last().click();
    await expect(staff.getByRole("cell", { name: code, exact: true })).toBeVisible();
    await signIn(page, "shopper@tapcart.local");
    const units = (await (await page.request.get("/api/units")).json()) as {
      id: string;
      status: string;
      priceCents: number;
    }[];
    const unit = units.find((entry) => entry.status === "AVAILABLE" && entry.priceCents > 0);
    if (!unit) throw new Error("Seed requires an available paid unit.");
    await page.goto(`/u/${unit.id}`);
    await page.getByRole("button", { name: /Reserve this item/ }).click();
    await expect(page).toHaveURL(/\/customer(?:#basket)?$/);
    await page.getByRole("button", { name: "Ready to checkout" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Coupon code").fill(code);
    await dialog.getByRole("button", { name: "Apply coupon" }).click();
    await expect(dialog.getByText(new RegExp(`${code}:`))).toBeVisible();
    await dialog.getByRole("button", { name: "Place order" }).click();
    await expect(page.getByText("payment pending", { exact: true }).first()).toBeVisible();
    const orders = (await (await page.request.get("/api/orders")).json()) as {
      couponCode: string | null;
      totalCents: number;
      subtotalCents: number;
      discountCents: number;
      items: { priceCents: number; discountCents: number }[];
    }[];
    const order = orders.find((entry) => entry.couponCode === code);
    expect(order).toBeTruthy();
    expect(order?.discountCents).toBe(Math.floor(unit.priceCents / 4));
    expect(order?.totalCents).toBe(unit.priceCents - Math.floor(unit.priceCents / 4));
    expect(order?.items.reduce((sum, item) => sum + item.priceCents, 0)).toBe(order?.totalCents);
  } finally {
    await store.close();
    await shopper.close();
  }
});

test("reconciliation displays server snapshots without claiming desk payment", async ({ page }) => {
  await signIn(page, "store@tapcart.local");
  await page.goto("/store/reconciliation");
  await expect(
    page.getByRole("heading", { name: "Payment reconciliation", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Amounts consistent", exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh records" }).click();
  await expect(page.getByRole("heading", { name: "Payment and refund checks" })).toBeVisible();
  const records = (await (await page.request.get("/api/reconciliation")).json()) as {
    totalCents: number;
    itemTotalCents: number;
  }[];
  expect(records.length).toBeGreaterThan(0);
  expect(records.every((r) => r.totalCents === r.itemTotalCents)).toBe(true);
});
