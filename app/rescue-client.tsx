"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { load } from "./assistant-client";
import CaptureSheet, { drafts, type CaptureMode } from "./capture-sheet";
import CatHistorySheet, { type CatDetail } from "./cat-history-sheet";
import ClarificationCards, { type PendingClarification } from "./clarification-cards";
import CorrectionSheet, { formatActivityDate, type Memory } from "./correction-sheet";
import { confirmDiscard } from "./dialog";
import type { Draft } from "./drafts";
import RecordsApp from "./records/records-app";

type Cat = { id: string; displayName: string; description: string; status: string; origin: string; events: number; photoId?: string | null };
type LifetimeStats = { catsRecorded: number; catsFoundHomes: number; spayedNeutered: number; vaccinated: number; cashInText: string; cashOutText: string };
type Banner = { message: string; retry?: () => void };
type Row = { id: string; kind: string; title: string; detail: string; createdAt: string; photoId?: string | null; correctionId?: string | null; memory?: Memory };

const EMPTY_STATS: LifetimeStats = { catsRecorded: 0, catsFoundHomes: 0, spayedNeutered: 0, vaccinated: 0, cashInText: "$0.00", cashOutText: "$0.00" };
const TABS = [["home", "⌂", "Home"], ["cats", "♧", "Cats"], ["activity", "◎", "Activity"], ["dashboard", "▥", "Dashboard"], ["records", "☰", "Records"]] as const;

export default function Home() {
  const [tab, setTab] = useState("home");
  const [capture, setCapture] = useState<Pick<Draft, "mode" | "text" | "photo"> | null>(null);
  const [savedDraft, setSavedDraft] = useState<Draft | null>(null);
  const [toast, setToast] = useState("");
  const [banner, setBanner] = useState<Banner | null>(null);
  const [loading, setLoading] = useState<string>("records");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [stats, setStats] = useState<LifetimeStats>(EMPTY_STATS);
  const [pending, setPending] = useState<PendingClarification[]>([]);
  const [detail, setDetail] = useState<CatDetail | null>(null);
  const [editing, setEditing] = useState<Memory | null>(null);
  const [sessionId] = useState(() => { try { const k = "catnr-session"; const s = sessionStorage.getItem(k) || crypto.randomUUID(); sessionStorage.setItem(k, s); return s; } catch { return crypto.randomUUID(); } });
  const toastTimer = useRef<number | undefined>(undefined);

  const say = useCallback((message: string) => { setToast(message); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(""), 3500); }, []);

  const refresh = useCallback(async () => {
    setLoading("records");
    const [questions, records] = await Promise.all([load("/api/assistant?clarifications=1", "load your open questions"), load("/api/assistant", "load your records")]);
    if (questions.ok) setPending(questions.data.clarifications || []);
    if (records.ok) { setMemories(records.data.memories || []); setCats(records.data.cats || []); setStats(records.data.stats || EMPTY_STATS); }
    const failed = !records.ok ? records : !questions.ok ? questions : null;
    setBanner(failed && !failed.ok ? { message: failed.reply.message, retry: () => void refresh() } : null);
    setSavedDraft(drafts.load()); // also picks up an unsent update left behind by a page reload
    setLoading("");
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const openCat = async (id: string) => {
    setLoading("cat");
    const result = await load(`/api/assistant?catId=${encodeURIComponent(id)}`, "open this cat’s history");
    setLoading("");
    if (result.ok) setDetail(result.data as unknown as CatDetail);
    else setBanner({ message: result.reply.message, retry: () => void openCat(id) });
  };

  const openCapture = (mode: CaptureMode, prefill = "") => {
    const keep = mode !== "ask" ? savedDraft : null; // continue an unsent update instead of discarding it
    setBanner(null);
    setCapture({ mode, text: keep?.text || prefill, photo: keep?.photo ?? null });
  };
  // Re-read after closing: the update may have just been queued as a question that now needs showing.
  const closeCapture = () => { setCapture(null); setSavedDraft(drafts.load()); void refresh(); };
  const discardDraft = () => { if (confirmDiscard()) { drafts.clear(); setSavedDraft(null); } };
  const saved = (message: string) => { setCapture(null); setEditing(null); setSavedDraft(null); setTab("home"); say(message); void refresh(); };

  const rows: Row[] = tab === "cats"
    ? cats.map((c) => ({ id: c.id, kind: "cat", title: c.displayName, detail: `${c.description} · ${c.status}`, createdAt: `${c.events} events`, photoId: c.photoId }))
    : memories.map((m) => { const memory = { ...m, title: formatActivityDate(m.createdAt), detail: `${m.title}${m.detail ? ` — ${m.detail}` : ""}` }; return { ...memory, memory }; });

  const impact = (
    <>
      <section className="summaryCard" aria-label="Lifetime impact">
        <div><p className="eyebrow">LIFETIME IMPACT</p><h3>Your work at a glance</h3></div>
        <div className="stats"><div><strong>{stats.catsRecorded}</strong><span>Cats recorded</span></div><div><strong>{stats.catsFoundHomes}</strong><span>Found homes</span></div><div><strong>{stats.spayedNeutered}</strong><span>Spayed/neutered</span></div></div>
        <div className="stats second"><div><strong>{stats.vaccinated}</strong><span>Vaccinated</span></div><div><strong>{stats.cashInText}</strong><span>Cash received</span></div><div><strong>{stats.cashOutText}</strong><span>Cash spent</span></div></div>
      </section>
      <p className="accountingNote">Operational records only — not audited accounting.</p>
    </>
  );

  return (
    <main className="shell">
      <header className="topbar">
        <div className="topbarTitle"><p className="eyebrow">GOOD MORNING, ARI</p><h1>TNR Assistant</h1></div>
        <span className="avatar" aria-hidden="true">A</span>
      </header>
      {banner && <div className="recError" role="alert"><p>{banner.message}</p><div className="recButtons">{banner.retry && <button type="button" className="recSmall" onClick={banner.retry}>Try again</button>}<button type="button" className="recSmall" onClick={() => setBanner(null)}>Dismiss</button></div></div>}
      {loading && <p className="recHint" role="status">{loading === "cat" ? "Opening this cat’s history…" : "Loading your records…"}</p>}

      {tab === "home" ? (
        <>
          <section className="hero">
            <img className="peekCat" src="/tnr-cat-peeking.png" alt="" />
            <div className="colonyBadge"><img src="/cat-colony.png" alt="" /></div>
            <div className="heroCopy"><p className="eyebrow light">THE FULL STORY OF YOUR RESCUE WORK.</p><h2>What happened today?</h2><p>Tell me naturally. I’ll organize the details and ask only when I’m unsure.</p></div>
            <div className="recordActions">
              <button type="button" className="talk" onClick={() => openCapture("mic")}><span className="mic" aria-hidden="true">●</span><span className="actionCopy"><b>SPEAK AN UPDATE</b><small>Open microphone</small></span></button>
              <button type="button" className="typeUpdate" onClick={() => openCapture("text")}><span className="typeIcon" aria-hidden="true">Aa</span><span><strong>Type an update</strong><small>Open text window</small></span></button>
            </div>
          </section>
          {savedDraft && !capture && (
            <section className="reply clarify" aria-label="Unsent update">
              <strong>You have an update that isn’t saved yet</strong>
              <p>{savedDraft.text ? `“${savedDraft.text.slice(0, 120)}${savedDraft.text.length > 120 ? "…" : ""}”` : "A photo you chose"}{savedDraft.text && savedDraft.photo ? " (with a photo)" : ""}. It’s kept on this phone.</p>
              <div className="recButtons"><button type="button" className="primary" onClick={() => openCapture(savedDraft.mode === "ask" ? "text" : savedDraft.mode)}>Continue</button><button type="button" className="recSecondary" onClick={discardDraft}>Discard</button></div>
            </section>
          )}
          <ClarificationCards items={pending} sessionId={sessionId} onChanged={refresh} />
          <section className="quickGrid">
            <button type="button" onClick={() => openCapture("photo")}><span className="actionIcon photo" aria-hidden="true">▣</span><span><strong>Add photo</strong><small>Document a cat</small></span><b aria-hidden="true">›</b></button>
            <button type="button" onClick={() => openCapture("ask")}><span className="actionIcon ask" aria-hidden="true">?</span><span><strong>Ask your assistant</strong><small>Query your records</small></span><b aria-hidden="true">›</b></button>
          </section>
        </>
      ) : tab === "dashboard" ? impact : tab === "records" ? <RecordsApp /> : (
        <section className="recent">
          <div className="sectionTitle"><div><p className="eyebrow">RECORDED</p><h3>{tab === "cats" ? "Cats" : "All activity"}</h3></div>{tab === "activity" && <span className="editHint">Tap an entry to correct it</span>}</div>
          <div className="memoryList">
            {rows.slice(0, 50).map((item) => (
              <button type="button" key={item.id} className={`rowBtn ${item.kind === "cat" ? "catRow" : "activityRow"}`} onClick={() => (item.kind === "cat" ? void openCat(item.id) : setEditing(item.memory!))}>
                <span className={`eventIcon ${item.kind === "income" || item.kind === "in-kind" ? "green" : item.kind === "expense" ? "coral" : "blue"}`} aria-hidden="true">{item.kind === "cat" && item.photoId ? <img src={`/api/assistant?photoId=${encodeURIComponent(item.photoId)}`} alt="" /> : item.kind === "cat" ? "♧" : item.kind === "income" ? "↗" : item.kind === "expense" ? "↘" : "✦"}</span>
                <span>{item.title && <strong>{item.title}</strong>}<p>{item.detail}</p></span>
                <span className="rowHint">{item.kind === "cat" ? `${item.createdAt} ›` : item.correctionId ? "Corrected · Edit ›" : "Edit ›"}</span>
              </button>
            ))}
            {!rows.length && !loading && <div className="empty">{tab === "cats" ? "No cats yet. Tell the assistant about a cat, or add one under Records." : "Your first memory will appear here."}</div>}
          </div>
        </section>
      )}

      {capture && <CaptureSheet initial={capture} sessionId={sessionId} onClose={closeCapture} onSaved={saved} />}
      {editing && <CorrectionSheet item={editing} onClose={() => setEditing(null)} onSaved={saved} />}
      {detail && <CatHistorySheet detail={detail} onClose={() => setDetail(null)} onAddUpdate={() => { const name = detail.cat.displayName; setDetail(null); openCapture("text", `Update ${name}: `); }} />}

      {toast && <div className="toast" role="status">✓ {toast}</div>}
      <nav aria-label="Main">
        {TABS.map(([id, icon, label]) => <button type="button" key={id} className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}><span aria-hidden="true">{icon}</span>{label}</button>)}
      </nav>
    </main>
  );
}
