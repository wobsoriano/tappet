import { expect, test } from 'vite-plus/test';
import { describeQuery, textMatch, type Query } from '../src/core/query.ts';
import { parseScreen, pin, renderScreen, resolve, type RawSnapshot } from '../src/core/screen.ts';
import { loadScreen } from './fixtures.ts';

const home = loadScreen('home');
const explore = loadScreen('explore');

function byText(value: string, exact?: boolean): Query {
  return { name: textMatch(value, exact) };
}

test('parseScreen builds parent links and normalizes iOS types into CLI roles', () => {
  const button = home.nodes.find((node) => node.ref === '@e29');
  expect(button?.role).toBe('button');
  expect(button?.rawType).toBe('Button');
  expect(button?.name).toBe('Home');
  expect(button?.selected).toBe(true);
  expect(button?.parent?.ref).toBe('@e27');
  expect(home.generation).toBe(776575);
  expect(home.appId).toBe('com.wobsoriano.awesometodo');
  expect(home.nodes.find((node) => node.ref === '@e13')?.role).toBe('text');
  expect(explore.nodes.find((node) => node.ref === '@e7')?.role).toBe('scroll-area');
  expect(explore.nodes.find((node) => node.ref === '@e14')?.role).toBe('link');
});

test('parseScreen collapses whitespace inside a label so a one-line query matches', () => {
  const paragraph = explore.nodes.find((node) => node.ref === '@e13');
  expect(paragraph?.name).toBe('This starter app includes example code to help you get started.');
});

test('a container and its text child carrying one label resolve to one node', () => {
  const resolution = resolve(home, byText('Live from the cloud'));
  expect(resolution.outcome).toBe('one');
  if (resolution.outcome !== 'one') return;
  expect(resolution.node.ref).toBe('@e13');
  expect(resolution.node.role).toBe('text');
});

test('a wrapper around a button collapses into the button', () => {
  const resolution = resolve(home, byText('Home'));
  expect(resolution.outcome).toBe('one');
  if (resolution.outcome !== 'one') return;
  expect(resolution.node.ref).toBe('@e29');
  expect(resolution.node.role).toBe('button');
});

test('matches in disjoint subtrees stay distinct', () => {
  const resolution = resolve(explore, byText('Explore'));
  expect(resolution.outcome).toBe('many');
  if (resolution.outcome !== 'many') return;
  expect(resolution.nodes.map((node) => node.ref)).toEqual(['@e12', '@e35']);
  expect(resolution.nodes.map((node) => node.role)).toEqual(['text', 'button']);
});

test('a role narrows the same ambiguous text down to one node', () => {
  const heading = resolve(explore, { role: 'text', name: textMatch('Explore') });
  expect(heading.outcome).toBe('one');
  if (heading.outcome !== 'one') return;
  expect(heading.node.ref).toBe('@e12');

  const tab = resolve(explore, { role: 'button', name: textMatch('Explore') });
  expect(tab.outcome).toBe('one');
  if (tab.outcome !== 'one') return;
  expect(tab.node.ref).toBe('@e35');
});

test('text matching is case-insensitive substring by default and whole-string when exact', () => {
  expect(resolve(home, byText('live from the')).outcome).toBe('one');
  expect(resolve(home, byText('LIVE FROM THE CLOUD')).outcome).toBe('one');
  expect(resolve(home, byText('live from the cloud', true)).outcome).toBe('none');
  expect(resolve(home, byText('Live from the cloud', true)).outcome).toBe('one');
  expect(resolve(explore, byText('Expo documentation')).outcome).toBe('one');
  expect(resolve(explore, byText('Expo documentation', true)).outcome).toBe('none');
});

test('a regex matches the normalized name', () => {
  const resolution = resolve(explore, { name: { kind: 'regex', value: /^Forward, Ima/ } });
  expect(resolution.outcome).toBe('one');
  if (resolution.outcome !== 'one') return;
  expect(resolution.node.ref).toBe('@e21');
});

test('first and nth pick out of an ambiguous match', () => {
  const first = resolve(explore, { ...byText('Explore'), index: 0 });
  expect(first.outcome).toBe('one');
  if (first.outcome !== 'one') return;
  expect(first.node.ref).toBe('@e12');

  const second = resolve(explore, { ...byText('Explore'), index: 1 });
  expect(second.outcome).toBe('one');
  if (second.outcome !== 'one') return;
  expect(second.node.ref).toBe('@e35');

  expect(resolve(explore, { ...byText('Explore'), index: 7 }).outcome).toBe('none');
});

test('a miss carries the closest names on screen', () => {
  const resolution = resolve(home, byText('Fresh startup'));
  expect(resolution.outcome).toBe('none');
  if (resolution.outcome !== 'none') return;
  expect(resolution.nearest.map((node) => node.name)).toContain('Fresh start');
});

test('testId matches the accessibility identifier', () => {
  const raw: RawSnapshot = {
    refsGeneration: 42,
    nodes: [
      { ref: 'e1', index: 0, type: 'Other' },
      {
        ref: 'e2',
        index: 1,
        parentIndex: 0,
        type: 'Other',
        identifier: 'submit-order',
        label: 'Submit',
      },
      {
        ref: 'e3',
        index: 2,
        parentIndex: 1,
        type: 'Button',
        identifier: 'submit-order',
        label: 'Submit',
      },
      {
        ref: 'e4',
        index: 3,
        parentIndex: 0,
        type: 'Button',
        identifier: 'cancel-order',
        label: 'Cancel',
      },
    ],
  };
  const screen = parseScreen(raw, 'ios');

  const resolution = resolve(screen, { testId: textMatch('submit-order', true) });
  expect(resolution.outcome).toBe('one');
  if (resolution.outcome !== 'one') return;
  expect(resolution.node.ref).toBe('@e3');
  expect(pin(screen, resolution.node)).toBe('@e3~s42');

  expect(resolve(screen, { testId: textMatch('order', true) }).outcome).toBe('none');
  expect(resolve(screen, { testId: textMatch('order') }).outcome).toBe('many');
});

test("renderScreen speaks the CLI's own role and label vocabulary", () => {
  const listing = renderScreen(home);
  expect(listing).toContain(`@e13 [text] "Live from the cloud"`);
  expect(listing).toContain(`@e29 [button] "Home" [selected]`);
  expect(renderScreen(home, { maxNodes: 3 })).toContain('... 29 more nodes');
});

test('describeQuery renders the factory call the author wrote', () => {
  expect(describeQuery(byText('Explore'))).toBe("getByText('Explore')");
  expect(describeQuery(byText('Explore', true))).toBe("getByText('Explore', { exact: true })");
  expect(describeQuery({ role: 'button', name: textMatch('Explore') })).toBe(
    "getByRole('button', { name: 'Explore' })",
  );
  expect(describeQuery({ testId: textMatch('submit', true) })).toBe("getByTestId('submit')");
  expect(describeQuery({ ...byText('Explore'), index: 0 })).toBe("getByText('Explore').first()");
  expect(describeQuery({ role: 'button', selected: true })).toBe(
    "locator({ role: 'button', selected: true })",
  );
  expect(describeQuery({ role: 'button', name: textMatch('Home', true) })).toBe(
    "getByRole('button', { name: 'Home', exact: true })",
  );
  expect(describeQuery({ role: 'button', value: textMatch('on') })).toBe(
    "locator({ value: 'on', role: 'button' })",
  );
  expect(describeQuery({ testId: textMatch('id', true), value: textMatch('on') })).toBe(
    "locator({ testId: 'id', value: 'on' })",
  );
});

test('absorption keys on the string the query matched, not on the whole node', () => {
  const raw: RawSnapshot = {
    refsGeneration: 9,
    nodes: [
      { ref: 'e1', index: 0, type: 'Other' },
      { ref: 'e2', index: 1, parentIndex: 0, type: 'Other', identifier: 'row', label: 'Submit' },
      { ref: 'e3', index: 2, parentIndex: 1, type: 'Button', label: 'Submit' },
    ],
  };
  const screen = parseScreen(raw, 'ios');

  const byText = resolve(screen, { name: textMatch('Submit') });
  expect(byText.outcome).toBe('one');
  if (byText.outcome !== 'one') return;
  expect(byText.node.ref).toBe('@e3');
});

test('a query with no text does not collapse nested nodes that say different things', () => {
  const raw: RawSnapshot = {
    refsGeneration: 9,
    nodes: [
      { ref: 'e1', index: 0, type: 'Other' },
      { ref: 'e2', index: 1, parentIndex: 0, type: 'Button', label: 'Outer' },
      { ref: 'e3', index: 2, parentIndex: 1, type: 'Button', label: 'Inner' },
    ],
  };
  expect(resolve(parseScreen(raw, 'ios'), { role: 'button' }).outcome).toBe('many');
});

test('pin falls back to a bare ref when the driver reported no generation', () => {
  const screen = parseScreen(
    { nodes: [{ ref: 'e1', index: 0, type: 'Button', label: 'Go' }] },
    'ios',
  );
  const node = screen.nodes[0];
  expect(node).toBeDefined();
  if (node === undefined) return;
  expect(pin(screen, node)).toBe('@e1');
});
