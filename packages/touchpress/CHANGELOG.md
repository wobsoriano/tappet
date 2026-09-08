# touchpress

## 0.1.2

### Patch Changes

- f555fa3: Confirm a fill into an Android password field, which is a plain `text-field` that reads back a mask.

## 0.1.1

### Patch Changes

- 2494598: Confirm a fill against normalized text, match global regexes on every sibling, paint a screenshot mask only where it overlaps the image, name unnamed baselines by their full title path, run a model turn's tool calls one at a time, drop undeclared tool input keys, and type-check without `ai` installed.

## 0.1.0

### Minor Changes

- cb7a838: Add `device.act` and `device.extract`, which drive the app and read the screen with a model set through the new `aiModel` option.

## 0.0.2

### Patch Changes

- 1e58d6e: Initial release
