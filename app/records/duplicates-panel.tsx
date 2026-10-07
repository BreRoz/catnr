"use client";
import { useState } from "react";
import { useAction, useList } from "./hooks";
import MergeFlow, { type MergeType } from "./merge-flow";
import { Message } from "./ui";

type Side = { id: string; label: string; details: string[]; richness: number };
type Pair = { recordType: MergeType; score: number; reasons: string[]; suggestedSurvivorId: string; a: Side; b: Side };
const LABEL: Record<MergeType, string> = { cat: "Cats", person: "People", colony: "Colonies" };

export default function DuplicatesPanel() {
  const [type, setType] = useState<MergeType>("cat");
  const [merging, setMerging] = useState<Pair | null>(null);
  const { data, loading, error, reload } = useList<Pair>("duplicates", { type });
  const pairs = (data as unknown as { pairs?: Pair[]; truncated?: boolean } | undefined);
  const dismiss = useAction();

  return (
    <section aria-label="Possible duplicates">
      <p className="recHint">These look like the same {type === "person" ? "person" : type}. Nothing is merged until you review it, and nothing is ever deleted.</p>
      <div className="recTabs" role="tablist">{(Object.keys(LABEL) as MergeType[]).map((t) => <button key={t} role="tab" aria-selected={type === t} className={type === t ? "active" : ""} onClick={() => setType(t)}>{LABEL[t]}</button>)}</div>
      <Message error={error || dismiss.error} />
      {loading && <p className="recHint">Looking for duplicates…</p>}
      <div className="recList">
        {pairs?.pairs?.map((p) => {
          const keep = p.suggestedSurvivorId === p.a.id ? p.a : p.b, other = keep === p.a ? p.b : p.a;
          return (
            <article key={`${p.a.id}-${p.b.id}`} className="recPair">
              <div className="recSides">{[p.a, p.b].map((s) => <div key={s.id}><strong>{s.label}</strong><small>{s.details.join(" · ") || "No details"}</small></div>)}</div>
              <p className="recHint">{p.reasons.join(" · ")} · {Math.round(p.score * 100)}% likely</p>
              <div className="recButtons">
                <button type="button" className="primary" onClick={() => setMerging(p)}>Review &amp; merge</button>
                <button type="button" className="recSecondary" disabled={dismiss.busy} onClick={async () => { if (await dismiss.run("duplicates", { action: "dismiss", recordType: p.recordType, aId: p.a.id, bId: p.b.id })) reload(); }}>Not the same</button>
              </div>
              <small className="recHint">Suggested: keep “{keep.label}” and merge in “{other.label}”.</small>
            </article>
          );
        })}
        {pairs?.pairs && !pairs.pairs.length && !loading && <p className="recEmpty">No likely duplicates. 🎉</p>}
      </div>
      {pairs?.truncated && <p className="recHint">Only the first 3,000 records were checked.</p>}
      {merging && (() => {
        const keep = merging.suggestedSurvivorId === merging.a.id ? merging.a : merging.b, other = keep === merging.a ? merging.b : merging.a;
        return <MergeFlow type={merging.recordType} record={{ id: keep.id, label: keep.label }} other={{ id: other.id, label: other.label }} onClose={() => setMerging(null)} onMerged={() => { setMerging(null); reload(); }} />;
      })()}
    </section>
  );
}
