import { expect, test } from 'vite-plus/test';
import type { DeviceFailure } from '../src/core/driver.ts';
import { probe, type ProbeTarget } from '../src/core/probe.ts';
import { describeQuery, textMatch, type Query } from '../src/core/query.ts';
import type { Screen } from '../src/core/screen.ts';
import { loadScreen, type FixtureName } from './fixtures.ts';

function target(
  query: Query,
  screens: FixtureName[],
  failure: DeviceFailure | null = null,
): ProbeTarget & { polls: number } {
  const state = {
    query,
    description: describeQuery(query),
    polls: 0,
    capture(): Promise<Screen> {
      state.polls += 1;
      const name = screens.length > 1 ? (screens.shift() ?? 'home') : (screens[0] ?? 'home');
      return Promise.resolve(loadScreen(name));
    },
    failure: () => failure,
  };
  return state;
}

test('a check that already holds costs one snapshot', async () => {
  const subject = target({ name: textMatch('GET STARTED') }, ['home']);
  const result = await probe(subject, { name: 'toBeVisible' }, { negate: false, timeoutMs: 2000 });
  expect(result.pass).toBe(true);
  expect(result.message).toBe('');
  expect(subject.polls).toBe(1);
});

test('a check polls until the screen catches up', async () => {
  const subject = target({ role: 'text', name: textMatch('Explore') }, ['home', 'home', 'explore']);
  const result = await probe(
    subject,
    { name: 'toBeVisible' },
    { negate: false, timeoutMs: 3000, intervalMs: 10 },
  );
  expect(result.pass).toBe(true);
  expect(subject.polls).toBe(3);
});

test('negation polls for the control to leave rather than passing on a race', async () => {
  const subject = target({ name: textMatch('Fresh start') }, ['home', 'home', 'explore']);
  const result = await probe(
    subject,
    { name: 'toBeVisible' },
    { negate: true, timeoutMs: 3000, intervalMs: 10 },
  );
  expect(result.pass).toBe(false);
  expect(subject.polls).toBe(3);
});

test('a control that never leaves fails the negated check with its own message', async () => {
  const subject = target({ name: textMatch('Fresh start') }, ['home']);
  const result = await probe(
    subject,
    { name: 'toBeVisible' },
    { negate: true, timeoutMs: 60, intervalMs: 10 },
  );
  expect(result.pass).toBe(true);
  expect(result.message).toContain('Expected not.toBeVisible');
  expect(result.message).toContain('Expected: not visible');
});

test('a failed check returns the message instead of throwing', async () => {
  const subject = target({ name: textMatch('Sign out') }, ['home']);
  const result = await probe(
    subject,
    { name: 'toBeVisible' },
    { negate: false, timeoutMs: 60, intervalMs: 10 },
  );
  expect(result.pass).toBe(false);
  expect(result.message).toContain("Locator: getByText('Sign out')");
  expect(result.message).toContain('Expected: visible');
  expect(result.message).toContain('Received: no node matched');
  expect(result.message).toContain(`@e13 [text] "Live from the cloud"`);
});

test('a broken session ends the loop at once with the root cause', async () => {
  const subject = target({ name: textMatch('GET STARTED') }, ['home'], {
    kind: 'device-busy',
    owner: 'lex',
    detail: 'held elsewhere',
  });
  const result = await probe(subject, { name: 'toBeVisible' }, { negate: false, timeoutMs: 5000 });
  expect(result.pass).toBe(false);
  expect(result.message).toContain(`by session "lex"`);
  expect(subject.polls).toBe(0);
});

test('an ambiguous locator fails an assertion at once, and .not cannot invert it into a pass', async () => {
  const plain = target({ name: textMatch('Explore') }, ['explore']);
  const result = await probe(plain, { name: 'toBeVisible' }, { negate: false, timeoutMs: 3000 });
  expect(result.pass).toBe(false);
  expect(plain.polls).toBe(1);
  expect(result.message).toContain('2 nodes matched');

  const negated = target({ name: textMatch('Explore') }, ['explore']);
  const inverted = await probe(negated, { name: 'toBeVisible' }, { negate: true, timeoutMs: 3000 });
  expect(inverted.pass).toBe(true);
  expect(negated.polls).toBe(1);
  expect(inverted.message).toContain('2 nodes matched');
});

test('toHaveCount is the one check an ambiguous locator can still satisfy', async () => {
  const subject = target({ name: textMatch('Explore') }, ['explore']);
  const result = await probe(
    subject,
    { name: 'toHaveCount', expected: 2 },
    { negate: false, timeoutMs: 3000 },
  );
  expect(result.pass).toBe(true);
});

test('a broken session fails a negated assertion too', async () => {
  const subject = target({ name: textMatch('Sign out') }, ['home'], {
    kind: 'device-missing',
    detail: 'simulator shut down',
  });
  const result = await probe(subject, { name: 'toBeVisible' }, { negate: true, timeoutMs: 3000 });
  expect(result.pass).toBe(true);
  expect(result.message).toContain('no matching device is booted');
  expect(subject.polls).toBe(0);
});

test('the loop keeps polling right up to the deadline', async () => {
  const subject = target({ name: textMatch('Sign out') }, ['home']);
  const started = Date.now();
  await probe(subject, { name: 'toBeVisible' }, { negate: false, timeoutMs: 200, intervalMs: 50 });
  expect(Date.now() - started).toBeGreaterThanOrEqual(200);
});
