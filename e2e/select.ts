import { expect, type Page, type Locator } from "@playwright/test";
/** Pick an app-styled option via the same keyboard/listbox surface a user sees. */
export async function choose(page: Page, trigger: Locator, option: string) {
  await trigger.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(trigger).toBeFocused();
}
