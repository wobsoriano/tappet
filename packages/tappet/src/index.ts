/**
 * `defineConfig` is not re-exported. A config imports it from `@playwright/test`
 * and parameterizes it with `TappetOptions`, which keeps this package from
 * wrapping something it adds nothing to.
 */

export { setupTest, test } from './playwright/fixtures.ts';

export { expect } from './playwright/expect.ts';
export type { ScreenshotOptions } from './playwright/screenshot.ts';

export { TappetError } from './core/errors.ts';
export type { ErrorInfo, ExpectedValue } from './core/errors.ts';

export { preflight } from './preflight.ts';
export type { PreflightDevice, PreflightReport } from './preflight.ts';

export type { ReadyQuery, TappetOptions } from './core/config.ts';
export type { Device, FilterOptions, Locator } from './core/device.ts';
export type { Filter, Query, Role, TextMatch } from './core/query.ts';
export type { Platform, Rect, Screen, ScreenNode } from './core/screen.ts';
