import { describeQuery, type Query } from './query.ts';
import type { BackMode, ScrollDirection } from './driver.ts';

/** A file the runner should surface with the test result. */
export type EvidenceFile =
  | { readonly name: string; readonly path: string; readonly contentType: string }
  | { readonly name: string; readonly body: string; readonly contentType: string };

/**
 * The most a step title may say about text that was typed. A secure field never
 * reports its contents, so a step that wrote to one says how many characters it
 * typed and nothing else. A caller can ask for the same on a field the platform
 * did not mark secure, which keeps a credential out of a terminal and a report.
 */
export type Typed =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'hidden'; readonly length: number };

export type ActionRecord =
  | {
      readonly kind: 'open';
      readonly app: string;
      readonly device: string;
      readonly session: string;
    }
  | { readonly kind: 'tap'; readonly query: Query }
  | { readonly kind: 'long-press'; readonly query: Query; readonly durationMs: number }
  | { readonly kind: 'fill'; readonly query: Query }
  | { readonly kind: 'typed'; readonly typed: Typed }
  /** Where an action landed after the driver refused the node the locator matched. */
  | { readonly kind: 'retarget'; readonly target: string }
  | { readonly kind: 'scroll'; readonly direction: ScrollDirection }
  | { readonly kind: 'scroll-into-view'; readonly query: Query }
  | { readonly kind: 'relaunch'; readonly app: string }
  | { readonly kind: 'back'; readonly mode: BackMode }
  | { readonly kind: 'clear-state'; readonly app: string }
  | { readonly kind: 'clear-keychain' }
  | { readonly kind: 'dismiss-overlay' }
  | { readonly kind: 'screenshot'; readonly path: string }
  | { readonly kind: 'act'; readonly instruction: string }
  | { readonly kind: 'extract'; readonly question: string }
  /** One command the model ran inside an `act`. `target` is its snapshot ref, or a scroll's direction. */
  | { readonly kind: 'tool'; readonly name: string; readonly target?: string };

/** A boxed step reports as one line rather than as something to open. */
export type StepOptions = { readonly box?: boolean };

/**
 * A runner with no step concept calls `body()` directly, ignores `options`, and
 * drops attachments.
 *
 * Invariant: `step` invokes `body` exactly once and propagates its result and
 * its rejection unchanged. It reports, it never decides control flow.
 */
export type ActionSink = {
  step<T>(title: string, body: () => Promise<T>, options?: StepOptions): Promise<T>;
  attach(file: EvidenceFile): Promise<void>;
  /** A key/value fact about the run, such as which device this worker bound to. */
  note(key: string, value: string): void;
  /** A unique path for this test and this retry attempt. */
  outputPath(fileName: string): string;
};

const FILL_TEXT_LIMIT = 40;
const PROMPT_LIMIT = 80;

/** Rendered here rather than in an adapter so every runner produces the same text. */
export function renderTitle(record: ActionRecord): string {
  switch (record.kind) {
    case 'open':
      return `open ${record.app} on ${record.device} as ${record.session}`;
    case 'tap':
      return `tap ${describeQuery(record.query)}`;
    case 'long-press':
      return `longPress ${describeQuery(record.query)} for ${String(record.durationMs)}ms`;
    case 'fill':
      return `fill ${describeQuery(record.query)}`;
    case 'typed':
      return renderTyped(record.typed);
    case 'retarget':
      return `retarget to ${record.target}`;
    case 'scroll':
      return `scroll ${record.direction}`;
    case 'scroll-into-view':
      return `scrollIntoView ${describeQuery(record.query)}`;
    case 'relaunch':
      return `relaunch ${record.app}`;
    case 'back':
      return `back (${record.mode})`;
    case 'clear-state':
      return `clear state of ${record.app}`;
    case 'clear-keychain':
      return 'clear keychain';
    case 'dismiss-overlay':
      return 'dismiss the React Native dev overlay';
    case 'screenshot':
      return `screenshot ${record.path}`;
    case 'act':
      return `act "${truncate(record.instruction, PROMPT_LIMIT)}"`;
    case 'extract':
      return `extract "${truncate(record.question, PROMPT_LIMIT)}"`;
    case 'tool':
      return record.target === undefined ? record.name : `${record.name} ${record.target}`;
    default: {
      const never: never = record;
      throw new Error(`unhandled action record ${JSON.stringify(never)}`);
    }
  }
}

function renderTyped(typed: Typed): string {
  switch (typed.kind) {
    case 'text':
      return `type "${truncate(typed.value, FILL_TEXT_LIMIT)}"`;
    case 'hidden':
      return `type ${String(typed.length)} characters`;
    default: {
      const never: never = typed;
      throw new Error(`unhandled typed value ${JSON.stringify(never)}`);
    }
  }
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

/** Discards everything. The default for scripts, unit tests, and runners with no reporting. */
export const silentSink: ActionSink = {
  step: (_title, body) => body(),
  attach: () => Promise.resolve(),
  note: () => {},
  outputPath: (fileName) => fileName,
};
