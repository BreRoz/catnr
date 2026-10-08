// Bindings and secrets that wrangler.jsonc does not declare (secrets are set with `wrangler secret put`,
// the photo bucket is optional). Merged into the generated Cloudflare.Env from `wrangler types`.
declare namespace Cloudflare {
  interface Env {
    OPENROUTER_API_KEY?: string;
    OPENROUTER_MODEL?: string;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    PHOTOS?: R2Bucket;
    // Only honoured when ENVIRONMENT is "e2e": points the AI call at the scripted fake provider used by the browser tests.
    AI_TEST_BASE_URL?: string;
  }
}
