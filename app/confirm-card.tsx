"use client";
import type { Reply } from "./assistant-client";

/** The assistant wants a yes/no before it saves anything consequential. Nothing is saved until Ari says yes. */
export default function ConfirmCard({ reply, busy, onYes, onNo }: { reply: Reply; busy: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <div className="reply clarify" role="group" aria-label="Please confirm">
      <strong>Please confirm — nothing is saved yet</strong>
      <p>{reply.message}</p>
      <button type="button" className="primary" disabled={busy} onClick={onYes}>{busy ? "Saving…" : "Yes, save it"}</button>
      <button type="button" className="close" disabled={busy} onClick={onNo}>No, don’t change anything</button>
    </div>
  );
}
