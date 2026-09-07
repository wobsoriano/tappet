import type { LanguageModel } from 'ai';

/**
 * The one key `act` and `extract` add to Playwright's `use`. It is not part of
 * `core/config.ts`, because nothing under `core/` may name an AI SDK type.
 *
 * A gateway model id such as `'anthropic/claude-sonnet-4.5'` and a provider
 * model instance are both `LanguageModel`, so a config picks either without a
 * second key. Unset is the default, and it fails at the first `act` rather than
 * at worker start, so a project that never calls one needs no model.
 */
export type AiOptions = { aiModel: LanguageModel | undefined };
