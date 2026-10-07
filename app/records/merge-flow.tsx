"use client";
import { useState } from "react";
import { useAction, useList, useRecord } from "./hooks";
import { Message, SearchBox, Sheet } from "./ui";

export type MergeType = "cat" | "person" | "colony";
type Candidate = { id: string; name?: string | null; displayName?: string };
type Preview = {
  survivor: { id: string; version: number; label: string }; duplicate: { id: string; version: number; label: string };
  blockers: string[]; canMerge: boolean; willFill: Array<{ field: string; value: unknown }>; conflicts: Array<{ field: string; kept: unknown; other: unknown }>;
  willMove: Record<string, number>; note: string;
};
const RESOURCE: Record<MergeType, string> = { cat: "cats", person: "people", colony: "colonies" };
const show = (v: unknown) => (v == null || v === "" ? "—" : String(v));
const pretty = (s: string) => s.replaceAll("_", " ");

/**
 * Merge two records. Ari picks which one to keep, sees exactly what will move and what differs, and
 * confirms. Nothing is deleted: the other record is archived and everything attached to it moves over.
 */
export default function MergeFlow({ type, record, other, onClose, onMerged }: { type: MergeType; record: { id: string; label: string }; other?: { id: string; label: string }; onClose: () => void; onMerged: () => void }) {
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(other ?? null);
  const [keepPicked, setKeepPicked] = useState(false); // false: keep `record`
  const search = useList<Candidate>(RESOURCE[type], { q: term, pageSize: 6 }, !picked);
  const survivor = picked ? (keepPicked ? picked : record) : null, merged = picked ? (keepPicked ? record : picked) : null;
  const preview = useRecord<Preview>("merges", { type, survivorId: survivor?.id, mergedId: merged?.id }, !!(survivor && merged));
  const action = useAction();
  const ready = survivor && merged && preview.data && !preview.error;

  const confirm = async () => {
    if (!preview.data) return;
    const result = await action.run("merges", { recordType: type, survivorId: preview.data.survivor.id, mergedId: preview.data.duplicate.id, survivorVersion: preview.data.survivor.version, mergedVersion: preview.data.duplicate.version, confirm: true });
    if (result) onMerged();
  };

  return (
    <Sheet title="Merge duplicates" eyebrow="NOTHING IS DELETED" onClose={onClose}>
      {!picked ? (
        <>
          <p className="recHint">Which {type} is the same as <strong>{record.label}</strong>?</p>
          <SearchBox value={term} onChange={setTerm} placeholder={`Search ${RESOURCE[type]}…`} />
          <ul className="recResults">
            {search.data?.items.filter((c) => c.id !== record.id).map((c) => <li key={c.id}><button type="button" onClick={() => setPicked({ id: c.id, label: c.displayName || c.name || "Unnamed" })}>{c.displayName || c.name || "Unnamed"}</button></li>)}
            {search.data && !search.data.items.filter((c) => c.id !== record.id).length && <li className="recEmpty">Nothing found</li>}
          </ul>
        </>
      ) : (
        <>
          <p className="recHint">Keep <strong>{survivor?.label}</strong>. Merge in <strong>{merged?.label}</strong>.</p>
          <button type="button" className="recLink" onClick={() => setKeepPicked((v) => !v)}>Keep {merged?.label} instead</button>
          {!other && <button type="button" className="recLink" onClick={() => { setPicked(null); setKeepPicked(false); }}>Choose a different one</button>}
          {preview.loading && <p className="recHint">Checking what would change…</p>}
          {preview.error && <Message error={preview.error} />}
          {ready && preview.data && (
            <div className="recPreview">
              {!!preview.data.blockers.length && <div className="recError" role="alert"><strong>These can’t be merged.</strong>{preview.data.blockers.map((b) => <p key={b}>{b}</p>)}</div>}
              <h3>Will move to {preview.data.survivor.label}</h3>
              <ul>{Object.entries(preview.data.willMove).map(([k, n]) => <li key={k}>{n} {pretty(k)}</li>)}</ul>
              {!!preview.data.willFill.length && <><h3>Details filled in from the other record</h3><ul>{preview.data.willFill.map((f) => <li key={f.field}>{pretty(f.field)}: {show(f.value)}</li>)}</ul></>}
              {!!preview.data.conflicts.length && <><h3>Different — the kept record wins</h3><ul>{preview.data.conflicts.map((c) => <li key={c.field}>{pretty(c.field)}: keeping “{show(c.kept)}”, other had “{show(c.other)}” (saved in the history)</li>)}</ul></>}
              <p className="recHint">{preview.data.note}</p>
              <Message error={action.error} notice={action.notice} />
              <button className="primary" disabled={action.busy || !preview.data.canMerge} onClick={confirm}>{action.busy ? "Merging…" : "Merge them"}</button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
