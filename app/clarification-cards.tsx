"use client";
import { useState } from "react";

export type PendingClarification = { id: string; originalText: string; question: string; candidates: string[]; hasPhoto: boolean; attempts: number; createdAt: string };

// Each open question has its own answer box, so an answer is always sent for exactly one question.
export default function ClarificationCards({ items, sessionId, onChanged }: { items: PendingClarification[]; sessionId: string; onChanged: () => Promise<void> | void }) {
 const [answers, setAnswers] = useState<Record<string, string>>({});
 const [busy, setBusy] = useState<string | null>(null);
 const [notes, setNotes] = useState<Record<string, string>>({});
 const note = (id: string, message: string) => setNotes(n => ({ ...n, [id]: message }));
 const answer = async (item: PendingClarification) => {
  const text = (answers[item.id] || "").trim();
  if (!text) return;
  setBusy(item.id);
  try {
   const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clarificationId: item.id, input: text, sessionId, requestKey: `clarify-${item.id}-${text}` }) });
   const data = await r.json();
   if (r.ok && !data.clarification) setAnswers(a => ({ ...a, [item.id]: "" }));
   if (!r.ok || data.clarification || data.outcome === "needs_confirmation") note(item.id, data.message);
   await onChanged();
  } catch {
   note(item.id, "The connection failed, so I can’t confirm whether that saved. Tap Send again to check safely.");
  } finally { setBusy(null) }
 };
 const cancel = async (item: PendingClarification) => {
  setBusy(item.id);
  try { await fetch("/api/assistant", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ cancelClarificationId: item.id }) }) } catch { /* It expires on its own. */ }
  setBusy(null);
  await onChanged();
 };
 if (!items.length) return null;
 return (
  <section className="pendingQuestions" aria-label="Questions waiting for your answer">
   <h3>{items.length === 1 ? "One question for you" : `${items.length} questions for you`}</h3>
   {items.map(item => (
    <article key={item.id} className="reply clarify">
     <p className="was">You said: “{item.originalText}”{item.hasPhoto ? " (with a photo)" : ""}</p>
     <strong>{item.question}</strong>
     {item.candidates.length > 0 && <ul>{item.candidates.map(c => <li key={c}>{c}</li>)}</ul>}
     {notes[item.id] && <p role="status">{notes[item.id]}</p>}
     <label className="srOnly" htmlFor={`answer-${item.id}`}>Your answer</label>
     <input id={`answer-${item.id}`} value={answers[item.id] || ""} placeholder="Your answer…" disabled={busy === item.id} onChange={e => setAnswers(a => ({ ...a, [item.id]: e.target.value }))} onKeyDown={e => { if (e.key === "Enter") void answer(item) }} />
     <button className="primary" disabled={busy === item.id || !(answers[item.id] || "").trim()} onClick={() => void answer(item)}>Send answer</button>
     <button className="close" disabled={busy === item.id} onClick={() => void cancel(item)}>Never mind — drop this</button>
    </article>
   ))}
  </section>
 );
}
