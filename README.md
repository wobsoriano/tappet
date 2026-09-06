# tappet workspace

A Vite Plus pnpm workspace holding one library and the app it is proven against.

```
packages/tappet/   the library, published to npm
apps/e2e/          tappet-e2e, an Expo SDK 57 app, private
```

The library runs native mobile end-to-end tests with `@playwright/test` as the runner and Callstack `agent-device` as the driver. Read [its README](packages/tappet/README.md) for the API, the options, and the device prerequisites. Read [the app's README](apps/e2e/README.md) for what it puts on screen and how to build it.

## Commands

Run these from the repository root.

```sh
vp check          # format, lint, and type check every package
vp test           # the library's unit tests, one aggregated vitest run
vp run -r build   # build every package in dependency order
```

The end-to-end suite is a separate command because it needs a booted simulator, the app installed on it, and Metro running. Build the library first so the app resolves its `dist`.

```sh
vp run -r build
vp run -F tappet-e2e test:e2e
```

## Prerequisites

Node 22.12 or newer and pnpm. The workspace pins its own pnpm through `devEngines`, so `pnpm install` at the root is enough to get going.

Everything the end-to-end suite needs beyond that is device setup, and the library README's Prerequisites section is the list.
