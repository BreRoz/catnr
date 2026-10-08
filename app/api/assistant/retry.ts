import { receipt, writeFailure } from "./reliability";
import type { D1 } from "./types";

// A write is identified by a retry key and a hash of its content (see reliability.ts), so a retried request —
// after a dropped connection, say — gets the original answer instead of being applied twice.
export type RetryState = { key: string; hash: string; commitAttempted: boolean };

export const newRetryState = (): RetryState => ({ key: "", hash: "", commitAttempted: false });

/** After an error: the request may still have committed (lost response, competing retry), so look for its receipt first. */
export async function recoverOrFail(db: D1, owner: string, retry: RetryState, error: unknown): Promise<Response> {
  if (retry.key && retry.hash) {
    try {
      const saved = await receipt(db, owner, retry.key, retry.hash);
      if (saved) return saved;
    } catch {
      /* The receipt lookup is unavailable; retain the retry key and input. */
    }
  }
  return writeFailure(error, retry.commitAttempted);
}
