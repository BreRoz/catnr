"use client";
import { useState } from "react";
import { photoUrl } from "./api";
import { useAction, useList, useRecord } from "./hooks";
import MergeFlow from "./merge-flow";
import PhotoGallery from "./photo-gallery";
import { LoadingNote, Message, Pager, RecordForm, SearchBox, Select, Sheet, titleCase, when, type FieldDef, type Values } from "./ui";

export const CAT_STATUSES = ["observed", "captured", "awaiting vet", "recovering", "foster", "available for adoption", "adoption pending", "adopted", "returned to colony", "lost", "deceased"];
const EVENT_TYPES = ["first_seen", "captured", "intake", "transport", "vet_visit", "spay", "neuter", "vaccination", "testing", "medication", "illness", "injury", "observation", "foster", "adoption_interest", "application", "meet_and_greet", "adoption", "returned_to_colony", "lost", "deceased", "other"];
const opts = (list: string[]): Array<[string, string]> => list.map((v) => [v, titleCase(v)]);

type CatRow = { id: string; version: number; displayName: string; name: string | null; sex: string | null; ageClass: string | null; appearance: string | null; distinguishingCharacteristics: string | null; healthObservations: string | null; reproductiveSignificance: string | null; originColonyId: string | null; colonyName: string | null; currentStatus: string; currentLocation: string | null; microchipNumber: string | null; archivedAt: string | null; archiveReason: string | null; mergedInto: string | null; eventCount: number; photoCount: number; leadPhotoId: string | null };
type CatDetail = {
  cat: CatRow;
  events: Array<{ id: string; version: number; eventType: string; occurredAt: string; location: string | null; notes: string | null; personId: string | null; personName: string | null; photoCount: number }>;
  eventsPaging: { total: number; page: number; pages: number };
  changes: Array<{ id: string; action: string; reason: string | null; createdAt: string; mergeId: string | null }>;
  mergedFrom: Array<{ mergeId: string; catId: string; displayName: string; mergedAt: string }>;
};

const CAT_FIELDS: FieldDef[] = [
  { key: "name", label: "Name (optional)", placeholder: "Leave blank if unnamed" },
  { key: "sex", label: "Sex", type: "select", options: [["female", "Female"], ["male", "Male"], ["unknown", "Unknown"]] },
  { key: "ageClass", label: "Age", type: "select", options: opts(["kitten", "juvenile", "adult", "senior", "unknown"]) },
  { key: "appearance", label: "Appearance", placeholder: "Gray tabby, white paws…" },
  { key: "distinguishingCharacteristics", label: "Distinguishing marks", placeholder: "Torn left ear, kinked tail…" },
  { key: "currentStatus", label: "Status", type: "select", required: true, options: opts(CAT_STATUSES) },
  { key: "originColonyId", label: "Colony", type: "picker", resource: "colonies" },
  { key: "currentLocation", label: "Where is the cat now?" },
  { key: "microchipNumber", label: "Microchip" },
  { key: "healthObservations", label: "Health notes", type: "textarea" },
  { key: "reproductiveSignificance", label: "Reproductive notes", type: "textarea" },
];
const toValues = (c?: CatRow): Values => ({
  name: c?.name ?? "", sex: c?.sex ?? "", ageClass: c?.ageClass ?? "", appearance: c?.appearance ?? "", distinguishingCharacteristics: c?.distinguishingCharacteristics ?? "",
  currentStatus: c?.currentStatus ?? "observed", originColonyId: c?.originColonyId ?? "", currentLocation: c?.currentLocation ?? "", microchipNumber: c?.microchipNumber ?? "",
  healthObservations: c?.healthObservations ?? "", reproductiveSignificance: c?.reproductiveSignificance ?? "",
});

export default function CatsPanel() {
  const [q, setQ] = useState(""), [status, setStatus] = useState(""), [sex, setSex] = useState(""), [archived, setArchived] = useState("active"), [hasPhoto, setHasPhoto] = useState(""), [sort, setSort] = useState("updated"), [page, setPage] = useState(1);
  const [colonyId, setColonyId] = useState("");
  const [open, setOpen] = useState<string | null>(null), [adding, setAdding] = useState(false);
  const colonies = useList<{ id: string; name: string }>("colonies", { pageSize: 100 });
  const { data, loading, error, reload } = useList<CatRow>("cats", { q, status, sex, colonyId, archived, hasPhoto, sort, page, pageSize: 25 });
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const add = useAction();

  return (
    <section aria-label="Cats">
      <div className="recToolbar">
        <SearchBox value={q} onChange={reset(setQ)} placeholder="Search name, description, chip, colony…" />
        <div className="recFilters">
          <Select label="Any status" value={status} onChange={reset(setStatus)} options={opts(CAT_STATUSES)} />
          <Select label="Any colony" value={colonyId} onChange={reset(setColonyId)} options={[["none", "No colony"], ...(colonies.data?.items.map((c): [string, string] => [c.id, c.name]) ?? [])]} />
          <Select label="Any sex" value={sex} onChange={reset(setSex)} options={[["female", "Female"], ["male", "Male"], ["unknown", "Unknown"]]} />
          <Select label="With or without photo" value={hasPhoto} onChange={reset(setHasPhoto)} options={[["yes", "Has photo"], ["no", "No photo"]]} />
          <select className="recSelect" aria-label="Show" value={archived} onChange={(e) => reset(setArchived)(e.target.value)}><option value="active">Active cats</option><option value="archived">Archived</option><option value="all">All</option></select>
          <select className="recSelect" aria-label="Sort" value={sort} onChange={(e) => reset(setSort)(e.target.value)}><option value="updated">Recently updated</option><option value="created">Newest</option><option value="name">Name</option></select>
        </div>
        <button className="primary" onClick={() => { setAdding(true); add.clear(); }}>+ Add a cat</button>
      </div>
      <Message error={error} onRetry={reload} />
      <LoadingNote loading={loading} what="cats" />
      <div className="recList" aria-busy={loading}>
        {data?.items.map((c) => (
          <button key={c.id} type="button" className="recItem" onClick={() => setOpen(c.id)}>
            <span className="recAvatar">{c.leadPhotoId ? <img src={photoUrl(c.leadPhotoId)} alt="" loading="lazy" decoding="async" /> : "♧"}</span>
            <span className="recText"><strong>{c.displayName}</strong><small>{[c.currentStatus, c.colonyName, c.currentLocation].filter(Boolean).join(" · ")}</small></span>
            <span className="recMeta">{c.archivedAt ? (c.mergedInto ? "Merged" : "Archived") : `${c.eventCount} events`}</span>
          </button>
        ))}
        {data && !data.items.length && <p className="recEmpty">{q || status || sex || colonyId || hasPhoto ? "No cats match those filters." : archived === "archived" ? "No archived cats." : "No cats yet — add one, or tell the assistant about a cat."}</p>}
      </div>
      <Pager page={data} onPage={setPage} />
      {adding && (
        <Sheet title="Add a cat" eyebrow="NEW CAT" onClose={() => setAdding(false)}>
          <p className="recHint">A name isn’t required. Add whatever you know.</p>
          <RecordForm fields={CAT_FIELDS} initial={toValues()} submitLabel="Add cat" busy={add.busy}
            onSubmit={async (v) => { const r = await add.run<{ id: string }>("cats", { cat: v }); if (r) { setAdding(false); reload(); setOpen(r.id); } }} />
          <Message error={add.error} />
        </Sheet>
      )}
      {open && <CatSheet id={open} onClose={() => setOpen(null)} onChanged={reload} onOpen={setOpen} />}
    </section>
  );
}

function CatSheet({ id, onClose, onChanged, onOpen }: { id: string; onClose: () => void; onChanged: () => void; onOpen: (id: string) => void }) {
  const [eventPage, setEventPage] = useState(1);
  const { data, error, reload } = useRecord<CatDetail>("cats", { id, page: eventPage, pageSize: 20 });
  const [mode, setMode] = useState<"view" | "edit" | "event" | "merge">("view");
  const [editingEvent, setEditingEvent] = useState<CatDetail["events"][number] | null>(null);
  const act = useAction();
  const refresh = () => { reload(); onChanged(); };
  const cat = data?.cat;

  if (!cat) return <Sheet title="Cat" onClose={onClose}><Message error={error} onRetry={reload} />{!error && <p className="recHint" role="status">Loading…</p>}</Sheet>;
  const archived = !!cat.archivedAt;
  const save = async (v: Values) => {
    const changes: Record<string, string | null> = {}, now = toValues(cat);
    for (const k of Object.keys(v)) if (v[k] !== now[k]) changes[k] = v[k] === "" ? null : v[k];
    if (!Object.keys(changes).length) { setMode("view"); return; }
    if (await act.run("cats", { action: "update", id, version: cat.version, changes }, "PATCH")) { setMode("view"); refresh(); }
  };
  const archive = async () => { if (await act.run("cats", { action: archived ? "restore" : "archive", id })) refresh(); };

  return (
    <Sheet title={cat.displayName} eyebrow={archived ? (cat.mergedInto ? "MERGED INTO ANOTHER CAT" : "ARCHIVED") : "CAT RECORD"} onClose={onClose}>
      <Message error={act.error} notice={act.notice} />
      {mode === "edit" ? (
        <RecordForm fields={CAT_FIELDS.map((f) => (f.key === "originColonyId" ? { ...f, display: cat.colonyName ?? undefined } : f))} initial={toValues(cat)} submitLabel="Save changes" busy={act.busy} onSubmit={save} onCancel={() => setMode("view")} />
      ) : (
        <>
          <dl className="recFacts">
            {([["Status", cat.currentStatus], ["Sex", cat.sex], ["Age", cat.ageClass], ["Colony", cat.colonyName], ["Location", cat.currentLocation], ["Microchip", cat.microchipNumber], ["Appearance", cat.appearance], ["Marks", cat.distinguishingCharacteristics], ["Health", cat.healthObservations], ["Reproductive", cat.reproductiveSignificance]] as Array<[string, string | null]>).filter(([, v]) => v && v !== "unknown").map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          {data.mergedFrom.length > 0 && <p className="recHint">Includes the history of {data.mergedFrom.map((m) => m.displayName).join(", ")}, merged in.</p>}
          {cat.mergedInto && <button type="button" className="recLink" onClick={() => onOpen(cat.mergedInto!)}>Open the cat this was merged into</button>}
          {!archived && (
            <div className="recButtons">
              <button className="primary" onClick={() => setMode("edit")}>Edit details</button>
              <button type="button" className="recSecondary" onClick={() => { setMode("event"); setEditingEvent(null); act.clear(); }}>+ Add to history</button>
            </div>
          )}
          <PhotoGallery catId={id} catName={cat.displayName} onChanged={refresh} />
          <section aria-label="History">
            <h3>History ({data.eventsPaging.total})</h3>
            <ol className="recTimeline">
              {data.events.map((e) => (
                <li key={e.id}>
                  <time>{e.occurredAt.slice(0, 10)}</time>
                  <div><strong>{titleCase(e.eventType)}</strong>{e.personName && <small> · {e.personName}</small>}{e.location && <small> · {e.location}</small>}{e.notes && <p>{e.notes}</p>}
                    {!archived && <span className="recInline"><button type="button" className="recLink" onClick={() => { setEditingEvent(e); setMode("event"); act.clear(); }}>Edit</button><button type="button" className="recLink" onClick={async () => { if (await act.run("events", { action: "void", id: e.id, reason: "Removed by hand" })) refresh(); }}>Remove</button></span>}
                  </div>
                </li>
              ))}
              {!data.events.length && <li className="recEmpty">No history yet.</li>}
            </ol>
            <div className="recPager"><button type="button" disabled={eventPage <= 1} onClick={() => setEventPage(eventPage - 1)}>‹ Newer</button><span>page {data.eventsPaging.page} of {data.eventsPaging.pages}</span><button type="button" disabled={eventPage >= data.eventsPaging.pages} onClick={() => setEventPage(eventPage + 1)}>Older ›</button></div>
          </section>
          <section aria-label="Changes"><h3>Change log</h3>
            <ul className="recLog">{data.changes.map((c) => <li key={c.id}>{when(c.createdAt)} — {titleCase(c.action)}{c.reason ? ` (${c.reason})` : ""}</li>)}</ul>
          </section>
          <div className="recButtons">
            {!archived && <button type="button" className="recSecondary" onClick={() => setMode("merge")}>Merge with a duplicate…</button>}
            {!(archived && cat.mergedInto) && <button type="button" className="recSecondary" disabled={act.busy} onClick={archive}>{archived ? "Restore this cat" : "Archive this cat"}</button>}
          </div>
        </>
      )}
      {mode === "event" && (
        <Sheet title={editingEvent ? "Edit history entry" : "Add to history"} eyebrow={cat.displayName.toUpperCase()} onClose={() => { setMode("view"); setEditingEvent(null); }}>
          <RecordForm busy={act.busy} submitLabel={editingEvent ? "Save entry" : "Add entry"}
            fields={[
              { key: "eventType", label: "What happened", type: "select", required: true, options: opts(EVENT_TYPES) }, { key: "occurredAt", label: "Date", type: "date", required: true },
              { key: "location", label: "Where" }, { key: "personId", label: "Who was involved", type: "picker", resource: "people" }, { key: "notes", label: "Notes", type: "textarea" },
            ]}
            initial={editingEvent ? { eventType: editingEvent.eventType, occurredAt: editingEvent.occurredAt.slice(0, 10), location: editingEvent.location ?? "", personId: editingEvent.personId ?? "", notes: editingEvent.notes ?? "" } : { eventType: "vet_visit", occurredAt: new Date().toISOString().slice(0, 10), location: "", personId: "", notes: "" }}
            onSubmit={async (v) => {
              const r = editingEvent
                ? await act.run("events", { action: "update", id: editingEvent.id, version: editingEvent.version, changes: { eventType: v.eventType, occurredAt: v.occurredAt, location: v.location || null, personId: v.personId || null, notes: v.notes || null } }, "PATCH")
                : await act.run("events", { catId: id, ...v });
              if (r) { setMode("view"); setEditingEvent(null); refresh(); }
            }} />
          <Message error={act.error} />
        </Sheet>
      )}
      {mode === "merge" && <MergeFlow type="cat" record={{ id, label: cat.displayName }} onClose={() => setMode("view")} onMerged={() => { setMode("view"); refresh(); }} />}
    </Sheet>
  );
}
