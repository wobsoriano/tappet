import { expect, test } from 'vite-plus/test';
import { parseDeviceOptions, type TouchpressOptions } from '../src/core/config.ts';
import { createDevice } from '../src/core/device.ts';
import { TouchpressError } from '../src/core/errors.ts';
import { silentSink } from '../src/core/report.ts';
import {
  parseScreen,
  touchTargetFor,
  type RawSnapshot,
  type ScreenNode,
} from '../src/core/screen.ts';
import { openSession } from '../src/core/session.ts';
import { createFakeDriver, createRecordingSink, type FakeDriver } from './fake-driver.ts';

/**
 * The Android shape from Clerk's suite. The labelled node and the pressable are
 * siblings, and the button's rect encloses the label's. No captured fixture
 * carries it, so it is written out here.
 */
const SIBLINGS: RawSnapshot = {
  refsGeneration: 900,
  appBundleId: 'com.clerk.example',
  nodes: [
    { ref: '@e1', index: 1, type: 'android.view.ViewGroup', depth: 0 },
    {
      ref: '@e44',
      index: 44,
      type: 'android.widget.TextView',
      label: 'Back',
      depth: 1,
      parentIndex: 1,
      rect: { x: 24, y: 60, width: 48, height: 20 },
    },
    {
      ref: '@e45',
      index: 45,
      type: 'android.widget.Button',
      depth: 1,
      parentIndex: 1,
      rect: { x: 16, y: 52, width: 64, height: 40 },
    },
    {
      ref: '@e46',
      index: 46,
      type: 'android.widget.TextView',
      label: 'Ready',
      depth: 1,
      parentIndex: 1,
      rect: { x: 16, y: 200, width: 200, height: 24 },
    },
  ],
};

/** The iOS shape, where the pressable sits inside the labelled container. */
const NESTED: RawSnapshot = {
  refsGeneration: 900,
  nodes: [
    { ref: '@e1', index: 1, type: 'Other', depth: 0 },
    {
      ref: '@e10',
      index: 10,
      type: 'Other',
      label: 'Back',
      depth: 1,
      parentIndex: 1,
      rect: { x: 0, y: 40, width: 300, height: 60 },
    },
    {
      ref: '@e11',
      index: 11,
      type: 'Button',
      depth: 2,
      parentIndex: 10,
      rect: { x: 8, y: 48, width: 44, height: 44 },
    },
    {
      ref: '@e12',
      index: 12,
      type: 'StaticText',
      label: 'Ready',
      depth: 1,
      parentIndex: 1,
      rect: { x: 16, y: 200, width: 200, height: 24 },
    },
  ],
};

/** Nothing interactive anywhere, so a refused tap has nowhere else to go. */
const LABELS_ONLY: RawSnapshot = {
  refsGeneration: 900,
  nodes: [
    { ref: '@e1', index: 1, type: 'Other', depth: 0 },
    {
      ref: '@e44',
      index: 44,
      type: 'StaticText',
      label: 'Back',
      depth: 1,
      parentIndex: 1,
      rect: { x: 24, y: 60, width: 48, height: 20 },
    },
    {
      ref: '@e46',
      index: 46,
      type: 'StaticText',
      label: 'Ready',
      depth: 1,
      parentIndex: 1,
      rect: { x: 16, y: 200, width: 200, height: 24 },
    },
  ],
};

type ParseInput = Partial<TouchpressOptions> & { actionTimeout?: number };

const options: ParseInput = {
  platform: 'android',
  app: 'com.clerk.example',
  readyWhen: { text: 'Ready' },
  launchTimeout: 1000,
  actionTimeout: 600,
};

function open(driver: FakeDriver, overrides?: ParseInput) {
  return openSession({
    options: parseDeviceOptions({ ...options, ...overrides }),
    slot: 0,
    scope: 'android',
    sink: silentSink,
    createDriver: () => driver,
  });
}

/** The refs a mutation was dispatched on. The settle budget is whatever the clock left, so it is dropped. */
function dispatchedRefs(driver: FakeDriver, command: string): string[] {
  return driver.calls
    .filter((call) => call.startsWith(`${command} `))
    .map((call) => call.split(' ')[1] ?? call);
}

function nodeNamed(snapshot: RawSnapshot, name: string): ScreenNode {
  const screen = parseScreen(snapshot, 'android');
  const found = screen.nodes.find((node) => node.name === name);
  if (found === undefined) throw new Error(`no node named ${name}`);
  return found;
}

test('touchTargetFor picks the enclosing control when the label owns no touch point', () => {
  const screen = parseScreen(SIBLINGS, 'android');
  const label = nodeNamed(SIBLINGS, 'Back');
  expect(touchTargetFor(screen, label)?.ref).toBe('@e45');
});

test('touchTargetFor prefers a control inside the matched node over one around it', () => {
  const screen = parseScreen(NESTED, 'ios');
  const container = screen.nodes.find((node) => node.ref === '@e10');
  expect(container).toBeDefined();
  if (container === undefined) return;
  expect(touchTargetFor(screen, container)?.ref).toBe('@e11');
});

test('touchTargetFor returns null when no control covers the matched node', () => {
  const screen = parseScreen(LABELS_ONLY, 'ios');
  const label = screen.nodes.find((node) => node.name === 'Back');
  expect(label).toBeDefined();
  if (label === undefined) return;
  expect(touchTargetFor(screen, label)).toBe(null);
});

test('a refused tap lands on the sibling button and the report says where it went', async () => {
  const driver = createFakeDriver({ screens: [SIBLINGS] });
  driver.coveredRefs.push('@e44');
  const session = await open(driver);
  const sink = createRecordingSink();
  const app = createDevice(session, sink);

  await app.getByText('Back').tap();

  expect(dispatchedRefs(driver, 'tap')).toEqual(['@e44~s900', '@e45~s900']);
  expect(sink.steps).toEqual([
    { title: `tap getByText('Back')`, depth: 0, boxed: false },
    { title: 'retarget to @e45 [button]', depth: 1, boxed: true },
  ]);
});

test('a refused tap on a container lands on the control inside it', async () => {
  const driver = createFakeDriver({ screens: [NESTED] });
  driver.coveredRefs.push('@e10');
  const session = await open(driver, { platform: 'ios' });
  const sink = createRecordingSink();
  const app = createDevice(session, sink);

  await app.getByText('Back').tap();

  expect(dispatchedRefs(driver, 'tap')).toEqual(['@e10~s900', '@e11~s900']);
  expect(sink.steps.at(-1)).toEqual({
    title: 'retarget to @e11 [button]',
    depth: 1,
    boxed: true,
  });
});

test('a refused tap with no control to retarget onto fails with the screen listing', async () => {
  const driver = createFakeDriver({ screens: [LABELS_ONLY] });
  driver.coveredRefs.push('@e44');
  const session = await open(driver, { platform: 'ios' });
  const app = createDevice(session, silentSink);

  const error = await app
    .getByText('Back')
    .tap()
    .catch((thrown: unknown) => thrown);

  expect(error).toBeInstanceOf(TouchpressError);
  if (!(error instanceof TouchpressError)) return;
  expect(error.info.kind).toBe('untappable');
  expect(error.message).toContain('no touch point of its own');
  expect(error.message).toContain(`Locator: getByText('Back')`);
  expect(error.message).toContain(`locator({ role: 'button', where: (node) => ... })`);
  expect(error.message).toContain('@e44 [text] "Back"');
});

test('a retarget that is refused too is not retargeted again', async () => {
  const driver = createFakeDriver({ screens: [SIBLINGS] });
  driver.coveredRefs.push('@e44', '@e45');
  const session = await open(driver);
  const app = createDevice(session, silentSink);

  const error = await app
    .getByText('Back')
    .tap()
    .catch((thrown: unknown) => thrown);

  expect(error).toBeInstanceOf(TouchpressError);
  if (!(error instanceof TouchpressError)) return;
  expect(error.info.kind).toBe('untappable');
  expect(dispatchedRefs(driver, 'tap')).toEqual(['@e44~s900', '@e45~s900']);
});

test('a refused longPress retargets the same way a tap does', async () => {
  const driver = createFakeDriver({ screens: [SIBLINGS] });
  driver.coveredRefs.push('@e44');
  const session = await open(driver);
  const app = createDevice(session, silentSink);

  await app.getByText('Back').longPress(1200);

  expect(dispatchedRefs(driver, 'longPress')).toEqual(['@e44~s900', '@e45~s900']);
  expect(driver.calls.filter((call) => call.includes('1200')).length).toBe(2);
});
