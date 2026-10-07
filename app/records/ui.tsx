"use client";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useList } from "./hooks";
import type { Page } from "./api";

export function Sheet({ title, eyebrow, onClose, children }: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sheetBackdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="sheet recSheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="handle" />
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
        {children}
        <button type="button" className="close" onClick={onClose}>Close</button>
      </section>
    </div>
  );
}

export function Message({ error, notice }: { error?: string; notice?: string }) {
  if (error) return <p className="recError" role="alert">{error}</p>;
  if (notice) return <p className="recNotice" role="status">{notice}</p>;
  return null;
}

export type FieldDef = {
  key: string; label: string; type?: "text" | "textarea" | "select" | "date" | "number" | "picker";
  options?: Array<[value: string, label: string]>; placeholder?: string; required?: boolean; resource?: string; help?: string; display?: string;
};
export type Values = Record<string, string>;

export function RecordForm({ fields, initial, submitLabel, busy, onSubmit, onCancel }: { fields: FieldDef[]; initial: Values; submitLabel: string; busy: boolean; onSubmit: (values: Values) => void; onCancel?: () => void }) {
  const [values, setValues] = useState<Values>(initial);
  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));
  return (
    <form className="recForm" onSubmit={(e) => { e.preventDefault(); onSubmit(values); }}>
      {fields.map((f) => <Field key={f.key} def={f} value={values[f.key] ?? ""} onChange={(v) => set(f.key, v)} />)}
      <div className="recButtons">
        <button className="primary" type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
        {onCancel && <button className="close" type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function Field({ def, value, onChange }: { def: FieldDef; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="recField">
      <label htmlFor={id}>{def.label}{def.required && <span aria-hidden="true"> *</span>}</label>
      {def.type === "textarea" ? <textarea id={id} value={value} placeholder={def.placeholder} required={def.required} onChange={(e) => onChange(e.target.value)} />
        : def.type === "select" ? (
          <select id={id} value={value} required={def.required} onChange={(e) => onChange(e.target.value)}>
            {!def.required && <option value="">—</option>}
            {def.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        ) : def.type === "picker" ? <Picker id={id} resource={def.resource!} value={value} display={def.display} onChange={onChange} />
        : <input id={id} type={def.type === "date" ? "date" : "text"} inputMode={def.type === "number" ? "decimal" : undefined} value={value} placeholder={def.placeholder} required={def.required} onChange={(e) => onChange(e.target.value)} />}
      {def.help && <small>{def.help}</small>}
    </div>
  );
}

type Named = { id: string; name?: string | null; displayName?: string };
const nameOf = (r: Named) => r.displayName || r.name || "Unnamed";

/** Search-as-you-type chooser for linking a colony, person or cat. Stores the record id. */
function Picker({ id, resource, value, display, onChange }: { id: string; resource: string; value: string; display?: string; onChange: (v: string) => void }) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Named | null>(null);
  const { data } = useList<Named>(resource, { q: term, pageSize: 8 }, open);
  const label = value ? (chosen?.id === value ? nameOf(chosen) : display || "Selected") : "";
  return (
    <div className="recPicker">
      {!open ? (
        <div className="recPicked">
          <span id={id}>{label || "None"}</span>
          <button type="button" onClick={() => setOpen(true)}>{value ? "Change" : "Choose"}</button>
          {value && <button type="button" onClick={() => { onChange(""); setChosen(null); }}>Clear</button>}
        </div>
      ) : (
        <div>
          <input id={id} ref={(el) => el?.focus()} value={term} placeholder="Search…" onChange={(e) => setTerm(e.target.value)} />
          <ul className="recResults">
            {data?.items.map((r) => <li key={r.id}><button type="button" onClick={() => { onChange(r.id); setChosen(r); setOpen(false); setTerm(""); }}>{nameOf(r)}</button></li>)}
            {data && !data.items.length && <li className="recEmpty">Nothing found</li>}
          </ul>
          <button type="button" className="recLink" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <input className="recSearch" type="search" aria-label={placeholder} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />;
}

export function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <select className="recSelect" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{label}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

export function Pager({ page, onPage }: { page?: Pick<Page<unknown>, "page" | "pages" | "total"> ; onPage: (n: number) => void }) {
  if (!page) return null;
  return (
    <div className="recPager" role="navigation" aria-label="Pages">
      <button type="button" disabled={page.page <= 1} onClick={() => onPage(page.page - 1)}>‹ Prev</button>
      <span>{page.total} total · page {page.page} of {page.pages}</span>
      <button type="button" disabled={page.page >= page.pages} onClick={() => onPage(page.page + 1)}>Next ›</button>
    </div>
  );
}

export const when = (iso?: string | null) => { if (!iso) return ""; const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d); };
export const titleCase = (s: string) => s.replaceAll("_", " ");
