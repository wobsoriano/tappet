import { expect, test } from "../src/index.ts";

test("a control the app never renders is reported absent", async ({ app }) => {
  await expect(app.getByText("Sign out")).not.toBeVisible();
  await expect(app.getByText("Sign out")).toHaveCount(0);
});
