/**
 * What a test file imports.
 *
 * `defineConfig` is not re-exported. A config imports it from
 * `@playwright/test` and parameterizes it with `TappetOptions`, which keeps
 * this package from wrapping something it adds nothing to.
 */

export { setupTest, test } from './playwright/fixtures.ts';

export { expect } from './playwright/expect.ts';

export { TappetError } from './core/errors.ts';
export type { ErrorInfo } from './core/errors.ts';

export { preflight } from './preflight.ts';
export type { PreflightDevice, PreflightReport } from './preflight.ts';

export type { ReadyQuery, TappetOptions } from './core/config.ts';
export type { Device, Locator } from './core/device.ts';
export type { Query, Role, TextMatch } from './core/query.ts';
export type { Platform, Rect, Screen, ScreenNode } from './core/screen.ts';
