/**
 * What a test file imports.
 *
 * `defineConfig` is not re-exported. A config imports it from
 * `@playwright/test` and parameterizes it with `DeviceTestOptions`, which
 * keeps this package from wrapping something it adds nothing to.
 */

export { test } from "./playwright/fixtures.ts";
export type {
  DeviceTestFixtures,
  DeviceTestOptions,
  DeviceWorkerFixtures,
} from "./playwright/fixtures.ts";

export { expect } from "./playwright/expect.ts";
export type { MatcherOptions, TextMatcherOptions } from "./playwright/expect.ts";

export { DeviceTestError } from "./core/errors.ts";
export type { ErrorInfo } from "./core/errors.ts";

export type { ActionOptions, App, Locator, RoleOptions, TextOptions } from "./core/app.ts";
export type { DeviceOptions, ReadyQuery } from "./core/config.ts";
export type { Query, Role } from "./core/query.ts";
export type { Platform, Rect, Screen, ScreenNode } from "./core/screen.ts";
