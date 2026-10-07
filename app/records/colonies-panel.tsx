"use client";
import { useState } from "react";
import { useAction, useList, useRecord } from "./hooks";
import MergeFlow from "./merge-flow";
import { Message, Pager, RecordForm, SearchBox, Sheet, when, type FieldDef, type Values } from "./ui";

type Colony = { id: string; version: number; name: string; generalLocation: string | null; notes: string | null; status: string; latitude: number | null; longitude: number | null; archivedAt: string | null; mergedInto: string | null; catCount: number };
type Detail = { colony: Colony; cats: Array<{ id: string; displayName: string; currentStatus: string }>; money: Array<{ direction: string; currency: string; minor: number }>; changes: Array<{ id: string; action: string; reason: string | null; createdAt: string }>; mergedFrom: Array<{ colonyId: string; name: string }> };

const FIELDS: FieldDef[] = [
  { key: "name", label: "Name", required: true, placeholder: "Jefferson Ave colony" },
  { key: "generalLocation", label: "Where is it?", placeholder: "Address or cross streets" },
  { key: "latitude", label: "Latitude (optional)", type: "number", placeholder: "40.7128" },
  { key: "longitude", label: "Longitude (optional)", type: "number", placeholder: "-74.0060" },
  { key: "status", label: "Status", type: "select", required: true, options: [["active", "Active"], ["inactive", "Inactive"]] },
  { key: "notes", label: "Notes", type: "textarea", placeholder: "Feeding schedule, caretaker, access…" },
];
const toValues = (c?: Colony): Values => ({ name: c?.name ?? "", generalLocation: c?.generalLocation ?? "", latitude: c?.latitude == null ? "" : String(c.latitude), longitude: c?.longitude == null ? "" : String(c.longitude), status: c?.status ?? "active", notes: c?.notes ?? "" });

export default function ColoniesPanel() {
  const [q, setQ] = useState(""), [archived, setArchived] = useState("active"), [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null), [adding, setAdding] = useState(false);
  const { data, loading, error, reload } = useList<Colony>("colonies", { q, archived, page, pageSize: 25 });
  const add = useAction();
  return (
    <section aria-label="Colonies">
      <div className="recToolbar">
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search colonies and locations…" />
        <div className="recFilters"><select className="recSelect" aria-label="Show" value={archived} onChange={(e) => { setArchived(e.target.value); setPage(1); }}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select></div>
        <button className="primary" onClick={() => { setAdding(true); add.clear(); }}>+ Add a colony</button>
      </div>
      <Message error={error} />
      <div className="recList" aria-busy={loading}>
        {data?.items.map((c) => (
          <button key={c.id} type="button" className="recItem" onClick={() => setOpen(c.id)}>
            <span className="recAvatar">⌂</span>
            <span className="recText"><strong>{c.name}</strong><small>{[c.generalLocation, c.status === "inactive" ? "inactive" : null].filter(Boolean).join(" · ")}</small></span>
            <span className="recMeta">{c.archivedAt ? (c.mergedInto ? "Merged" : "Archived") : `${c.catCount} cats`}</span>
          </button>
        ))}
        {data && !data.items.length && <p className="recEmpty">{q ? "No colonies match that search." : "No colonies yet."}</p>}
      </div>
      <Pager page={data} onPage={setPage} />
      {adding && (
        <Sheet title="Add a colony" eyebrow="NEW COLONY" onClose={() => setAdding(false)}>
          <RecordForm fields={FIELDS} initial={toValues()} submitLabel="Add colony" busy={add.busy} onSubmit={async (v) => { const r = await add.run<{ id: string }>("colonies", { colony: v }); if (r) { setAdding(false); reload(); setOpen(r.id); } }} />
          <Message error={add.error} />
        </Sheet>
      )}
      {open && <ColonySheet id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </section>
  );
}

function ColonySheet({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, error, reload } = useRecord<Detail>("colonies", { id });
  const [mode, setMode] = useState<"view" | "edit" | "merge">("view");
  const act = useAction();
  const refresh = () => { reload(); onChanged(); };
  const c = data?.colony;
  if (!c) return <Sheet title="Colony" onClose={onClose}><Message error={error} />{!error && <p className="recHint">Loading…</p>}</Sheet>;
  const archived = !!c.archivedAt;
  const save = async (v: Values) => {
    const now = toValues(c), changes: Record<string, string | null> = {};
    for (const k of Object.keys(v)) if (v[k] !== now[k]) changes[k] = v[k] === "" ? null : v[k];
    if (!Object.keys(changes).length) { setMode("view"); return; }
    if (await act.run("colonies", { action: "update", id, version: c.version, changes }, "PATCH")) { setMode("view"); refresh(); }
  };
  return (
    <Sheet title={c.name} eyebrow={archived ? (c.mergedInto ? "MERGED INTO ANOTHER COLONY" : "ARCHIVED") : "COLONY"} onClose={onClose}>
      <Message error={act.error} notice={act.notice} />
      {mode === "edit" ? <RecordForm fields={FIELDS} initial={toValues(c)} submitLabel="Save changes" busy={act.busy} onSubmit={save} onCancel={() => setMode("view")} /> : (
        <>
          <dl className="recFacts">
            {([["Location", c.generalLocation], ["Map pin", c.latitude != null ? `${c.latitude}, ${c.longitude}` : null], ["Status", c.status], ["Notes", c.notes]] as Array<[string, string | null]>).filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          {data.mergedFrom.length > 0 && <p className="recHint">Includes {data.mergedFrom.map((m) => m.name).join(", ")}, merged in.</p>}
          <h3>Cats from here ({c.catCount})</h3>
          <ul className="recLog">{data.cats.map((k) => <li key={k.id}>{k.displayName} — {k.currentStatus}</li>)}{!data.cats.length && <li>No cats recorded.</li>}</ul>
          <h3>Change log</h3>
          <ul className="recLog">{data.changes.map((x) => <li key={x.id}>{when(x.createdAt)} — {x.action.replaceAll("_", " ")}{x.reason ? ` (${x.reason})` : ""}</li>)}</ul>
          <div className="recButtons">
            {!archived && <button className="primary" onClick={() => setMode("edit")}>Edit colony</button>}
            {!archived && <button type="button" className="recSecondary" onClick={() => setMode("merge")}>Merge with a duplicate…</button>}
            {!(archived && c.mergedInto) && <button type="button" className="recSecondary" disabled={act.busy} onClick={async () => { if (await act.run("colonies", { action: archived ? "restore" : "archive", id })) refresh(); }}>{archived ? "Restore colony" : "Archive colony"}</button>}
          </div>
        </>
      )}
      {mode === "merge" && <MergeFlow type="colony" record={{ id, label: c.name }} onClose={() => setMode("view")} onMerged={() => { setMode("view"); refresh(); }} />}
    </Sheet>
  );
}
