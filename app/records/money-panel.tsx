"use client";
import { useState } from "react";
import { useAction, useList, useRecord } from "./hooks";
import { LoadingNote, Message, Pager, RecordForm, SearchBox, Select, Sheet, titleCase, when, type FieldDef, type Values } from "./ui";

const TYPES: Array<[string, string]> = [
  ["cash_donation", "Cash donation"],
  ["in_kind_donation", "In-kind donation (supplies)"],
  ["fundraiser_income", "Fundraiser income"],
  ["merchandise_income", "Merchandise sales"],
  ["cash_inflow", "Other money in"],
  ["supply_purchase", "Supply purchase"],
  ["operating_expense", "Operating expense"],
  ["cash_outflow", "Other money out"],
  ["other", "Other"],
];
const CURRENCIES: Array<[string, string]> = ["USD", "CAD", "EUR", "GBP", "MXN", "AUD"].map((c) => [c, c]);

type Tx = {
  id: string;
  version: number;
  transactionType: string;
  direction: string;
  date: string;
  amountText: string | null;
  currency: string;
  personId: string | null;
  personName: string | null;
  category: string | null;
  description: string;
  item: string | null;
  quantity: number | null;
  unit: string | null;
  estimatedValueText: string | null;
  relatedCatId: string | null;
  relatedCatName: string | null;
  relatedColonyId: string | null;
  relatedColonyName: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  corrected: boolean;
};
type List = { totals: { cashInText: string; cashOutText: string }; categories?: string[] };
type Detail = { transaction: Tx; changes: Array<{ id: string; action: string; reason: string | null; createdAt: string }> };

const fields = (categories: string[]): FieldDef[] => [
  { key: "transactionType", label: "What kind", type: "select", required: true, options: TYPES },
  { key: "date", label: "Date", type: "date", required: true },
  { key: "amount", label: "Amount", type: "number", placeholder: "25.50", help: "Leave blank for donated supplies." },
  { key: "currency", label: "Currency", type: "select", required: true, options: CURRENCIES },
  { key: "description", label: "Description", required: true, placeholder: "Sarah Yunker donated $100" },
  { key: "category", label: "Category", placeholder: categories.slice(0, 3).join(", ") || "donation, supplies, vet…" },
  { key: "personId", label: "Who (donor or payee)", type: "picker", resource: "people" },
  { key: "relatedCatId", label: "For which cat", type: "picker", resource: "cats" },
  { key: "relatedColonyId", label: "For which colony", type: "picker", resource: "colonies" },
  { key: "item", label: "Item (supplies)", placeholder: "Friskies" },
  { key: "quantity", label: "Quantity", type: "number" },
  { key: "unit", label: "Unit", placeholder: "bags" },
  { key: "estimatedValue", label: "Estimated value (supplies)", type: "number" },
];
const money = (t: Tx) => (t.amountText ?? "").replace(/[^0-9.]/g, "");
const toValues = (t?: Tx): Values => ({
  transactionType: t?.transactionType ?? "cash_donation",
  date: t?.date.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  amount: t ? money(t) : "",
  currency: t?.currency ?? "USD",
  description: t?.description ?? "",
  category: t?.category ?? "",
  personId: t?.personId ?? "",
  relatedCatId: t?.relatedCatId ?? "",
  relatedColonyId: t?.relatedColonyId ?? "",
  item: t?.item ?? "",
  quantity: t?.quantity == null ? "" : String(t.quantity),
  unit: t?.unit ?? "",
  estimatedValue: t?.estimatedValueText ? t.estimatedValueText.replace(/[^0-9.]/g, "") : "",
});
const payload = (v: Values) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === "" ? null : x]));

export default function MoneyPanel() {
  const [q, setQ] = useState(""),
    [type, setType] = useState(""),
    [direction, setDirection] = useState(""),
    [category, setCategory] = useState("");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [status, setStatus] = useState("active"),
    [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null),
    [adding, setAdding] = useState(false);
  const { data, loading, error, reload } = useList<Tx>("transactions", {
    q,
    type,
    direction,
    category,
    from,
    to,
    status,
    page,
    pageSize: 25,
    facets: 1,
  });
  const extra = data as (typeof data & List) | undefined;
  const categories = extra?.categories ?? [];
  const add = useAction();
  const f =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(1);
    };
  const rangeBad = from && to && from > to;

  return (
    <section aria-label="Money and supplies">
      <div className="recToolbar">
        <SearchBox value={q} onChange={f(setQ)} placeholder="Search description, person, item, category…" />
        <div className="recFilters">
          <Select label="Any kind" value={type} onChange={f(setType)} options={TYPES} />
          <Select
            label="In and out"
            value={direction}
            onChange={f(setDirection)}
            options={[
              ["inflow", "Money in"],
              ["outflow", "Money out"],
            ]}
          />
          <Select
            label="Any category"
            value={category}
            onChange={f(setCategory)}
            options={categories.map((c): [string, string] => [c, c])}
          />
          <select className="recSelect" aria-label="Show" value={status} onChange={(e) => f(setStatus)(e.target.value)}>
            <option value="active">Counted</option>
            <option value="voided">Reversed</option>
            <option value="all">All</option>
          </select>
        </div>
        <div className="recDates">
          <label>
            From <input type="date" value={from} onChange={(e) => f(setFrom)(e.target.value)} />
          </label>
          <label>
            To <input type="date" value={to} onChange={(e) => f(setTo)(e.target.value)} />
          </label>
          {(from || to) && (
            <button
              type="button"
              className="recLink"
              onClick={() => {
                setFrom("");
                setTo("");
                setPage(1);
              }}
            >
              Clear dates
            </button>
          )}
        </div>
        {rangeBad && (
          <p className="recError" role="alert">
            The start date is after the end date.
          </p>
        )}
        <button
          className="primary"
          onClick={() => {
            setAdding(true);
            add.clear();
          }}
        >
          + Record money or supplies
        </button>
      </div>
      {extra?.totals && !rangeBad && (
        <p className="recTotals" aria-live="polite">
          In <strong>{extra.totals.cashInText}</strong> · Out <strong>{extra.totals.cashOutText}</strong>{" "}
          <small>(matching, counted entries)</small>
        </p>
      )}
      <Message error={rangeBad ? undefined : error} onRetry={reload} />
      <LoadingNote loading={loading} what="entries" />
      <div className="recList" aria-busy={loading}>
        {data?.items.map((t) => (
          <button key={t.id} type="button" className={`recItem${t.voidedAt ? " recVoided" : ""}`} onClick={() => setOpen(t.id)}>
            <span className={`recAvatar ${t.direction === "inflow" ? "recIn" : "recOut"}`}>{t.direction === "inflow" ? "↗" : "↘"}</span>
            <span className="recText">
              <strong>{t.description}</strong>
              <small>
                {[t.date.slice(0, 10), t.personName, t.category, t.voidedAt ? "reversed" : t.corrected ? "corrected" : null]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </span>
            <span className="recMeta">{t.amountText ?? (t.quantity ? `${t.quantity} ${t.unit ?? ""}` : "supplies")}</span>
          </button>
        ))}
        {data && !data.items.length && <p className="recEmpty">Nothing matches those filters.</p>}
      </div>
      <Pager page={data} onPage={setPage} />
      {adding && (
        <Sheet title="Record money or supplies" eyebrow="NEW ENTRY" onClose={() => setAdding(false)}>
          <RecordForm
            fields={fields(categories)}
            initial={toValues()}
            submitLabel="Record it"
            busy={add.busy}
            onSubmit={async (v) => {
              if (await add.run("transactions", { transaction: payload(v) })) {
                setAdding(false);
                reload();
              }
            }}
          />
          <Message error={add.error} />
        </Sheet>
      )}
      {open && <TxSheet id={open} categories={categories} onClose={() => setOpen(null)} onChanged={reload} />}
    </section>
  );
}

function TxSheet({ id, categories, onClose, onChanged }: { id: string; categories: string[]; onClose: () => void; onChanged: () => void }) {
  const { data, error, reload } = useRecord<Detail>("transactions", { id });
  const [editing, setEditing] = useState(false);
  const act = useAction();
  const refresh = () => {
    reload();
    onChanged();
  };
  const t = data?.transaction;
  if (!t)
    return (
      <Sheet title="Entry" onClose={onClose}>
        <Message error={error} onRetry={reload} />
        {!error && (
          <p className="recHint" role="status">
            Loading…
          </p>
        )}
      </Sheet>
    );
  const voided = !!t.voidedAt;
  const save = async (v: Values) => {
    const now = toValues(t),
      changes: Record<string, string | null> = {};
    for (const k of Object.keys(v)) if (v[k] !== now[k]) changes[k] = v[k] === "" ? null : v[k];
    if (!Object.keys(changes).length) {
      setEditing(false);
      return;
    }
    if (await act.run("transactions", { action: "update", id, version: t.version, changes }, "PATCH")) {
      setEditing(false);
      onClose();
      onChanged();
    }
  };
  return (
    <Sheet
      title={t.description}
      eyebrow={voided ? "REVERSED — NOT COUNTED" : t.direction === "inflow" ? "MONEY IN" : "MONEY OUT"}
      onClose={onClose}
    >
      <Message error={act.error} notice={act.notice} />
      {editing ? (
        <RecordForm
          fields={fields(categories)}
          initial={toValues(t)}
          submitLabel="Save changes"
          busy={act.busy}
          onSubmit={save}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <dl className="recFacts">
            {(
              [
                ["Amount", t.amountText],
                ["Kind", titleCase(t.transactionType)],
                ["Date", t.date.slice(0, 10)],
                ["Who", t.personName],
                ["Category", t.category],
                ["Cat", t.relatedCatName],
                ["Colony", t.relatedColonyName],
                ["Item", t.item ? `${t.quantity ?? ""} ${t.unit ?? ""} ${t.item}`.trim() : null],
                ["Estimated value", t.estimatedValueText],
                ["Why reversed", t.voidReason],
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
          <h3>History</h3>
          <ul className="recLog">
            {data.changes.map((c) => (
              <li key={c.id}>
                {when(c.createdAt)} — {titleCase(c.action)}
                {c.reason ? ` (${c.reason})` : ""}
              </li>
            ))}
          </ul>
          <p className="recHint">
            Editing keeps the earlier version in the history. Reversing removes it from totals but never deletes it.
          </p>
          <div className="recButtons">
            {!voided && (
              <button className="primary" onClick={() => setEditing(true)}>
                Edit entry
              </button>
            )}
            <button
              type="button"
              className="recSecondary"
              disabled={act.busy}
              onClick={async () => {
                if (
                  await act.run("transactions", { action: voided ? "unvoid" : "void", id, reason: voided ? undefined : "Reversed by hand" })
                )
                  refresh();
              }}
            >
              {voided ? "Count it again" : "Reverse this entry"}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
