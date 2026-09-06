import { expect, test } from "../src/index.ts";

test("the home screen shows its title and its call to action", async ({ app }) => {
  await expect(app.getByText("Live from the cloud")).toBeVisible();
  await expect(app.getByRole("text", { name: "GET STARTED" })).toHaveText("GET STARTED", {
    exact: true,
  });
  await expect(app.getByRole("button", { name: "Home" })).toBeSelected();
});
