# Continuous integration

Two workflows live in `.github/workflows`. One is fast and runs on every push. The other boots devices and runs the real suite.

## `ci.yml`

Runs on pushes to `main` and on every pull request, on `ubuntu-latest`. It checks out the repository, sets up Vite Plus with its cache, and runs the three commands you run locally.

```sh
vp check          # format, lint, and type check every package
vp test           # the library's unit tests
vp run -r build   # build every package in dependency order
```

Nothing here touches a device, so it finishes in about a minute and it is what gates a pull request.

## `e2e.yml`

Two jobs, one per platform, with a 60 minute cap and a concurrency group on the branch so a new push cancels the run it replaced.

The iOS job runs on `macos-26`. In order, it builds the library, boots an iPhone simulator through `futureware-tech/simulator-action` with `erase_before_boot` so every run starts from a clean device, builds `apps/e2e` in Release for the simulator, installs the app with `xcrun simctl install`, prepares the `agent-device` iOS runner, and runs the suite with `--project=ios`.

The Android job runs on `ubuntu-latest` and uses `reactivecircus/android-emulator-runner` for an API 34 `google_apis` x86_64 emulator with animations disabled. It builds and installs a Release APK and runs `--project=android`.

### A Release build and no Metro

Both jobs build in Release, which bundles the JavaScript into the app. A development build would need a Metro server alive for the whole run, and a bundler that dies mid-suite looks like a launch timeout rather than an infrastructure failure. Release removes that whole failure mode from CI.

### Naming the device

`TAPPET_ANDROID_DEVICE` has to match what `agent-device devices` prints, and for an emulator that is the AVD name with its underscores shown as spaces. An AVD created as `ci_api34` is `ci api34` there, so a config that names it `ci-api34` finds nothing and preflight fails with the booted names listed. The workflow sidesteps the trap by creating its AVD as `ci-api34`, with hyphens, and passing that same string through, so the two agree without a translation step.

The same applies locally. The checked-in default is `Expo API 36`, which is the AVD `Expo_API_36`.

### The runner cache

`agent-device` builds a small XCTest runner the first time it drives an iOS device, and that build costs several minutes. The workflow caches `~/.agent-device/apple-runner/derived` keyed on the `agent-device` version and the Xcode version, then runs `agent-device prepare ios-runner` explicitly so the build happens in a step you can read rather than inside the first test.

The Android emulator's AVD is cached the same way, keyed by API level.

### Artifacts

Both jobs upload `apps/e2e/playwright-report` when they fail, with seven day retention. That report carries the `screen.png` and `screen.txt` attachments for every failed test, which is the whole reason to look at a failed device run.

## Running the suite from a script

The e2e script takes the project flag from the caller, so one script serves both jobs. Run it through pnpm, not `vp run`.

```sh
pnpm --filter tappet-e2e test:e2e --project=ios
pnpm --filter tappet-e2e test:e2e --project=android
```

`vp run` tracks every process a task starts through an IPC socket it passes in the environment. `agent-device` starts its daemon with that environment when no daemon is running, the daemon lives on after the suite, and `vp run` keeps waiting for it. The run prints its results and then hangs. pnpm passes no such environment, so the daemon starts clean and the command exits when Playwright does. The root `pnpm test:e2e` script is this pnpm command without a project flag, so it runs every project. The workflows call `apps/e2e/node_modules/.bin/playwright` and `packages/tappet/node_modules/.bin/agent-device` directly instead, because `setup-vp` puts `vp` on the PATH but not `pnpm`.

## What is not covered

These workflows have not been run on GitHub. They are written against the documented behaviour of the actions they pin and validated locally with `actionlint`, which checks syntax, expressions, and shell, but not whether a simulator actually boots on a hosted runner.
