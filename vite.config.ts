import { defineConfig } from 'vite-plus';

export default defineConfig({
  staged: {
    '*': 'vp check --fix',
  },
  fmt: { singleQuote: true, semi: true },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  run: {
    cache: true,
  },
  test: {
    // Playwright specs live in e2e/ and are run by `playwright test`, not vitest.
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
  },
});
