# pwad-e2e

The app `playwright-agent-device` is tested against. An Expo SDK 57 project with expo-router, four screens, and a fake sign-in held in React state. Nothing here is a product. Every screen exists so a spec can name something on it.

## Routes

| route      | file              | what it shows                                                                                  |
| ---------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| `/`        | `app/index.tsx`   | Signed out, a Welcome heading and a Sign in button. Signed in, a greeting and a Profile button |
| `/login`   | `app/login.tsx`   | Email and password fields, a Sign in button, an error only after a rejected attempt            |
| `/profile` | `app/profile.tsx` | The signed-in name and email and a Sign out button. Redirects to `/login` when signed out      |

`src/auth.tsx` holds the whole auth model. The session is a union of `signed-out`, `signing-in`, and `signed-in`, so a screen switches on one value instead of reading a pile of booleans. State lives in React memory only, and that is the point. The library relaunches the app before every test, so each spec starts signed out with no cleanup code.

## Credentials

`rob@example.com` / `hunter2`. Anything else is rejected as `invalid-credentials`.

`signIn` waits `SIGN_IN_DELAY_MS`, 4000 milliseconds, before resolving either way. It stands in for a network round trip so the specs have to wait on a pending state rather than an instant one. While it is pending the Sign in button is disabled and a `signing-in` text reads "Signing in...".

## Test IDs and the roles they report

A React Native `testID` becomes the iOS accessibility identifier, which is what `getByTestId` matches. These are the roles the XCTest tree actually reports for each one.

| test ID         | role         | screen  |
| --------------- | ------------ | ------- |
| `home`          | `other`      | home    |
| `greeting`      | `text`       | home    |
| `sign-in-link`  | `button`     | home    |
| `profile-link`  | `button`     | home    |
| `login`         | `other`      | login   |
| `email`         | `text-field` | login   |
| `password`      | `text-field` | login   |
| `error`         | `text`       | login   |
| `signing-in`    | `text`       | login   |
| `sign-in`       | `button`     | login   |
| `profile`       | `other`      | profile |
| `profile-name`  | `text`       | profile |
| `profile-email` | `text`       | profile |
| `sign-out`      | `button`     | profile |

Two details the tree makes visible. A `Text` renders as a `text` node wrapped in another `text` node carrying the same string, and the library collapses that pair to the deepest one, so `getByRole('text', { name: 'Rob' })` finds one node rather than two. Matching is a case-insensitive substring by default, so `{ name: 'Rob' }` also matches `rob@example.com` on the profile screen and needs `exact: true` to separate them.

The password field is deliberately not `secureTextEntry`. iOS reads a secure field next to an email field as a real credential and covers the profile screen with a "Save Password?" system alert once sign-in succeeds, which no test can dismiss reliably.

## Building and running

The library must be built first, because this app imports it by package name and resolves its `dist`.

```sh
pnpm --filter playwright-agent-device build     # or: vp run -r build, from the repo root
```

Then, from this directory, build and install the app on a booted simulator and start Metro. The build takes several minutes the first time.

```sh
npx expo run:ios --device "iPhone 17 Pro Max" --no-bundler
npx expo start --port 8081
```

Leave Metro running. No other project's Metro may hold port 8081. A development build loads whichever bundle answers, so a stray server means the tests drive someone else's app.

Then run the suite.

```sh
pnpm test:e2e                                   # playwright test --project=ios
```

## The specs

`e2e/` holds them. They are `.mts` rather than `.ts` because `agent-device` is ESM only and this app is a CommonJS package, so a spec Node loads as CommonJS cannot resolve it.

- `home.spec.mts` reads the signed-out home through `getByRole`.
- `login.spec.mts` covers a rejected attempt, then a successful one through the pending state to the profile.
- `profile.spec.mts` signs in, signs out, and expects the signed-out home back.
- `relaunch.spec.mts` signs in in one test and expects the next test to start signed out, which is what per-test relaunch buys.
- `failing.spec.mts` fails on purpose so the failure message and the `screen.png` and `screen.txt` attachments can be read. It is excluded from the default run. Include it with `PWAD_INCLUDE_FAILING=1`.
