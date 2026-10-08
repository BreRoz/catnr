import type { LifetimeStats } from "./types";

const Stat = ({ value, label }: { value: string | number; label: string }) => (
  <div>
    <strong>{value}</strong>
    <span>{label}</span>
  </div>
);

/** The Dashboard tab: lifetime totals. Money shows as text from the server, never as a float. */
export default function ImpactSummary({ stats }: { stats: LifetimeStats }) {
  return (
    <>
      <section className="summaryCard" aria-label="Lifetime impact">
        <div>
          <p className="eyebrow">LIFETIME IMPACT</p>
          <h3>Your work at a glance</h3>
        </div>
        <div className="stats">
          <Stat value={stats.catsRecorded} label="Cats recorded" />
          <Stat value={stats.catsFoundHomes} label="Found homes" />
          <Stat value={stats.spayedNeutered} label="Spayed/neutered" />
          <Stat value={stats.vaccinated} label="Vaccinated" />
          <Stat value={stats.cashInText} label="Cash received" />
          <Stat value={stats.cashOutText} label="Cash spent" />
        </div>
      </section>
      <p className="accountingNote">Operational records only — not audited accounting.</p>
    </>
  );
}
