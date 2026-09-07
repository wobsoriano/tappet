import { expect, test, vi } from 'vite-plus/test';
import { jsonSchema, tool, type ToolSet } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';
import { withAi } from '../src/ai/device.ts';
import { runAct, runExtract } from '../src/ai/loop.ts';
import { createDeviceTools } from '../src/ai/tools.ts';
import type { Device } from '../src/core/device.ts';
import { TouchpressError } from '../src/core/errors.ts';
import { silentSink } from '../src/core/report.ts';
import type { DeviceSession } from '../src/core/session.ts';
import { createRecordingSink } from './fake-driver.ts';

const USAGE = {
  inputTokens: { total: 8, noCache: 8, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 4, text: 4, reasoning: 0 },
};

/** Derived from the mock's own constructor, so the provider spec is never restated here. */
type Script = NonNullable<
  NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>['doGenerate']
>;
type Turn = Extract<Script, readonly unknown[]>[number];
type Part = Turn['content'][number];

function toolCall(id: string, name: string, input: unknown): Part {
  return { type: 'tool-call', toolCallId: id, toolName: name, input: JSON.stringify(input) };
}

function done(outcome: 'completed' | 'blocked', summary: string): Part {
  return toolCall('done', 'done', { outcome, summary });
}

function turn(...content: Part[]): Turn {
  return {
    content,
    finishReason: { unified: 'tool-calls', raw: undefined },
    usage: USAGE,
    warnings: [],
  };
}

/** The tools the model drives in these tests. Each records its call rather than reaching a device. */
function fakeTools(calls: string[]): ToolSet {
  const text = { type: 'string' } as const;
  return {
    snapshot: tool({
      description: 'snapshot the screen',
      inputSchema: jsonSchema({ type: 'object', properties: {} }),
      execute: () => {
        calls.push('snapshot');
        return Promise.resolve({ nodes: ['@a1 [button] "Sign in"'] });
      },
    }),
    press: tool({
      description: 'press a node',
      inputSchema: jsonSchema({ type: 'object', properties: { target: text } }),
      execute: (input: unknown) => {
        calls.push(`press ${String(Reflect.get(input as object, 'target'))}`);
        return Promise.resolve({ ok: true });
      },
    }),
    fill: tool({
      description: 'fill a field',
      inputSchema: jsonSchema({ type: 'object', properties: { target: text, text } }),
      execute: (input: unknown) => {
        calls.push(`fill ${String(Reflect.get(input as object, 'target'))}`);
        return Promise.resolve({ ok: true });
      },
    }),
  };
}

function act(model: MockLanguageModelV4, sink = createRecordingSink(), maxSteps = 10) {
  const calls: string[] = [];
  const run = runAct({
    model,
    tools: fakeTools(calls),
    sink,
    instruction: 'Sign in with the email rob@example.com and the password hunter2',
    platform: 'ios',
    maxSteps,
    timeout: 30_000,
    screen: () => Promise.resolve('@a1 [button] "Sign in"'),
    attempt: 1,
  });
  return { run, calls, sink };
}

test('act reports the instruction, nests every model command under it, and returns the summary', async () => {
  const model = new MockLanguageModelV4({
    doGenerate: [
      turn(toolCall('1', 'snapshot', {})),
      turn(toolCall('2', 'press', { target: '@a1' })),
      turn({ type: 'text', text: 'landed on the profile' }, done('completed', 'Signed in as Rob')),
    ],
  });
  const { run, calls, sink } = act(model);

  expect(await run).toBe('Signed in as Rob');
  expect(calls).toEqual(['snapshot', 'press @a1']);
  expect(sink.steps).toEqual([
    {
      title: 'act "Sign in with the email rob@example.com and the password hunter2"',
      depth: 0,
      boxed: false,
    },
    { title: 'snapshot', depth: 1, boxed: false },
    { title: 'press @a1', depth: 1, boxed: false },
  ]);
});

test('a fill the model ran reports the text it typed as a nested boxed step', async () => {
  const model = new MockLanguageModelV4({
    doGenerate: [
      turn(toolCall('1', 'fill', { target: '@email', text: 'rob@example.com' })),
      turn(done('completed', 'Filled the email field')),
    ],
  });
  const { run, sink } = act(model);
  await run;

  expect(sink.steps.slice(1)).toEqual([
    { title: 'fill @email', depth: 1, boxed: false },
    { title: 'type "rob@example.com"', depth: 2, boxed: true },
  ]);
});

test('act attaches one transcript carrying the calls, the results, and the usage', async () => {
  const model = new MockLanguageModelV4({
    doGenerate: [
      turn(toolCall('1', 'snapshot', {})),
      turn(done('completed', 'Nothing to do, already signed in')),
    ],
  });
  const { run, sink } = act(model);
  await run;

  expect(sink.attachments).toHaveLength(1);
  const file = sink.attachments[0];
  expect(file?.name).toBe('ai-act-1.json');
  expect(file?.contentType).toBe('application/json');
  const transcript: unknown = JSON.parse(file !== undefined && 'body' in file ? file.body : '{}');
  expect(transcript).toMatchObject({
    instruction: 'Sign in with the email rob@example.com and the password hunter2',
    usage: { inputTokens: 16, outputTokens: 8, totalTokens: 24 },
    steps: [
      {
        toolCalls: [{ name: 'snapshot', input: {} }],
        toolResults: [{ name: 'snapshot', output: '{"nodes":["@a1 [button] \\"Sign in\\""]}' }],
      },
      { toolCalls: [{ name: 'done', input: { outcome: 'completed' } }] },
    ],
  });
});

test('a model that reports it is blocked fails the test rather than resolving with prose', async () => {
  const model = new MockLanguageModelV4({
    doGenerate: [
      turn(toolCall('1', 'snapshot', {})),
      turn(done('blocked', 'No sign-in button on this screen')),
    ],
  });
  const { run } = act(model);

  const error = await run.catch((thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(TouchpressError);
  expect((error as TouchpressError).info).toMatchObject({
    kind: 'ai-blocked',
    summary: 'No sign-in button on this screen',
    screen: '@a1 [button] "Sign in"',
  });
  expect((error as TouchpressError).message).toContain('No sign-in button on this screen');
});

test('a loop that runs out of steps without calling done fails with what it managed', async () => {
  const model = new MockLanguageModelV4({
    doGenerate: () => Promise.resolve(turn(toolCall('1', 'snapshot', {}))),
  });
  const { run } = act(model, createRecordingSink(), 3);

  const error = await run.catch((thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(TouchpressError);
  expect((error as TouchpressError).info).toMatchObject({ kind: 'ai-incomplete', steps: 3 });
  expect((error as TouchpressError).message).toContain('Raise maxSteps');
});

test('extract validates the answer against the schema and reports the question', async () => {
  const sink = createRecordingSink();
  const model = new MockLanguageModelV4({
    doGenerate: (): Promise<Turn> =>
      Promise.resolve({
        content: [{ type: 'text', text: '{"signedIn":true,"reason":"the greeting names Rob"}' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: USAGE,
        warnings: [],
      }),
  });

  const answer = await runExtract({
    model,
    screen: '@a1 [text] "Hi, Rob"',
    question: 'Is a user signed in?',
    schema: z.object({ signedIn: z.boolean(), reason: z.string() }),
    sink,
    timeout: 10_000,
  });

  expect(answer).toEqual({ signedIn: true, reason: 'the greeting names Rob' });
  expect(sink.steps).toEqual([{ title: 'extract "Is a user signed in?"', depth: 0, boxed: false }]);
});

test('act and extract name the aiModel key when no model is configured', async () => {
  const session = { name: 'touchpress-ai-0', options: { platform: 'ios' } } as DeviceSession;
  const device = withAi({} as Device, session, silentSink, undefined);

  await expect(device.act('sign in')).rejects.toThrow(/use\.aiModel/);
  await expect(device.extract('signed in?', z.object({ ok: z.boolean() }))).rejects.toThrow(
    /use\.aiModel/,
  );
});

test('the device tools are the ten that perceive and act, with no way to reach another device', async () => {
  const tools = await createDeviceTools('touchpress-ai-0', 'ios');

  expect(Object.keys(tools).sort()).toEqual([
    'alert',
    'back',
    'fill',
    'get',
    'is',
    'press',
    'scroll',
    'snapshot',
    'type',
    'wait',
  ]);

  const forbidden = ['open', 'close', 'find', 'swipe', 'click', 'screenshot'];
  for (const name of forbidden) expect(tools[name]).toBeUndefined();

  const daemonKeys = [
    'udid',
    'serial',
    'device',
    'deviceTarget',
    'daemonBaseUrl',
    'daemonAuthToken',
    'tenant',
    'runId',
    'leaseId',
    'cwd',
    'debug',
    'iosSimulatorDeviceSet',
    'iosXctestrunFile',
    'iosXctestDerivedDataPath',
    'iosXctestEnvDir',
    'androidDeviceAllowlist',
    'noRecord',
    'record',
    'saveScript',
    'stateDir',
  ];
  for (const [name, built] of Object.entries(tools)) {
    const schema = (
      built.inputSchema as { jsonSchema: { properties?: object; required?: string[] } }
    ).jsonSchema;
    const properties = Object.keys(schema.properties ?? {});
    const required = schema.required ?? [];
    for (const key of daemonKeys) {
      expect(properties, `${name}.${key}`).not.toContain(key);
      expect(required, `${name}.${key} required`).not.toContain(key);
    }
    // The one addressing key that survives, because a snapshot ref is how the model names a node.
    if (name === 'press' || name === 'fill') expect(required).toContain('target');
  }
});

test("a missing 'ai' package names the install command rather than failing to resolve a module", async () => {
  vi.doMock('ai', () => {
    throw new Error("Cannot find package 'ai'");
  });
  vi.resetModules();
  const { loadAi } = await import('../src/ai/tools.ts');

  // `resetModules` gives this call its own copy of errors.ts, so the class identity is a
  // different one and the name is what identifies the error.
  const error = await loadAi().catch((thrown: unknown) => thrown);
  expect((error as TouchpressError).name).toBe('TouchpressError');
  expect((error as TouchpressError).info).toEqual({ kind: 'ai-missing-peer' });
  expect((error as TouchpressError).message).toContain('pnpm add -D ai');

  vi.doUnmock('ai');
  vi.resetModules();
});
