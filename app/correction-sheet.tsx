"use client";
import { useCallback, useEffect, useState } from "react";
import { createKeyer, load, post, type Reply } from "./assistant-client";
import ConfirmCard from "./confirm-card";
import { DirtyWhen, Sheet } from "./dialog";

export type Memory = { correctionId?: string | null; version: number; id: string; recordType: "event" | "transaction"; kind: string; title: string; detail: string; createdAt: string };
type HistoryEntry = { id: string; kind: "correction" | "undo"; status: "applied" | "undone"; reason: string | null; createdAt: string; original: Record<string, string | null> | null; recordType: string };

export const formatActivityDate = (value: string) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
};

/** Correct a recorded activity by describing the full corrected version; the original stays in history and can be undone. */
export default function CorrectionSheet({ item, onClose, onSaved }: { item: Memory; onClose: () => void; onSaved: (toast: string) => void }) {
  const [correction, setCorrection] = useState(item.detail);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [reply, setReply] = useState<Reply | null>(null);
  const [busy, setBusy] = useState<"save" | "undo" | "confirm" | null>(null);
  const [keyer] = useState(createKeyer);

  const fetchHistory = useCallback(() => {
    load(`/api/assistant?corrections=1&recordId=${encodeURIComponent(item.id)}`, "load this activity’s history").then((r) => { if (r.ok) { setHistory(r.data.corrections || []); setHistoryError(""); } else setHistoryError(r.reply.message); });
  }, [item.id]);
  useEffect(fetchHistory, [fetchHistory]);

  const save = async () => {
    if (!correction.trim() || busy) return;
    setBusy("save"); setReply(null);
    const payload = { id: item.id, recordType: item.recordType, version: item.version, correction: correction.trim() };
    const result = await post({ ...payload, requestKey: keyer.keyFor(payload) }, { action: "save that correction", kind: "write", inputKept: true }, "PATCH");
    setBusy(null);
    if (!result.ok) { setReply(result.reply); return; }
    if (result.data.outcome === "needs_confirmation") { setReply(result.data); return; }
    keyer.reset(); onSaved("Correction saved");
  };
  const undo = async () => {
    if (!item.correctionId || busy) return;
    setBusy("undo"); setReply(null);
    const payload = { correctionId: item.correctionId };
    const result = await post({ ...payload, requestKey: keyer.keyFor(payload) }, { action: "undo that correction", kind: "write" }, "DELETE");
    setBusy(null);
    if (!result.ok) { setReply(result.reply); return; }
    keyer.reset(); onSaved("Correction undone");
  };
  const confirm = async () => {
    const id = reply?.proposalId;
    if (!id || busy) return;
    setBusy("confirm");
    const result = await post({ confirmProposalId: id, requestKey: `confirm-${id}` }, { action: "save that correction", kind: "write", inputKept: true });
    setBusy(null);
    if (!result.ok) { setReply(result.reply); return; }
    onSaved("Correction saved");
  };
  const dismiss = async () => {
    const id = reply?.proposalId;
    setReply(null);
    if (id) await post({ rejectProposalId: id }, { action: "cancel that", kind: "read" }, "DELETE");
  };

  const needsConfirm = reply?.outcome === "needs_confirmation";
  return (
    <Sheet title={formatActivityDate(item.createdAt)} eyebrow="CORRECT ACTIVITY" onClose={onClose} className="captureSheet" footer={false}>
      <DirtyWhen when={correction !== item.detail} />
      <p className="correctionHelp">Describe the complete corrected version. The assistant will replace this activity and update its linked records. The original is kept in history and the correction can be undone.</p>
      <label className="srOnly" htmlFor="correction-text">Corrected version</label>
      <textarea id="correction-text" data-autofocus value={correction} onChange={(e) => setCorrection(e.target.value)} />
      {needsConfirm && reply && <ConfirmCard reply={reply} busy={busy === "confirm"} onYes={confirm} onNo={dismiss} />}
      {reply && !needsConfirm && <div className="reply failed" role="alert"><strong>{reply.title || "Correction not saved"}</strong><p>{reply.message}</p></div>}
      {busy && <p className="working" role="status">{busy === "undo" ? "Undoing…" : "Updating linked records…"}</p>}
      <button type="button" className="primary" disabled={!!busy || !correction.trim()} onClick={save}>{busy === "save" ? "Updating linked records…" : "Save correction"}</button>
      {item.correctionId && <button type="button" className="close" disabled={!!busy} onClick={undo}>Undo last correction</button>}
      {historyError && <div className="recError" role="alert"><p>{historyError}</p><button type="button" className="recSmall" onClick={fetchHistory}>Try again</button></div>}
      {history.length > 0 && (
        <div className="correctionHistory"><p className="eyebrow">HISTORY</p>
          {history.map((h) => <p key={h.id}>{formatActivityDate(h.createdAt)} — {h.kind === "undo" ? "Undone" : h.status === "undone" ? "Corrected (later undone)" : "Corrected"}{h.reason && h.kind === "correction" ? `: “${h.reason}”` : ""}{h.kind === "correction" && h.original ? ` · was: ${(h.original.event_type || h.original.description || "").toString().replaceAll("_", " ")}${h.original.notes ? ` — ${h.original.notes}` : ""}` : ""}</p>)}
        </div>
      )}
      <button type="button" className="close" onClick={onClose}>Cancel</button>
    </Sheet>
  );
}
