import { expect, test } from "playwright-agent-device";

test("signing out from the profile returns to the signed-out home", async ({ app }) => {
  await app.getByTestId("sign-in-link").tap();
  await app.getByRole("text-field", { name: "Email" }).fill("rob@example.com");
  await app.getByRole("text-field", { name: "Password" }).fill("hunter2");
  await app.getByRole("button", { name: "Sign in" }).tap();
  await expect(app.getByTestId("profile-email")).toBeVisible();

  await app.getByRole("button", { name: "Sign out" }).tap();

  await expect(app.getByRole("text", { name: "Welcome" })).toBeVisible();
  await expect(app.getByTestId("greeting")).not.toBeVisible();
});
