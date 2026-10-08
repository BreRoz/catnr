import { display } from "./cats";
import type { AgentPlan, Snapshot } from "./types";

// What the assistant can do with no AI provider at all: a handful of simple questions, and notes about a cat that
// Ari names unambiguously. Anything else is kept word for word and Ari is told the interpreter is needed.

const blank = (): AgentPlan => ({
  intent: "record",
  message: "Recorded your update.",
  clarification: null,
  confidence: 0.7,
  cats: [],
  events: [],
  people: [],
  transactions: [],
  query: { kind: "none", catId: null, status: null, year: null, search: null },
  socialDraft: null,
});

// [word Ari might use, event type it records]
const EVENT_KEYWORDS: [string, string][] = [
  ["spay", "spay"],
  ["neuter", "neuter"],
  ["rabies", "vaccination: rabies"],
  ["fvrcp", "vaccination: FVRCP"],
  ["adopt", "adoption"],
  ["foster", "foster"],
  ["vet", "vet_visit"],
  ["sick", "illness"],
  ["injur", "injury"],
];

const yearIn = (text: string) => Number(text.match(/20\d{2}/)?.[0] || new Date().getUTCFullYear());

function simpleQuestion(plan: AgentPlan, lower: string): AgentPlan | null {
  if (/waiting for adoption|available for adoption/.test(lower)) {
    plan.query.kind = "cats_by_status";
    plan.query.status = "available for adoption";
    return plan;
  }
  if (/income|expenses|money came|money spent/.test(lower)) {
    plan.query.kind = "income_expenses";
    plan.query.year = yearIn(lower);
    return plan;
  }
  if (/how many cats|impact/.test(lower)) {
    plan.query.kind = "impact";
    plan.query.year = yearIn(lower);
    return plan;
  }
  if (/need.*(surgery|spay|neuter)/.test(lower)) {
    plan.query.kind = "cats_needing_surgery";
    return plan;
  }
  return null;
}

export function fallbackPlan(input: string, mode: string, data: Snapshot): AgentPlan {
  const plan = blank();
  const lower = input.toLowerCase();
  if (mode === "ask" || /^(which|what|how many|show|give me|where)/i.test(input)) {
    plan.intent = "query";
    const answered = simpleQuestion(plan, lower);
    if (answered) return answered;
  }
  const matches = data.cats.filter((c) =>
    [c.name, c.appearance, c.sex, c.age_class, c.distinguishing_characteristics, c.origin]
      .filter(Boolean)
      .some((v) => lower.includes(String(v).toLowerCase())),
  );
  if (matches.length === 1) {
    const cat = matches[0];
    const types = EVENT_KEYWORDS.filter(([word]) => lower.includes(word)).map(([, type]) => type);
    plan.events = (types.length ? types : ["observation"]).map((eventType) => ({
      catRef: cat.id,
      eventType,
      occurredAt: null,
      location: null,
      personName: null,
      notes: input,
    }));
    plan.cats = [
      {
        ref: cat.id,
        existingId: cat.id,
        name: null,
        sex: null,
        ageClass: null,
        appearance: null,
        distinguishingCharacteristics: null,
        healthObservations: null,
        reproductiveSignificance: null,
        origin: null,
        currentStatus: lower.includes("adopt") ? "adopted" : lower.includes("foster") ? "foster" : null,
        currentLocation: null,
        microchipNumber: null,
      },
    ];
    return plan;
  }
  return {
    ...plan,
    intent: "clarify",
    confidence: 0.2,
    clarification:
      matches.length > 1
        ? `I found ${matches.length} possible cats. Which one do you mean: ${matches.slice(0, 4).map(display).join(", ")}?`
        : "I preserved your words, but I need the AI interpreter connected before I can safely structure this update.",
  };
}
