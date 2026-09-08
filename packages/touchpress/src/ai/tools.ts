import type { ToolSet } from 'ai';
import { TouchpressError } from '../core/errors.ts';
import type { ActionRecord } from '../core/report.ts';
import { parseScreen, renderScreen, type Platform, type RawSnapshot } from '../core/screen.ts';

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
 * `detail` is the input key whose value follows the name in a step title,
 * `echoesText` marks the two commands that write into a field, and `output`
 * picks which transform trims what upstream hands back before the model reads
 * it. Upstream is generous: a raw snapshot runs about 19k tokens a step and an
 * action result carries a settle diff, evidence paths, and a cost breakdown the
 * model never acts on. `screen` renders the compact listing failure messages
 * print, `outcome` keeps only whether the action landed and settled, and `raw`
 * passes a small answer through untouched.
 */
type OutputShape = 'screen' | 'outcome' | 'raw';

type ToolReport = {
  readonly detail: string | null;
  readonly echoesText: boolean;
  readonly output: OutputShape;
};

const READ: ToolReport = { detail: null, echoesText: false, output: 'raw' };

const DEVICE_TOOLS = new Map<string, ToolReport>([
  ['snapshot', { detail: null, echoesText: false, output: 'screen' }],
  ['press', { detail: 'target', echoesText: false, output: 'outcome' }],
  ['fill', { detail: 'target', echoesText: true, output: 'outcome' }],
  ['type', { detail: null, echoesText: true, output: 'outcome' }],
  ['scroll', { detail: 'direction', echoesText: false, output: 'outcome' }],
  ['back', { detail: null, echoesText: false, output: 'outcome' }],
  ['wait', READ],
  ['get', READ],
  ['is', READ],
  ['alert', READ],
]);

/**
 * Everything an input schema says about which device, daemon, or workspace a
 * command reaches. The session already pins all of it, and a model that could
 * name a daemon could leave the device this test opened.
 *
 * `recordAs` rides along for a different reason: a `fill` carrying it fails
 * unless script recording is armed, which under touchpress it never is.
 */
const CUT_KEYS = new Set([
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
  'recordAs',
]);

export type Execute = (input: unknown, options: unknown) => unknown;

/** What this module reads off an upstream tool. `jsonSchema()` stores the raw schema under `jsonSchema`. */
type BuiltTool = {
  readonly description?: string;
  readonly inputSchema: { readonly jsonSchema: JsonSchema };
  readonly execute: Execute;
};

type JsonSchema = {
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly [key: string]: unknown;
};

/**
 * The tools a model drives the app with, built from agent-device's own command
 * registry so the descriptions and the executors stay upstream's. Three things
 * change: the set is narrowed to the ten commands that perceive and act, every
 * key that could point a command at another device is cut from the input
 * schema, and each executor is wrapped so what crosses to the model is the
 * shape the model can act on. Building them contacts no device.
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
    const schema = prune(built.inputSchema.jsonSchema);
    kept[name] = tool({
      description: built.description,
      inputSchema: jsonSchema(schema),
      execute: wrapDeviceTool(
        name,
        platform,
        built.execute,
        new Set(Object.keys(schema.properties ?? {})),
      ),
    });
  }
  return kept;
}

/**
 * The one place a command's input and output are reshaped for the model, so the
 * table above stays the only thing that says which command gets which shape.
 *
 * `accepted` is the key set of the pruned schema. A schema handed to
 * `jsonSchema()` describes the tool and validates nothing, so a model that
 * sends a key the schema no longer lists would otherwise have it forwarded.
 */
export function wrapDeviceTool(
  name: string,
  platform: Platform,
  execute: Execute,
  accepted: ReadonlySet<string>,
): Execute {
  const shape = DEVICE_TOOLS.get(name)?.output ?? 'raw';
  return async (input, options) => {
    const declared = Object.fromEntries(
      Object.entries(asObject(input)).filter(([key]) => accepted.has(key)),
    );
    const sent = shape === 'screen' ? { ...declared, forceFull: true } : withRefSigil(declared);
    const output = await execute(sent, options);
    return shape === 'screen'
      ? compactSnapshot(asSnapshot(output), platform)
      : compactResult(name, output);
  };
}

/**
 * The tree the model reads, in the same listing a failure message prints, one
 * node per line indented by depth. The JSON upstream returns says the same thing
 * with rects, indexes, and flags the model never uses, at three to seven times
 * the size across this repo's fixtures, and its refs arrive without the `@` the
 * action schemas demand.
 */
export function compactSnapshot(raw: RawSnapshot, platform: Platform): string {
  const screen = parseScreen(raw, platform);
  const listing = renderScreen(screen);
  return screen.truncated
    ? `${listing}\n  ... the tree is truncated, so some nodes are missing`
    : listing;
}

/**
 * What the model needs off an action it just ran: whether it landed, on what,
 * and whether the screen went quiet. Upstream also returns the settle diff, the
 * evidence paths, the resolution, and the cost, which are most of the step's
 * tokens and none of its meaning.
 */
export function compactResult(name: string, output: unknown): unknown {
  if (DEVICE_TOOLS.get(name)?.output !== 'outcome') return output;
  if (typeof output !== 'object' || output === null) return output;
  const settle = asObject(output)['settle'];
  return {
    ...pick(output, 'message'),
    ...pick(output, 'targetKind'),
    ...(typeof settle === 'object' && settle !== null
      ? { settle: { ...pick(settle, 'settled'), ...pick(settle, 'waitedMs') } }
      : {}),
  };
}

/**
 * Upstream's own snapshot nodes carry a bare `e4` while the action schemas
 * demand `@e4`, and a model that sends the bare form gets an error it tends to
 * read as "refs do not work here" before falling back to coordinates for the
 * rest of the run. The listing above now prints the `@`, and this catches the
 * model that typed it from memory anyway.
 */
function withRefSigil(input: unknown): unknown {
  const target = asObject(asObject(input)['target']);
  if (target['kind'] !== 'ref') return input;
  const ref = target['ref'];
  if (typeof ref !== 'string' || ref.startsWith('@')) return input;
  return { ...asObject(input), target: { ...target, ref: `@${ref}` } };
}

function asObject(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
}

function asSnapshot(output: unknown): RawSnapshot {
  if (Array.isArray(asObject(output)['nodes'])) return output as RawSnapshot;
  throw new Error('agent-device returned a snapshot without nodes');
}

function pick(source: object, key: string): Record<string, unknown> {
  const value = asObject(source)[key];
  return value === undefined ? {} : { [key]: value };
}

function prune(schema: JsonSchema): JsonSchema {
  if (schema.properties === undefined) return schema;
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema.properties)) {
    if (!CUT_KEYS.has(key) && !(key === 'target' && isDeviceAlias(value))) properties[key] = value;
  }
  return {
    ...schema,
    properties,
    ...(schema.required === undefined
      ? {}
      : { required: schema.required.filter((key) => key in properties) }),
  };
}

/**
 * Upstream spends `target` twice. On `press`, `fill`, and `get` it is the UI
 * element, a `oneOf` over ref, selector, and point. On the rest it is an alias
 * for `deviceTarget`, an enum of device forms, and a model reading both in one
 * tool set answers the second where the first was meant. The session pins the
 * device, so the alias goes and only the UI target survives.
 */
function isDeviceAlias(schema: unknown): boolean {
  return Array.isArray(asObject(schema)['enum']);
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
  const value = asObject(input)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
