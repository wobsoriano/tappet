import { expect, test } from "../src/index.ts";

test("explore tab and back", async ({ app }) => {
  await app.getByRole("button", { name: "Explore" }).tap();
  await expect(app.getByRole("text", { name: "Explore" })).toBeVisible();
  await expect(app.getByText("Expo documentation")).toBeVisible();

  await app.getByRole("button", { name: "Home" }).tap();
  await expect(app.getByRole("text", { name: "GET STARTED" })).toBeVisible();
});
