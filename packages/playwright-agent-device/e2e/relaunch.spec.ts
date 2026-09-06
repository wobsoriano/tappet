import { expect, test } from "../src/index.ts";

test("navigates away and leaves the app on another tab", async ({ app }) => {
  await app.getByRole("button", { name: "Explore" }).tap();
  await expect(app.getByRole("text", { name: "Explore" })).toBeVisible();
});

test("the next test starts on the home screen anyway", async ({ app }) => {
  await expect(app.getByRole("text", { name: "GET STARTED" })).toBeVisible();
  await expect(app.getByRole("button", { name: "Home" })).toBeSelected();
});
