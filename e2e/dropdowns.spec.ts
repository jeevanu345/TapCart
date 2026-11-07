import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("store@tapcart.local");
  await page.getByLabel("Password", { exact: true }).fill("TapCartDemo123!");
  await page.getByRole("button", { name: "Sign in to your workspace" }).click();
  await expect(page).toHaveURL(/\/store\/overview$/);
}
test("app dropdowns support keyboard, focus, touch layout and native form validation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page);
  await page.goto("/store/inventory");
  const category = page.getByRole("combobox", { name: "Filter category" });
  await category.focus();
  await page.keyboard.press("ArrowDown");
  const list = page.getByRole("listbox");
  await expect(list).toBeVisible();
  await expect(page.locator("#root")).toHaveAttribute("inert", "");
  await expect(page.getByRole("option", { name: "All categories", exact: true })).toBeFocused();
  const options = await page.getByRole("option").allTextContents();
  await page.keyboard.press("End");
  await expect(page.getByRole("option").last()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(category).toHaveText(options[options.length - 1]);
  await expect(category).toBeFocused();
  await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
  await category.click();
  await page.keyboard.press("Home");
  await expect(page.getByRole("option").first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(category).toHaveText("All categories");
  await category.click();
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(category).toBeFocused();
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("combobox", { name: "Category", exact: true });
  await input.fill("Bak");
  await expect(page.getByRole("listbox", { name: "Category suggestions" })).toBeVisible();
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(input).toHaveValue("Bakery");
  await input.fill("A brand new category");
  await expect(input).toHaveValue("A brand new category");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.goto("/store/purchases");
  await page.getByRole("button", { name: "New purchase draft" }).click();
  await page.getByRole("button", { name: "Save reviewed draft" }).click();
  await expect(
    page.getByRole("combobox", { name: "Product for line 1", exact: true }),
  ).toBeFocused();
  await expect(page.getByText("Choose an option.")).toBeVisible();
  await page.goto("/store/settings?tab=team");
  await page.getByRole("button", { name: "Invite teammate" }).click();
  const role = page.getByRole("combobox", { name: "Role", exact: true });
  await expect(role).toBeFocused();
  await role.click();
  await page
    .getByRole("option", { name: "Manager: also manage team and settings", exact: true })
    .click();
  await expect(role).toHaveText("Manager: also manage team and settings");
  await expect(role).toBeFocused();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/customer");
  const stores = page.getByRole("combobox", { name: "Browse store" });
  await stores.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  const bounds = await page.getByRole("listbox").boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(a11y.violations).toEqual([]);
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});
