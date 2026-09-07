import type { FlexibleSchema, LanguageModel, ToolSet } from 'ai';
import type { Device } from '../core/device.ts';
import { TouchpressError } from '../core/errors.ts';
import type { ActionSink } from '../core/report.ts';
import { renderScreen } from '../core/screen.ts';
import type { DeviceSession } from '../core/session.ts';
import { runAct, runExtract } from './act.ts';
import { createDeviceTools } from './tools.ts';

const DEFAULT_ACT_TIMEOUT_MS = 120_000;
const DEFAULT_ACT_STEPS = 25;
const DEFAULT_EXTRACT_TIMEOUT_MS = 60_000;

/** A loop can run for minutes, so its budget is its own rather than the action timeout a deterministic step takes. */
export type ActOptions = { timeout?: number; maxSteps?: number };
export type ExtractOptions = { timeout?: number };

export type AiDevice = {
  /**
   * Drives the app with a model until the instruction is satisfied. Resolves
   * with the model's summary of what it did, and throws when the model reports
   * it could not proceed or runs out of steps.
   */
  act(instruction: string, options?: ActOptions): Promise<string>;
  /** Asks a model one question about the current screen and validates the answer against `schema`. */
  extract<T>(question: string, schema: FlexibleSchema<T>, options?: ExtractOptions): Promise<T>;
};

/**
 * Adds `act` and `extract` to a device without touching what is already there.
 *
 * Both run inside `session.run`, so the whole loop holds the session queue. A
 * test body is sequential anyway, and the model's snapshot refs carry the same
 * rule every deterministic action does: they are valid for the next command
 * only, so nothing else may reach the device in between.
 */
export function withAi(
  device: Device,
  session: DeviceSession,
  sink: ActionSink,
  model: LanguageModel | undefined,
): Device & AiDevice {
  let acts = 0;
  let built: Promise<ToolSet> | null = null;
  const tools = (): Promise<ToolSet> =>
    (built ??= createDeviceTools(session.name, session.options.platform));

  return {
    ...device,
    act: async (instruction, options) => {
      const configured = configuredModel(model);
      const deviceTools = await tools();
      return session.run((one) =>
        runAct({
          model: configured,
          tools: deviceTools,
          sink,
          instruction,
          platform: session.options.platform,
          maxSteps: options?.maxSteps ?? DEFAULT_ACT_STEPS,
          timeout: options?.timeout ?? DEFAULT_ACT_TIMEOUT_MS,
          screen: async () => renderScreen(await one.capture()),
          attempt: (acts += 1),
        }),
      );
    },
    extract: async (question, schema, options) => {
      const configured = configuredModel(model);
      return await session.run(async (one) =>
        runExtract({
          model: configured,
          screen: renderScreen(await one.capture()),
          question,
          schema,
          sink,
          timeout: options?.timeout ?? DEFAULT_EXTRACT_TIMEOUT_MS,
        }),
      );
    },
  };
}

/** Checked before the queue, so a project that forgot the key fails at once rather than holding the session. */
function configuredModel(model: LanguageModel | undefined): LanguageModel {
  if (model === undefined) throw new TouchpressError({ kind: 'ai-not-configured' });
  return model;
}
