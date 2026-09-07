import { describeQuery, type Query } from './query.ts';
import type { ScrollDirection } from './driver.ts';

/** A file the runner should surface with the test result. */
export type EvidenceFile =
  | { readonly name: string; readonly path: string; readonly contentType: string }
  | { readonly name: string; readonly body: string; readonly contentType: string };

export type ActionRecord =
  | {
      readonly kind: 'open';
      readonly app: string;
      readonly device: string;
      readonly session: string;
    }
  | { readonly kind: 'tap'; readonly query: Query }
  | { readonly kind: 'long-press'; readonly query: Query; readonly durationMs: number }
  | { readonly kind: 'fill'; readonly query: Query; readonly text: string }
  | { readonly kind: 'scroll'; readonly direction: ScrollDirection }
  | { readonly kind: 'relaunch'; readonly app: string }
  | { readonly kind: 'dismiss-overlay' }
  | { readonly kind: 'screenshot'; readonly path: string };

/**
 * The runner port. A runner with no step concept calls `body()` directly and
 * drops attachments.
 *
 * Invariant: `step` invokes `body` exactly once and propagates its result and
 * its rejection unchanged. It reports, it never decides control flow.
 */
export type ActionSink = {
  step<T>(title: string, body: () => Promise<T>): Promise<T>;
  attach(file: EvidenceFile): Promise<void>;
  /** A key/value fact about the run, such as which device this worker bound to. */
  note(key: string, value: string): void;
  /** A unique path for this test and this retry attempt. */
  outputPath(fileName: string): string;
};

const FILL_TEXT_LIMIT = 40;

/** Step titles are rendered here rather than in an adapter so every runner produces the same text. */
export function renderTitle(record: ActionRecord): string {
  switch (record.kind) {
    case 'open':
      return `open ${record.app} on ${record.device} as ${record.session}`;
    case 'tap':
      return `tap ${describeQuery(record.query)}`;
    case 'long-press':
      return `longPress ${describeQuery(record.query)} for ${String(record.durationMs)}ms`;
    case 'fill':
      return `fill ${describeQuery(record.query)} with "${truncate(record.text)}"`;
    case 'scroll':
      return `scroll ${record.direction}`;
    case 'relaunch':
      return `relaunch ${record.app}`;
    case 'dismiss-overlay':
      return 'dismiss the React Native dev overlay';
    case 'screenshot':
      return `screenshot ${record.path}`;
    default: {
      const never: never = record;
      throw new Error(`unhandled action record ${JSON.stringify(never)}`);
    }
  }
}

function truncate(text: string): string {
  return text.length <= FILL_TEXT_LIMIT ? text : `${text.slice(0, FILL_TEXT_LIMIT)}...`;
}

/** Discards everything. The default for scripts, unit tests, and runners with no reporting. */
export const silentSink: ActionSink = {
  step: (_title, body) => body(),
  attach: () => Promise.resolve(),
  note: () => {},
  outputPath: (fileName) => fileName,
};
