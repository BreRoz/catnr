import { digest } from "./reliability";
import { refuse } from "./responses";
import type { RequestBody } from "./types";

/** A request body that has passed the basic shape checks (the details are checked later, against the database). */
export type ParsedBody = { body: RequestBody; confirmId: string | null; clarifyId: string | null; sessionId: string | null };

export function parseBody(body: RequestBody, patch: boolean): ParsedBody | Response {
  if (!body || typeof body !== "object" || Array.isArray(body)) return refuse("Invalid request.", 400);
  const confirmId = !patch && body.confirmProposalId != null ? body.confirmProposalId : null;
  if (confirmId !== null && (typeof confirmId !== "string" || !confirmId)) return refuse("Invalid confirmation.", 400);
  const clarifyId = !patch && body.clarificationId != null ? body.clarificationId : null;
  if (clarifyId !== null && (typeof clarifyId !== "string" || !clarifyId || confirmId)) return refuse("Invalid answer.", 400);
  const sessionId = typeof body.sessionId === "string" && body.sessionId.length <= 100 ? body.sessionId : null;
  return { body, confirmId, clarifyId, sessionId };
}

/** The retry key (the client's, or else the content hash) and the hash that proves a retry is the same request. */
export async function retryIdentity(parsed: ParsedBody, patch: boolean): Promise<{ key: string; hash: string } | Response> {
  const { body, confirmId, clarifyId } = parsed;
  const content = JSON.stringify({
    method: patch ? "PATCH" : "POST",
    input: body.input,
    mode: body.mode,
    photoName: body.photoName,
    photoDataUrl: body.photoDataUrl,
    id: body.id,
    recordType: body.recordType,
    correction: body.correction,
    version: body.version,
    confirmProposalId: confirmId,
    clarificationId: clarifyId,
  });
  const hash = await digest(content);
  const key = body.requestKey || hash;
  if (typeof key !== "string" || key.length > 200) return Response.json({ message: "Invalid retry key." }, { status: 400 });
  return { key, hash };
}
