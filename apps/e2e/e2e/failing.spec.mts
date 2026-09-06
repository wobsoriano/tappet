import { expect, test } from "playwright-agent-device";

test("a locator that never resolves reports the screen it looked at", async ({ app }) => {
  await expect(app.getByText("Sign out")).toBeVisible({ timeout: 3000 });
});
