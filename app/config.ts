/**
 * Configuration read from the Worker environment, in one place. Bindings come from wrangler.jsonc; secrets are set
 * with `wrangler secret put` (see README). Nothing else in the app should read the AI settings from `env` directly.
 */
export type AiConfig = {
  openRouterKey: string | undefined;
  openAIKey: string | undefined;
  openRouterModel: string;
  openAIModel: string;
  /** Only honoured when `environment` is "e2e": the scripted fake provider used by the browser tests. */
  testBaseUrl: string | undefined;
  environment: string | undefined;
  /** Emergency switch: any non-empty value turns the AI off (see docs/RUNBOOK.md). */
  disabled: string | undefined;
};

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const OPENAI_URL = "https://api.openai.com/v1/responses";

export function aiConfig(env: Cloudflare.Env): AiConfig {
  const vars = env as unknown as Record<string, string | undefined>;
  return {
    openRouterKey: vars.OPENROUTER_API_KEY,
    openAIKey: vars.OPENAI_API_KEY,
    openRouterModel: vars.OPENROUTER_MODEL || "openai/gpt-5-mini",
    openAIModel: vars.OPENAI_MODEL || "gpt-5-mini",
    testBaseUrl: vars.AI_TEST_BASE_URL,
    environment: vars.ENVIRONMENT,
    disabled: vars.AI_DISABLED,
  };
}

/** True when a provider key is present (the AI may still be switched off or over its limit). */
export const aiConfigured = (config: AiConfig) => !!(config.openRouterKey || config.openAIKey);
