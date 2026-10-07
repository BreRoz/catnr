import { describeFailure, type Failure } from "./feedback";

// Calls to /api/assistant from the home screen. Every failure comes back as a Reply that already says what
// failed, whether it saved and what to do next, so the screens never have to invent "Something went wrong".

export type Reply = { message: string; title?: string; clarification?: string; outcome?: string; proposalId?: string; reasons?: string[]; created?: unknown[]; updated?: unknown[] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the success body varies by request type
export type CallResult = { ok: true; data: Reply & Record<string, any> } | { ok: false; reply: Reply; failure: Failure };

const WRITE_TIMEOUT_MS = 70000; // longer than the server's 45 s AI limit, so the server's own message wins
const READ_TIMEOUT_MS = 30000;

type Options = { action: string; kind: "read" | "write"; inputKept?: boolean };

async function run(url: string, init: RequestInit, o: Options): Promise<CallResult> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(o.kind === "write" ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS) });
  } catch (e) {
    return fail(describeFailure({ ...o, network: true, timedOut: e instanceof DOMException && e.name === "TimeoutError" }), undefined);
  }
  const data = await response.json().catch(() => null);
  if (response.ok && data) return { ok: true, data };
  return fail(describeFailure({ ...o, status: response.status, outcome: data?.outcome, message: data?.message, unreadable: !data }), data?.outcome);
}

const fail = (failure: Failure, outcome: string | undefined): CallResult => ({
  ok: false, failure,
  reply: { title: failure.title, message: failure.message, outcome: failure.saved === "unknown" ? "uncertain" : outcome ?? "failed" },
});

export const load = (url: string, action: string) => run(url, { headers: { accept: "application/json" } }, { action, kind: "read" });

export const post = (payload: Record<string, unknown>, o: Options, method: "POST" | "PATCH" | "DELETE" = "POST") =>
  run("/api/assistant", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }, o);

/** One retry key per distinct request: retrying the same request reuses it (so a lost response can't duplicate), changing it starts fresh. */
export function createKeyer() {
  let last: { signature: string; key: string } | null = null;
  return {
    keyFor(payload: unknown) {
      const signature = JSON.stringify(payload);
      if (last?.signature !== signature) last = { signature, key: crypto.randomUUID() };
      return last.key;
    },
    reset() { last = null; },
  };
}
