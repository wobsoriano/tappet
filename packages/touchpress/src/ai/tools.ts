import type { ToolSet } from 'ai';
import { TouchpressError } from '../core/errors.ts';
import type { ActionRecord } from '../core/report.ts';
import type { Platform } from '../core/screen.ts';

/**
 * The AI SDK is an optional peer, so it is imported here and never at module
 * scope. Importing `touchpress` must not require it, because a project that
 * calls neither `act` nor `extract` never installs it.
 */
export async function loadAi(): Promise<typeof import('ai')> {
  try {
    return await import('ai');
  } catch {
    throw new TouchpressError({ kind: 'ai-missing-peer' });
  }
}

/**
 * How one model command reports, keyed by the agent-device command it runs.
 * Membership is also the keep list: `createDeviceTools` builds exactly these and
 * drops everything else the upstream registry offers, so `open`, `close`, and
 * `screenshot` stay out of the model's reach and the session stays ours.
 *
 * `detail` is the input key whose value follows the name in a step title, and
 * `echoesText` marks the two commands that write into a field.
 */
type ToolReport = { readonly detail: string | null; readonly echoesText: boolean };

const PLAIN: ToolReport = { detail: null, echoesText: false };

const DEVICE_TOOLS = new Map<string, ToolReport>([
  ['snapshot', PLAIN],
  ['press', { detail: 'target', echoesText: false }],
  ['fill', { detail: 'target', echoesText: true }],
  ['type', { detail: null, echoesText: true }],
  ['scroll', { detail: 'direction', echoesText: false }],
  ['back', PLAIN],
  ['wait', PLAIN],
  ['get', PLAIN],
  ['is', PLAIN],
  ['alert', PLAIN],
]);

/**
 * Everything an input schema says about which device, daemon, or workspace a
 * command reaches. The session already pins all of it, and a model that could
 * name a daemon could leave the device this test opened. `target`, the snapshot
 * ref or selector, is the only addressing key that survives.
 */
const DAEMON_KEYS = new Set([
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
]);

/** What this module reads off an upstream tool. `jsonSchema()` stores the raw schema under `jsonSchema`. */
type BuiltTool = {
  readonly description?: string;
  readonly inputSchema: { readonly jsonSchema: JsonSchema };
  readonly execute?: unknown;
};

type JsonSchema = {
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly [key: string]: unknown;
};

/**
 * The tools a model drives the app with, built from agent-device's own command
 * registry so the descriptions and the executors stay upstream's. Two things
 * change: the set is narrowed to the ten commands that perceive and act, and
 * every key that could point a command at another device is cut from the input
 * schema. Building them contacts no device.
 */
export async function createDeviceTools(session: string, platform: Platform): Promise<ToolSet> {
  const { createAgentDeviceTools } = await import('agent-device/ai-sdk');
  const { jsonSchema, tool } = await loadAi();
  const { tools } = await createAgentDeviceTools({ session, platform });

  const kept: ToolSet = {};
  for (const name of DEVICE_TOOLS.keys()) {
    const built = tools[name] as BuiltTool | undefined;
    if (built === undefined) {
      throw new Error(`agent-device no longer exposes the "${name}" tool`);
    }
    kept[name] = tool({
      description: built.description,
      inputSchema: jsonSchema(prune(built.inputSchema.jsonSchema)),
      execute: built.execute as Parameters<typeof tool>[0]['execute'],
    });
  }
  return kept;
}

function prune(schema: JsonSchema): JsonSchema {
  if (schema.properties === undefined) return schema;
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema.properties)) {
    if (!DAEMON_KEYS.has(key)) properties[key] = value;
  }
  return {
    ...schema,
    properties,
    ...(schema.required === undefined
      ? {}
      : { required: schema.required.filter((key) => !DAEMON_KEYS.has(key)) }),
  };
}

/** A tool the table does not name still reports, by its name alone. */
export function toolRecord(name: string, input: unknown): ActionRecord {
  const detail = DEVICE_TOOLS.get(name)?.detail ?? null;
  const target = detail === null ? null : readText(input, detail);
  return target === null ? { kind: 'tool', name } : { kind: 'tool', name, target };
}

/**
 * The text a `fill` or a `type` wrote, for the nested step under it. Never
 * masked: the model composed this string and already holds it, so hiding it
 * from the report would cost evidence and buy nothing. A credential belongs in
 * a deterministic `fill(text, { secret: true })` outside `act`.
 */
export function typedText(name: string, input: unknown): string | null {
  return DEVICE_TOOLS.get(name)?.echoesText === true ? readText(input, 'text') : null;
}

function readText(input: unknown, key: string): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const value = Reflect.get(input, key);
  return typeof value === 'string' && value.length > 0 ? value : null;
}
