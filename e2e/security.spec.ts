import { expect, test, type Page } from "@playwright/test";
import { generateSync } from "otplib";

type LocalEmail = { kind?: string; subject: string; body: string; status: string };
async function ownCapturedLink(page: Page, path: string) {
  const response = await page.request.get("/api/auth/security/captured-email");
  expect(response.ok()).toBe(true);
  const mail = ((await response.json()) as LocalEmail[]).find((item) =>
    item.body.includes(`/${path}#token=`),
  );
  expect(mail, `Expected a locally queued ${path} email`).toBeTruthy();
  expect(mail!.status).not.toBe("SENT");
  const link = mail!.body.match(new RegExp(`http[^\\s]+/${path}#token=[\\w-]+`));
  expect(link).toBeTruthy();
  return link![0];
}
async function passwordLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in to your workspace" }).click();
}

test("customer verifies email, enrolls MFA, signs in with recovery codes and resets a password", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const email = `browser-security-${Date.now()}@example.test`;
  const password = "BrowserSecurityPass123!";
  const nextPassword = "ChangedBrowserSecurity123!";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/register");
  await page.getByRole("button", { name: "I’m a shopper" }).click();
  await page.getByLabel("Your name").fill("Security Browser Test");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/customer$/);

  const verificationLink = await ownCapturedLink(page, "verify-email");
  await page.goto(verificationLink);
  await expect(page).toHaveURL(/\/verify-email$/);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Email verified.");
  await page.goto("/account/security");
  await expect(page.getByText("Your email address is verified.")).toBeVisible();
  await page.getByLabel("Current password").fill(password);
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  await expect(page.getByRole("img", { name: "Authenticator setup QR code" })).toBeVisible();
  const secret = (await page.locator("code").innerText()).trim();
  await page.getByLabel("Authenticator code", { exact: true }).fill(generateSync({ secret }));
  await page.getByRole("button", { name: "Verify and activate" }).click();
  const codes = (await page.getByLabel("One-use recovery codes").innerText()).trim().split(/\s+/);
  expect(codes).toHaveLength(10);
  await page.getByRole("button", { name: /I saved my codes/ }).click();
  await passwordLogin(page, email, password);
  await expect(page.getByLabel("Authenticator or recovery code")).toBeVisible();
  expect((await (await page.request.get("/api/auth/session")).json()).user).toBeNull();
  await page.getByLabel("Authenticator or recovery code").fill(codes[0]!);
  await page.getByRole("button", { name: "Verify sign in" }).click();
  await expect(page).toHaveURL(/\/customer$/);

  await page.goto("/forgot-password");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send reset email" }).click();
  await expect(page.getByRole("status")).toContainText("If your account is eligible");
  const resetLink = await ownCapturedLink(page, "reset-password");
  await page.context().clearCookies();
  await page.goto(resetLink);
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.getByLabel("New password").fill(nextPassword);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("status")).toContainText("Password changed.");
  await passwordLogin(page, email, password);
  await expect(page.getByRole("alert")).toContainText("Email or password is incorrect.");
  await page.getByLabel("Password", { exact: true }).fill(nextPassword);
  await page.getByRole("button", { name: "Sign in to your workspace" }).click();
  await page.getByLabel("Authenticator or recovery code").fill(codes[0]!);
  await page.getByRole("button", { name: "Verify sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("Code is incorrect");
  await page.getByLabel("Authenticator or recovery code").fill(codes[1]!);
  await page.getByRole("button", { name: "Verify sign in" }).click();
  await expect(page).toHaveURL(/\/customer$/);
  await page.goto(resetLink);
  await page.getByLabel("New password").fill("UnusedPassword123!");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("alert")).toContainText("already been used");
  expect(errors).toEqual([]);
});
