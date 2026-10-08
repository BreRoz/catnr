"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { load } from "./assistant-client";
import CaptureSheet, { drafts, type CaptureMode } from "./capture-sheet";
import CatHistorySheet, { type CatDetail } from "./cat-history-sheet";
import ClarificationCards, { type PendingClarification } from "./clarification-cards";
import CorrectionSheet, { formatActivityDate, type Memory } from "./correction-sheet";
import { confirmDiscard } from "./dialog";
import type { Draft } from "./drafts";
import ErrorBanner from "./home/error-banner";
import Hero, { QuickActions, UnsentUpdate } from "./home/home-screen";
import ImpactSummary from "./home/impact-summary";
import MainNav from "./home/main-nav";
import RecordList from "./home/record-list";
import { EMPTY_STATS, catGroupOf, type Banner, type Cat, type CatGroup, type LifetimeStats, type Row } from "./home/types";
import RecordsApp from "./records/records-app";

/** One id per browser tab, so a question and its answer can be tied together. */
function newSessionId() {
  try {
    const k = "catnr-session";
    const s = sessionStorage.getItem(k) || crypto.randomUUID();
    sessionStorage.setItem(k, s);
    return s;
  } catch {
    return crypto.randomUUID();
  }
}

export default function Home() {
  const [tab, setTab] = useState("home");
  const [catGroup, setCatGroup] = useState<CatGroup>("current");
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
  const [sessionId] = useState(newSessionId);
  const toastTimer = useRef<number | undefined>(undefined);

  const say = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3500);
  }, []);

  const refresh = useCallback(async () => {
    setLoading("records");
    const [questions, records] = await Promise.all([
      load("/api/assistant?clarifications=1", "load your open questions"),
      load("/api/assistant", "load your records"),
    ]);
    if (questions.ok) setPending(questions.data.clarifications || []);
    if (records.ok) {
      setMemories(records.data.memories || []);
      setCats(records.data.cats || []);
      setStats(records.data.stats || EMPTY_STATS);
    }
    const failed = !records.ok ? records : !questions.ok ? questions : null;
    setBanner(failed && !failed.ok ? { message: failed.reply.message, retry: () => void refresh() } : null);
    setSavedDraft(drafts.load()); // also picks up an unsent update left behind by a page reload
    setLoading("");
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

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
  const closeCapture = () => {
    setCapture(null);
    setSavedDraft(drafts.load());
    void refresh();
  };
  const discardDraft = () => {
    if (confirmDiscard()) {
      drafts.clear();
      setSavedDraft(null);
    }
  };
  const saved = (message: string) => {
    setCapture(null);
    setEditing(null);
    setSavedDraft(null);
    setTab("home");
    say(message);
    void refresh();
  };

  const catCounts = {
    current: cats.filter((c) => catGroupOf(c.status) === "current").length,
    adopted: cats.filter((c) => catGroupOf(c.status) === "adopted").length,
  };
  const rows: Row[] =
    tab === "cats"
      ? cats
          .filter((c) => catGroupOf(c.status) === catGroup)
          .map((c) => ({
            id: c.id,
            kind: "cat",
            title: c.displayName,
            detail: `${c.description} · ${c.status}`,
            createdAt: `${c.events} events`,
            photoId: c.photoId,
          }))
      : memories.map((m) => {
          const memory = { ...m, title: formatActivityDate(m.createdAt), detail: `${m.title}${m.detail ? ` — ${m.detail}` : ""}` };
          return { ...memory, memory };
        });

  return (
    <main className="shell">
      <header className="topbar">
        <div className="topbarTitle">
          <p className="eyebrow">HELLO, ARI</p>
          <h1>TNR Assistant</h1>
        </div>
        <span className="avatar" aria-hidden="true">
          A
        </span>
      </header>
      {banner && <ErrorBanner banner={banner} onDismiss={() => setBanner(null)} />}
      {loading && (
        <p className="recHint" role="status">
          {loading === "cat" ? "Opening this cat’s history…" : "Loading your records…"}
        </p>
      )}

      {tab === "home" ? (
        <>
          <Hero onOpen={openCapture} />
          {savedDraft && !capture && (
            <UnsentUpdate
              draft={savedDraft}
              onContinue={() => openCapture(savedDraft.mode === "ask" ? "text" : savedDraft.mode)}
              onDiscard={discardDraft}
            />
          )}
          <ClarificationCards items={pending} sessionId={sessionId} onChanged={refresh} />
          <QuickActions onOpen={openCapture} />
        </>
      ) : tab === "dashboard" ? (
        <ImpactSummary stats={stats} />
      ) : tab === "records" ? (
        <RecordsApp />
      ) : (
        <RecordList
          tab={tab === "cats" ? "cats" : "activity"}
          rows={rows}
          catGroup={catGroup}
          catCounts={catCounts}
          onCatGroup={setCatGroup}
          loading={!!loading}
          onOpenCat={(id) => void openCat(id)}
          onEdit={(row) => setEditing(row.memory!)}
        />
      )}

      {capture && <CaptureSheet initial={capture} sessionId={sessionId} onClose={closeCapture} onSaved={saved} />}
      {editing && <CorrectionSheet item={editing} onClose={() => setEditing(null)} onSaved={saved} />}
      {detail && (
        <CatHistorySheet
          detail={detail}
          onClose={() => setDetail(null)}
          onAddUpdate={() => {
            const name = detail.cat.displayName;
            setDetail(null);
            openCapture("text", `Update ${name}: `);
          }}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          ✓ {toast}
        </div>
      )}
      <MainNav tab={tab} onChange={setTab} />
    </main>
  );
}
