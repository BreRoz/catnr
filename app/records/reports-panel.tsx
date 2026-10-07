"use client";
import { useEffect, useState } from "react";
import { getJson } from "./api";
import { Message } from "./ui";
import { formatMoney } from "../money";
import type { Report } from "../reports/queries";

// Hand-written view of the report API. Money arrives as integer minor units and is only formatted here.
const money = (totals: Array<{ currency: string; minor: number }>) => totals.length ? totals.map((t) => formatMoney(t.minor, t.currency)).join(" + ") : formatMoney(0);

export default function ReportsPanel() {
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [state, setState] = useState<{ key: string; report?: Report; error?: string }>({ key: "" });
  const rangeBad = !!from && !!to && from > to;
  const key = `${from}|${to}`;
  useEffect(() => {
    if (rangeBad) return;
    let cancelled = false;
    getJson<Report>("reports", { from, to })
      .then((report) => { if (!cancelled) setState({ key, report }); })
      .catch((error) => { if (!cancelled) setState({ key, error: error instanceof Error ? error.message : "Couldn’t load the report." }); });
    return () => { cancelled = true; };
  }, [from, to, key, rangeBad]);

  const report = state.report, loading = !rangeBad && state.key !== key;
  const tiles: Array<[string, string | number]> = report ? [
    ["Cats assisted", report.cats.assisted], ["Captured", report.cats.captured], ["Sterilized", report.cats.sterilized], ["Vaccinated", report.cats.vaccinated],
    ["Adopted", report.cats.adopted], ["Returned to colony", report.cats.returnedToColony], ["Colonies served", report.coloniesServed], ["Veterinary procedures", report.veterinary.procedures],
  ] : [];
  return (
    <section aria-label="Reports">
      <div className="recDates">
        <label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {(from || to) && <button type="button" className="recLink" onClick={() => { setFrom(""); setTo(""); }}>All time</button>}
      </div>
      {rangeBad && <p className="recError" role="alert">The start date is after the end date.</p>}
      <Message error={state.key === key ? state.error : undefined} />
      {loading && <p className="recNotice" role="status">Loading…</p>}
      {report && !rangeBad && (
        <>
          <p className="accountingNote">{report.period.from || report.period.to ? `${report.period.from ?? "the beginning"} to ${report.period.to ?? "today"}` : "All time"}. Each number is counted straight from your records; tap a definition below to see exactly what it means.</p>
          <div className="stats">{tiles.map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
          <div className="stats second">
            <div><strong>{report.current.inFoster}</strong><span>In foster now</span></div>
            <div><strong>{report.current.availableForAdoption}</strong><span>Available now</span></div>
            <div><strong>{report.veterinary.vetVisits}</strong><span>Vet visits</span></div>
          </div>
          <h3>Surgery status of cats in care</h3>
          <p>{report.surgery.inCare} in care: {report.surgery.sterilized} sterilized · {report.surgery.needsSurgery} confirmed to need surgery · {report.surgery.unknown} unknown. Unknown means nobody has recorded it, not that surgery is needed.</p>
          <h3>Money</h3>
          <div className="stats">
            <div><strong>{report.money.cashInText}</strong><span>Cash received</span></div>
            <div><strong>{report.money.cashOutText}</strong><span>Cash spent</span></div>
            <div><strong>{report.money.netText}</strong><span>Net cash</span></div>
          </div>
          <ul>
            {report.money.cashInByType.map((r) => <li key={`i${r.type}${r.currency}`}>{r.type.replaceAll("_", " ")} ({r.count}): {formatMoney(r.minor, r.currency)}</li>)}
            {report.money.cashOutByType.map((r) => <li key={`o${r.type}${r.currency}`}>spent — {r.type.replaceAll("_", " ")} ({r.count}): {formatMoney(r.minor, r.currency)}</li>)}
          </ul>
          <h3>In-kind resources</h3>
          <p>{report.money.inKind.count} donation{report.money.inKind.count === 1 ? "" : "s"}{report.money.inKind.estimatedValue.length ? `, estimated value ${money(report.money.inKind.estimatedValue)} (an estimate, not income)` : ""}{report.money.inKind.withoutEstimate ? `; ${report.money.inKind.withoutEstimate} without an estimate` : ""}.</p>
          <ul>{report.money.inKind.quantities.map((q) => <li key={`${q.item}${q.unit}`}>{q.item}: {q.quantity ?? "?"} {q.unit ?? ""}</li>)}</ul>
          {(report.dataQuality.moneyWithoutAmount > 0 || report.dataQuality.catsWithUndatedEvents > 0) && (
            <p className="recNotice" role="status">Heads up: {report.dataQuality.moneyWithoutAmount} money entr{report.dataQuality.moneyWithoutAmount === 1 ? "y has" : "ies have"} no amount and {report.dataQuality.catsWithUndatedEvents} cat{report.dataQuality.catsWithUndatedEvents === 1 ? " has" : "s have"} events with an unreadable date, so they aren’t counted above.</p>
          )}
          <h3>What the numbers mean</h3>
          {report.definitions.map((d) => (
            <details key={d.key}><summary>{d.label}{d.period ? "" : " (right now)"}</summary><p>{d.counts}</p><p><em>Not counted:</em> {d.excludes}</p></details>
          ))}
        </>
      )}
    </section>
  );
}
