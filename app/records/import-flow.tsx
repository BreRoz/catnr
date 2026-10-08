"use client";
import { useState } from "react";
import { useAction, useRecord } from "./hooks";
import { newKey, send } from "./api";
import { Message } from "./ui";

type Guide = { kinds: Array<{ kind: string; label: string; required: string[]; columns: string[]; template: string }>; notes: string[]; photos: string };

type Preview = {
  kind: string; rowCount: number; delimiter: string; canImport: boolean; errorCsv: string | null;
  summary: { ready: number; duplicates: number; errors: number };
  columns: { recognized: Array<{ column: string; field: string }>; ignored: string[]; missing: string[] };
  rows: Array<{ row: number; status: "ready" | "duplicate" | "error"; label: string; problem?: string }>;
};
const MARK = { ready: "✓", duplicate: "↷", error: "!" } as const;
const WORDS = { ready: "will be added", duplicate: "skipped", error: "problem" } as const;

/** Check first, then import: nothing is saved until Ari has seen every row's result. */
export default function ImportFlow() {
  const guide = useRecord<Guide>("import", {});
  const [kind, setKind] = useState("cats"), [csv, setCsv] = useState(""), [filename, setFilename] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null), [skip, setSkip] = useState(false), [error, setError] = useState(""), [checking, setChecking] = useState(false);
  const commit = useAction();
  const [finished, setFinished] = useState("");
  const kinds = guide.data?.kinds ?? [], current = kinds.find((k) => k.kind === kind);
  const reset = () => { setPreview(null); setError(""); setFinished(""); commit.clear(); };

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    reset();
    if (file.size > 1_400_000) { setError("That file is too large (over 1.4 MB). Split it into smaller files."); return; }
    setFilename(file.name); setCsv(await file.text());
  }
  async function check() {
    reset(); setChecking(true);
    try { setPreview(await send<Preview>("import", { mode: "preview", kind, csv, filename }, newKey())); }
    catch (e) { setError(e instanceof Error ? e.message : "I couldn’t check that file."); }
    finally { setChecking(false); }
  }
  async function runImport() {
    if (!preview) return;
    const result = await commit.run<{ message: string }>("import", { mode: "commit", kind, csv, filename, skipInvalid: skip });
    if (result) { setFinished(result.message); setPreview(null); setCsv(""); setFilename(null); }
  }
  function downloadProblems() {
    if (!preview?.errorCsv) return;
    const url = URL.createObjectURL(new Blob([preview.errorCsv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "rows-to-fix.csv"; a.click(); URL.revokeObjectURL(url);
  }
  const needSkip = !!preview && preview.summary.errors > 0;

  return (
    <div className="dataCard">
      <Message error={guide.error} onRetry={guide.reload} />
      {finished ? (
        <><p className="recNotice" role="status">{finished}</p><button type="button" className="recSecondary" onClick={() => { reset(); }}>Import another file</button></>
      ) : (
        <>
          <div className="recField"><label htmlFor="importKind">What are you bringing in?</label>
            <select id="importKind" value={kind} onChange={(e) => { setKind(e.target.value); reset(); }}>{kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select></div>
          {current && <p className="recHint">Needs columns for: {current.required.length ? current.required.join(", ") : "at least one of the cat columns"}. Also understood: {current.columns.join(", ")}.</p>}
          <div className="recField"><label htmlFor="importFile">Spreadsheet saved as CSV</label>
            <input id="importFile" type="file" accept=".csv,.tsv,.txt,text/csv" onChange={(e) => chooseFile(e.target.files?.[0])} /></div>
          <div className="recField"><label htmlFor="importText">…or paste the rows (first row = column names)</label>
            <textarea id="importText" rows={5} value={csv} onChange={(e) => { setCsv(e.target.value); setFilename(null); reset(); }} placeholder={current?.template.trim().replace(/^\uFEFF/, "") || "name,sex,age"} /></div>
          <details className="dataRule"><summary>Tips</summary><ul>{guide.data?.notes.map((n) => <li key={n}>{n}</li>)}<li>{guide.data?.photos}</li></ul></details>
          <button type="button" className="primary" disabled={!csv.trim() || checking} onClick={check}>{checking ? "Checking…" : "Check my file"}</button>
          <Message error={error} />
          {preview && (
            <div className="importResult" aria-live="polite">
              <p><strong>{preview.summary.ready}</strong> will be added · <strong>{preview.summary.duplicates}</strong> already there (skipped) · <strong>{preview.summary.errors}</strong> with problems</p>
              <p className="recHint">Read as {preview.delimiter === "," ? "comma" : preview.delimiter}-separated. Using: {preview.columns.recognized.map((c) => `${c.column} → ${c.field}`).join("; ") || "no columns"}.{preview.columns.ignored.length ? ` Not used: ${preview.columns.ignored.join(", ")}.` : ""}</p>
              {preview.columns.missing.length > 0 && <p className="recError" role="alert">The file needs a column for: {preview.columns.missing.join(", ")}.</p>}
              <ul className="importRows">{preview.rows.map((r) => <li key={r.row} className={`imp-${r.status}`}><span aria-hidden="true">{MARK[r.status]}</span> <span className="sr">{WORDS[r.status]}:</span> Row {r.row}: {r.label || "(empty)"}{r.problem && <small> — {r.problem}</small>}</li>)}</ul>
              {preview.errorCsv && <button type="button" className="recLink" onClick={downloadProblems}>Download the rows to fix (.csv)</button>}
              {needSkip && <label className="importSkip"><input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> Import the good rows and skip the ones with problems</label>}
              <button type="button" className="primary" disabled={commit.busy || !preview.canImport || (needSkip && !skip)} onClick={runImport}>{commit.busy ? "Importing…" : `Import ${preview.summary.ready} row${preview.summary.ready === 1 ? "" : "s"}`}</button>
              <p className="recHint">Nothing is saved until you press Import. If anything fails while saving, nothing is added.</p>
              <Message error={commit.error} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
