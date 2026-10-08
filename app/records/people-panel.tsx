"use client";
import { useState } from "react";
import { useAction, useList, useRecord } from "./hooks";
import MergeFlow from "./merge-flow";
import { LoadingNote, Message, Pager, RecordForm, SearchBox, Select, Sheet, titleCase, when, type FieldDef, type Values } from "./ui";

const TYPES = ["donor", "adopter", "foster", "volunteer", "veterinarian", "other"];
type Person = {
  id: string;
  version: number;
  name: string;
  type: string | null;
  generalLocation: string | null;
  contact: string | null;
  notes: string | null;
  archivedAt: string | null;
  mergedInto: string | null;
  eventCount: number;
  transactionCount: number;
};
type Detail = {
  person: Person;
  events: Array<{ id: string; eventType: string; occurredAt: string; catName: string | null }>;
  transactions: Array<{ id: string; description: string; date: string; amountText: string | null }>;
  totals: Array<{ direction: string; text: string; count: number }>;
  changes: Array<{ id: string; action: string; reason: string | null; createdAt: string }>;
  mergedFrom: Array<{ personId: string; name: string }>;
};
const FIELDS: FieldDef[] = [
  { key: "name", label: "Name", required: true },
  { key: "type", label: "Who are they?", type: "select", options: TYPES.map((t): [string, string] => [t, titleCase(t)]) },
  { key: "contact", label: "Phone or email" },
  { key: "generalLocation", label: "Where are they?" },
  { key: "notes", label: "Notes", type: "textarea" },
];
const toValues = (p?: Person): Values => ({
  name: p?.name ?? "",
  type: p?.type ?? "",
  contact: p?.contact ?? "",
  generalLocation: p?.generalLocation ?? "",
  notes: p?.notes ?? "",
});

export default function PeoplePanel() {
  const [q, setQ] = useState(""),
    [type, setType] = useState(""),
    [archived, setArchived] = useState("active"),
    [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null),
    [adding, setAdding] = useState(false);
  const { data, loading, error, reload } = useList<Person>("people", { q, type, archived, page, pageSize: 25 });
  const add = useAction();
  return (
    <section aria-label="Contacts">
      <div className="recToolbar">
        <SearchBox
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          placeholder="Search name, phone, email…"
        />
        <div className="recFilters">
          <Select
            label="Any type"
            value={type}
            onChange={(v) => {
              setType(v);
              setPage(1);
            }}
            options={[...TYPES.map((t): [string, string] => [t, titleCase(t)]), ["none", "No type"]]}
          />
          <select
            className="recSelect"
            aria-label="Show"
            value={archived}
            onChange={(e) => {
              setArchived(e.target.value);
              setPage(1);
            }}
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
        </div>
        <button
          className="primary"
          onClick={() => {
            setAdding(true);
            add.clear();
          }}
        >
          + Add a contact
        </button>
      </div>
      <Message error={error} onRetry={reload} />
      <LoadingNote loading={loading} what="people" />
      <div className="recList" aria-busy={loading}>
        {data?.items.map((p) => (
          <button key={p.id} type="button" className="recItem" onClick={() => setOpen(p.id)}>
            <span className="recAvatar">☺</span>
            <span className="recText">
              <strong>{p.name}</strong>
              <small>{[p.type && titleCase(p.type), p.contact].filter(Boolean).join(" · ")}</small>
            </span>
            <span className="recMeta">
              {p.archivedAt ? (p.mergedInto ? "Merged" : "Archived") : `${p.eventCount + p.transactionCount} items`}
            </span>
          </button>
        ))}
        {data && !data.items.length && <p className="recEmpty">{q || type ? "No one matches that." : "No contacts yet."}</p>}
      </div>
      <Pager page={data} onPage={setPage} />
      {adding && (
        <Sheet title="Add a contact" eyebrow="NEW CONTACT" onClose={() => setAdding(false)}>
          <RecordForm
            fields={FIELDS}
            initial={toValues()}
            submitLabel="Add contact"
            busy={add.busy}
            onSubmit={async (v) => {
              const r = await add.run<{ id: string }>("people", { person: v });
              if (r) {
                setAdding(false);
                reload();
                setOpen(r.id);
              }
            }}
          />
          <Message error={add.error} />
        </Sheet>
      )}
      {open && <PersonSheet id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </section>
  );
}

function PersonSheet({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, error, reload } = useRecord<Detail>("people", { id });
  const [mode, setMode] = useState<"view" | "edit" | "merge">("view");
  const act = useAction();
  const refresh = () => {
    reload();
    onChanged();
  };
  const p = data?.person;
  if (!p)
    return (
      <Sheet title="Contact" onClose={onClose}>
        <Message error={error} onRetry={reload} />
        {!error && (
          <p className="recHint" role="status">
            Loading…
          </p>
        )}
      </Sheet>
    );
  const archived = !!p.archivedAt;
  const save = async (v: Values) => {
    const now = toValues(p),
      changes: Record<string, string | null> = {};
    for (const k of Object.keys(v)) if (v[k] !== now[k]) changes[k] = v[k] === "" ? null : v[k];
    if (!Object.keys(changes).length) {
      setMode("view");
      return;
    }
    if (await act.run("people", { action: "update", id, version: p.version, changes }, "PATCH")) {
      setMode("view");
      refresh();
    }
  };
  return (
    <Sheet
      title={p.name}
      eyebrow={
        archived ? (p.mergedInto ? "MERGED INTO ANOTHER CONTACT" : "ARCHIVED") : p.type ? titleCase(p.type).toUpperCase() : "CONTACT"
      }
      onClose={onClose}
    >
      <Message error={act.error} notice={act.notice} />
      {mode === "edit" ? (
        <RecordForm
          fields={FIELDS}
          initial={toValues(p)}
          submitLabel="Save changes"
          busy={act.busy}
          onSubmit={save}
          onCancel={() => setMode("view")}
        />
      ) : (
        <>
          <dl className="recFacts">
            {(
              [
                ["Contact", p.contact],
                ["Location", p.generalLocation],
                ["Notes", p.notes],
              ] as Array<[string, string | null]>
            )
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
          {data.mergedFrom.length > 0 && <p className="recHint">Includes {data.mergedFrom.map((m) => m.name).join(", ")}, merged in.</p>}
          {!!data.totals.length && (
            <p className="recHint">
              {data.totals.map((t) => `${t.direction === "inflow" ? "Gave" : "Paid"} ${t.text} (${t.count})`).join(" · ")}
            </p>
          )}
          <h3>With the rescue</h3>
          <ul className="recLog">
            {data.events.map((e) => (
              <li key={e.id}>
                {e.occurredAt.slice(0, 10)} — {titleCase(e.eventType)}
                {e.catName ? ` · ${e.catName}` : ""}
              </li>
            ))}
            {data.transactions.map((t) => (
              <li key={t.id}>
                {t.date.slice(0, 10)} — {t.description}
                {t.amountText ? ` · ${t.amountText}` : ""}
              </li>
            ))}
            {!data.events.length && !data.transactions.length && <li>Nothing recorded yet.</li>}
          </ul>
          <h3>Change log</h3>
          <ul className="recLog">
            {data.changes.map((x) => (
              <li key={x.id}>
                {when(x.createdAt)} — {titleCase(x.action)}
                {x.reason ? ` (${x.reason})` : ""}
              </li>
            ))}
          </ul>
          <div className="recButtons">
            {!archived && (
              <button className="primary" onClick={() => setMode("edit")}>
                Edit contact
              </button>
            )}
            {!archived && (
              <button type="button" className="recSecondary" onClick={() => setMode("merge")}>
                Merge with a duplicate…
              </button>
            )}
            {!(archived && p.mergedInto) && (
              <button
                type="button"
                className="recSecondary"
                disabled={act.busy}
                onClick={async () => {
                  if (await act.run("people", { action: archived ? "restore" : "archive", id })) refresh();
                }}
              >
                {archived ? "Restore contact" : "Archive contact"}
              </button>
            )}
          </div>
        </>
      )}
      {mode === "merge" && (
        <MergeFlow
          type="person"
          record={{ id, label: p.name }}
          onClose={() => setMode("view")}
          onMerged={() => {
            setMode("view");
            refresh();
          }}
        />
      )}
    </Sheet>
  );
}
