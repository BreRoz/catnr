import { CAT_STATUSES } from "../../vocabulary";
import { OPENAI_URL, OPENROUTER_URL, aiConfigured, type AiConfig } from "../../config";
import { checkAi } from "../../ops/limits";
import { finishEvent, recordEvent } from "../../ops/log";
import { fallbackPlan } from "./fallback";
import { now } from "./ids";
import { planSchema } from "./plan-schema";
import { AiLimited, AiUnavailable, providerFetch } from "./reliability";
import {
  AGE_CLASSES,
  CURRENCIES,
  EVENT_TYPES,
  PERSON_TYPES,
  PlanRejected,
  SEXES,
  TRANSACTION_TYPES,
  parseProviderJson,
} from "./validation";
import type { D1, Snapshot } from "./types";

/** What the interpreter is told. The safety rules are enforced again, in code, by validation.ts; this only steers it. */
export function buildInstructions(): string {
  return [
    "You are Ari's careful cat TNR/rescue record assistant.",
    "Convert natural language into the provided action-plan schema.",
    `Today is ${now().slice(0, 10)}.`,
    "Use existing IDs only when clues strongly identify exactly one stored record.",
    "If multiple cats plausibly match for medical, adoption, disappearance, death, or disposition changes, return intent=clarify, a concise question, and no mutations.",
    "Never invent facts, names, amounts, dates, medical procedures, or relationships.",
    "Never infer surgery status: record surgery_needed only when told the cat still needs spay/neuter, previously_sterilized only when told it is already fixed (e.g. ear-tipped), and spay/neuter only for surgery that happened; if surgery history is not stated, record nothing about it.",
    "Preserve changing conditions as events; use cat fields for stable/current attributes.",
    "A single input may create multiple cats, events, people, and transactions.",
    "Give each new cat a temporary ref and point its events to that ref.",
    "For an existing cat use its stored ID as ref and existingId.",
    "For questions choose a query kind and exact cat ID when needed; never create records.",
    "For social requests draft only from stored facts.",
    `Normalize event types (${EVENT_TYPES.join(", ")}).`,
    `Allowed values (anything else is rejected): sex ${SEXES.join("/")}; ageClass ${AGE_CLASSES.join("/")}; transactionType ${TRANSACTION_TYPES.join("/")}; person type ${PERSON_TYPES.join("/")}; currency ${CURRENCIES.join("/")}; dates must be real ISO dates (YYYY-MM-DD) or null; amounts positive with at most two decimals.`,
    "Never include fields outside the schema.",
    "For deleting, merging cats, or changing ownership, return intent=clarify (these are not supported).",
    `Valid statuses: ${[...CAT_STATUSES].join(", ")}.`,
  ].join(" ");
}

const userText = (mode: string, input: string, data: Snapshot) =>
  `Mode: ${mode}\nUser input: ${input}\nStored records: ${JSON.stringify(data)}`;

async function viaOpenRouter(config: AiConfig, input: string, mode: string, data: Snapshot, photo?: string): Promise<unknown> {
  const content: Record<string, unknown>[] = [{ type: "text", text: userText(mode, input, data) }];
  if (photo) content.push({ type: "image_url", image_url: { url: photo } });
  const url = config.environment === "e2e" && config.testBaseUrl ? config.testBaseUrl : OPENROUTER_URL;
  const response = await providerFetch(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openRouterKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/BreRoz/catnr",
        "X-OpenRouter-Title": "TNR Assistant",
      },
      body: JSON.stringify({
        model: config.openRouterModel,
        messages: [
          { role: "system", content: buildInstructions() },
          { role: "user", content },
        ],
        response_format: { type: "json_schema", json_schema: { name: "rescue_action_plan", strict: true, schema: planSchema } },
        provider: { require_parameters: true },
      }),
    },
    "OpenRouter",
  );
  const result = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  return parseProviderJson(result.choices?.[0]?.message?.content);
}

async function viaOpenAI(config: AiConfig, input: string, mode: string, data: Snapshot, photo?: string): Promise<unknown> {
  const content: Record<string, unknown>[] = [{ type: "input_text", text: userText(mode, input, data) }];
  if (photo) content.push({ type: "input_image", image_url: photo, detail: "low" });
  const response = await providerFetch(
    OPENAI_URL,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${config.openAIKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.openAIModel,
        instructions: buildInstructions(),
        input: [{ role: "user", content }],
        text: { format: { type: "json_schema", name: "rescue_action_plan", strict: true, schema: planSchema } },
      }),
    },
    "OpenAI",
  );
  const result = (await response.json()) as { output?: { content?: { type: string; text?: string }[] }[] };
  const text = result.output?.flatMap((x) => x.content || []).find((x) => x.type === "output_text")?.text;
  return parseProviderJson(text);
}

/** Asks the configured provider (OpenRouter first, then OpenAI); with no key, uses the built-in simple fallback. */
export async function callAgent(config: AiConfig, input: string, mode: string, data: Snapshot, photo?: string): Promise<unknown> {
  if (!aiConfigured(config)) return fallbackPlan(input, mode, data);
  return config.openRouterKey ? viaOpenRouter(config, input, mode, data, photo) : viaOpenAI(config, input, mode, data, photo);
}

/**
 * Every provider call goes through here: it enforces the usage limits and the emergency switch, records the attempt
 * BEFORE calling (so a crash or a loop is still counted), and records how it ended. No rescue content is logged.
 */
export async function monitoredAgent(
  db: D1,
  config: AiConfig,
  owner: string,
  input: string,
  mode: string,
  data: Snapshot,
  photo?: string,
): Promise<unknown> {
  const gate = await checkAi(db, owner, config.disabled);
  if (!gate.ok) {
    await recordEvent(db, { kind: "limit_hit", owner, route: "/api/assistant", status: gate.status, detail: gate.detail });
    // Switched off on purpose: behave exactly as when no provider is configured (simple text and questions still work).
    if (gate.kind === "disabled") return fallbackPlan(input, mode, data);
    throw new AiLimited(gate.message, gate.status);
  }
  if (!aiConfigured(config)) return callAgent(config, input, mode, data, photo);
  const id = await recordEvent(db, { kind: "ai_call", owner, route: "/api/assistant", detail: photo ? "text+photo" : "text" });
  const started = Date.now();
  try {
    const plan = await callAgent(config, input, mode, data, photo);
    await finishEvent(db, id, Date.now() - started, 200);
    return plan;
  } catch (error) {
    const unreachable = error instanceof AiUnavailable;
    await finishEvent(db, id, Date.now() - started, unreachable ? 502 : 422);
    // An answer that fails validation is recorded once, by the request's own error handler.
    if (error instanceof PlanRejected) throw error;
    await recordEvent(db, {
      kind: unreachable ? "ai_failure" : "ai_invalid",
      owner,
      route: "/api/assistant",
      durationMs: Date.now() - started,
      detail: error,
    });
    throw error;
  }
}
