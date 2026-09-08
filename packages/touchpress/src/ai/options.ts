/**
 * What `use.aiModel` accepts, spelled structurally so the main entry's
 * declarations never import from `ai`. A gateway model id such as
 * `'anthropic/claude-sonnet-5'` and a provider model instance both fit, and
 * every AI SDK language model, v2 through v4, carries these three fields.
 */
export type AiModel =
  | string
  | {
      readonly specificationVersion: string;
      readonly provider: string;
      readonly modelId: string;
    };

/**
 * The one key `act` and `extract` add to Playwright's `use`. It is not part of
 * `core/config.ts`, because nothing under `core/` may name an AI SDK type.
 *
 * Unset is the default, and it fails at the first `act` rather than at worker
 * start, so a project that never calls one needs no model.
 */
export type AiOptions = { aiModel: AiModel | undefined };
