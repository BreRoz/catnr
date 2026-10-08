"use client";
import { useRecord } from "./hooks";
import ImportFlow from "./import-flow";
import DeleteAccount, { type AccountStatus } from "./delete-account";
import { LoadingNote, Message, when } from "./ui";

type ExportSummary = { counts: Record<string, number>; lastExport: { at: string; profile: string } | null };
const SPREADSHEETS: Array<[table: string, label: string]> = [["cats", "Cats"], ["colonies", "Colonies"], ["people", "People"], ["events", "History"], ["transactions", "Money"], ["photos", "Photo list"]];
const href = (query: string) => `/api/manage/export?${query}`;

/** Ari's data, in her hands: take it out, bring it in, see how long it is kept, or delete it. */
export default function DataPanel() {
  const exportInfo = useRecord<ExportSummary>("export", {});
  const account = useRecord<AccountStatus>("account", {});
  const counts = exportInfo.data?.counts;
  return (
    <section aria-label="My data" className="dataPanel">
      <h3>Download your data</h3>
      <p className="recHint">Everything you have recorded belongs to you. Downloads use standard formats, so you can open them anywhere and keep them even if you stop using Cat Tracker.</p>
      <Message error={exportInfo.error} onRetry={exportInfo.reload} />
      <LoadingNote loading={exportInfo.loading} what="your download options" />
      {counts && <p className="recHint">{counts.cats} cats · {counts.colonies} colonies · {counts.people} people · {counts.events} history entries · {counts.transactions} money records · {counts.photos} photos{exportInfo.data?.lastExport ? ` · last download ${when(exportInfo.data.lastExport.at)}` : " · not downloaded yet"}</p>}
      <div className="dataCard">
        <strong>Everything (recommended)</strong>
        <p>One file with all your records, spreadsheets for each type, your photos, and the full change history, including what you told the assistant.</p>
        <a className="primary dataLink" href={href("download=zip&profile=full")} download>Download everything (.zip)</a>
        <p className="recHint">Contains contact details and colony locations. Keep it private.</p>
      </div>
      <div className="dataCard">
        <strong>One spreadsheet at a time</strong>
        <div className="recButtons">{SPREADSHEETS.map(([table, label]) => <a key={table} className="recSecondary dataLink" href={href(`download=csv&profile=full&table=${table}`)} download>{label}</a>)}</div>
      </div>
      <div className="dataCard">
        <strong>Safe-to-share summary</strong>
        <p>For a grant, a board or a partner. It has the cats, colonies, history and money amounts, but leaves out colony addresses and map pins, contact details, donor and adopter names, notes, health details and photos.</p>
        <a className="recSecondary dataLink" href={href("download=zip&profile=shareable")} download>Download the summary (.zip)</a>
      </div>

      <h3>Bring in a spreadsheet</h3>
      <ImportFlow />

      <h3>How long things are kept</h3>
      <Message error={account.error} onRetry={account.reload} />
      <LoadingNote loading={account.loading} what="the retention rules" />
      {account.data?.retention.map((r) => (
        <details key={r.id} className="dataRule"><summary><strong>{r.what}</strong> <span>{r.keptFor}</span></summary><p>{r.why}</p></details>
      ))}
      <p className="recHint">Colony locations and contact details are private: nothing here is public, and reports and the safe-to-share summary leave them out.</p>

      <h3>Delete my account</h3>
      {account.data && <DeleteAccount status={account.data} onChanged={account.reload} />}
    </section>
  );
}
