import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("TapCartDemo123!");
  await page.getByRole("button", { name: "Sign in to your workspace" }).click();
  await expect(page).toHaveURL(
    email.startsWith("admin@")
      ? /\/admin$/
      : email.startsWith("store@")
        ? /\/store\/overview$/
        : /\/customer$/,
  );
}

test("store operations render live data, create stock, answer a question, and fit mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, "store@tapcart.local");
  await expect(page).toHaveURL(/store\/overview/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.screenshot({ path: "test-results/tapcart-overview-desktop.png", fullPage: true });
  await page.getByRole("link", { name: "Inventory", exact: true }).click();
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Product name").fill("E2E Ceramic Cup");
  await dialog.getByLabel("SKU", { exact: true }).fill("E2E-CUP");
  await dialog.getByLabel("Category", { exact: true }).fill("Home & living");
  await dialog.getByLabel("Price (₹)").fill("149.50");
  await dialog.getByLabel("Initial physical units").fill("2");
  await dialog.getByRole("button", { name: "Add product", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("E2E Ceramic Cup", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: /Intelligence/ }).click();
  await page
    .getByRole("textbox", { name: "Ask TapCart Intelligence" })
    .fill("Which products need restocking?");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.locator(".chat-entry.assistant").first()).toContainText(
    /available|reorder|observed/i,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Inventory", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "test-results/tapcart-inventory-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("shopper reserves an exact unit, checks out at desk, and staff settles it", async ({
  browser,
}) => {
  const shopper = await browser.newContext();
  const store = await browser.newContext();
  const page = await shopper.newPage();
  await signIn(page, "shopper@tapcart.local");
  await expect(page).toHaveURL(/customer/);
  const units = await page.request.get("/api/units");
  const rows: { id: string; status: string; name: string }[] = await units.json();
  const unit = rows.find((row) => row.status === "AVAILABLE");
  if (!unit) throw new Error("Seed must include an available physical unit.");
  await page.goto(`/u/${unit.id}`);
  await page.getByRole("button", { name: /Reserve this item/ }).click();
  await expect(page).toHaveURL(/customer/);
  await expect(page.getByText(unit.name, { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: /checkout|check out/i }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Place order" }).click();
  await expect(page.getByText("payment pending", { exact: true }).first()).toBeVisible();
  const orders = await page.request.get("/api/orders");
  const orderRows: { id: string; status: string }[] = await orders.json();
  const order = orderRows.find((row) => row.status === "PAYMENT_PENDING");
  if (!order) throw new Error("Checkout must persist an order before cash settlement.");
  const staff = await store.newPage();
  await signIn(staff, "store@tapcart.local");
  await staff.goto(`/store/orders?order=${order.id}`);
  await staff.getByRole("button", { name: "Confirm payment received" }).click();
  await expect(staff.getByRole("dialog").getByText("completed", { exact: true })).toBeVisible();
  await page.goto(`/receipt/${order.id}`);
  await expect(page.getByText(unit.name, { exact: true })).toBeVisible();
  await expect(page.getByText("completed", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: "test-results/tapcart-receipt.png", fullPage: true });
  await shopper.close();
  await store.close();
});

test("administrator can review pending store registration", async ({ page }) => {
  await signIn(page, "admin@tapcart.local");
  await expect(page).toHaveURL(/admin/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const approve = page.getByRole("button", { name: "Approve store", exact: true }).first();
  await expect(approve).toBeVisible();
  await approve.click();
  await expect(page.getByRole("status")).toContainText(/approved/);
});

test("customer registration and local accessibility checks", async ({ page }) => {
  await page.goto("/register");
  await page.getByRole("button", { name: "I’m a shopper" }).click();
  await page.getByLabel("Your name").fill("New Shopper");
  await page.getByLabel("Email address").fill("new-shopper@tapcart.local");
  await page.getByLabel("Password", { exact: true }).fill("ANewShopperPass123!");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/customer/);
  const shopper = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(shopper.violations).toEqual([]);
  await page.getByRole("button", { name: "Sign out" }).click();
  await signIn(page, "store@tapcart.local");
  const store = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(store.violations).toEqual([]);
});

test("landing page runs white to black and leads into registration", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Exactly once");
  const tones = await page.evaluate(() => ({
    top: getComputedStyle(document.querySelector(".lp")!).backgroundColor,
    bottom: getComputedStyle(document.querySelector(".lp-black")!).backgroundColor,
  }));
  expect(tones).toEqual({ top: "rgb(255, 255, 255)", bottom: "rgb(0, 0, 0)" });
  await page.locator("#protocol").scrollIntoViewIfNeeded();
  await expect(page.locator(".race-log p")).toContainText("1 row updated", { timeout: 5000 });
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(scan.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Start free" }).first().click();
  await expect(page).toHaveURL(/register/);
  expect(errors).toEqual([]);
});

test("workspace: palette, theme, reports, desk, labels and a teammate invitation", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, "store@tapcart.local");
  await expect(page.locator(".metric-strip")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").fill("reports");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/store\/reports/);
  await page.getByRole("button", { name: "7d" }).click();
  await expect(page.getByText("Last 7 days, net of returns")).toBeVisible();
  await page.getByRole("button", { name: "Switch to black theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".metric-strip")).toBeVisible();
  await page.waitForTimeout(800);
  const dark = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(dark.violations).toEqual([]);
  await page.getByRole("button", { name: "Switch to white theme" }).click();
  await page.getByRole("link", { name: "Desk", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Desk" })).toBeVisible();
  await page.getByRole("link", { name: "Tag studio" }).click();
  await page.getByRole("checkbox", { name: "Select all visible units" }).check();
  await page.getByRole("button", { name: "Print QR labels" }).click();
  await expect(page).toHaveURL(/labels/);
  await expect(page.getByRole("img", { name: /QR code for/ }).first()).toBeVisible();
  await page.goto("/store/settings?tab=team");
  await page.getByRole("button", { name: "Invite teammate" }).click();
  await page.getByRole("button", { name: "Create invitation link" }).click();
  const link = await page.getByLabel("Invitation link").inputValue();
  const teammate = await browser.newContext();
  const invited = await teammate.newPage();
  await invited.goto(link);
  await invited.getByLabel("Your name").fill("Riya Staff");
  await invited.getByLabel("Email address").fill("riya@tapcart.local");
  await invited.getByLabel("Password", { exact: true }).fill("ARiyaStaffPass123!");
  await invited.getByRole("button", { name: "Join store" }).click();
  await expect(invited).toHaveURL(/store\/overview/);
  await invited.goto("/store/settings?tab=store");
  await expect(invited.getByText("Only managers can change these.")).toBeVisible();
  await invited.goto(link);
  await expect(invited).toHaveURL(/store\/overview/);
  await teammate.close();
  expect(errors).toEqual([]);
  await context.close();
});
