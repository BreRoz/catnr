"use client";
import { useState } from "react";
import CatsPanel from "./cats-panel";
import ColoniesPanel from "./colonies-panel";
import DuplicatesPanel from "./duplicates-panel";
import MoneyPanel from "./money-panel";
import PeoplePanel from "./people-panel";
import ReportsPanel from "./reports-panel";

const SECTIONS = [["cats", "Cats"], ["colonies", "Colonies"], ["people", "People"], ["money", "Money"], ["reports", "Reports"], ["duplicates", "Duplicates"]] as const;
type Section = (typeof SECTIONS)[number][0];

/** Everyday record management without the assistant: add, find, edit, archive and merge. */
export default function RecordsApp() {
  const [section, setSection] = useState<Section>("cats");
  return (
    <section className="records" aria-label="Records">
      <div className="pageIntro"><p className="eyebrow">YOUR RECORDS</p><h2>Manage records</h2><p>Everything here works even when the assistant is unavailable.</p></div>
      <div className="recTabs" role="tablist" aria-label="Record types">
        {SECTIONS.map(([id, label]) => <button key={id} role="tab" aria-selected={section === id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>{label}</button>)}
      </div>
      {section === "cats" && <CatsPanel />}
      {section === "colonies" && <ColoniesPanel />}
      {section === "people" && <PeoplePanel />}
      {section === "money" && <MoneyPanel />}
      {section === "reports" && <ReportsPanel />}
      {section === "duplicates" && <DuplicatesPanel />}
    </section>
  );
}
