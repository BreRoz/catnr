import type { CaptureMode } from "../capture-sheet";
import type { Draft } from "../drafts";
import TodayCalendar from "./today-calendar";

/** The big "What happened today?" card with the two ways to start an update. */
function Hero({ onOpen }: { onOpen: (mode: CaptureMode) => void }) {
  return (
    <section className="hero">
      <img className="peekCat" src="/tnr-cat-peeking.png" alt="" />
      <TodayCalendar />
      <div className="heroCopy">
        <p className="eyebrow light">THE FULL STORY OF YOUR RESCUE WORK.</p>
        <h2>What happened today?</h2>
        <p>Tell me naturally. I’ll organize the details and ask only when I’m unsure.</p>
      </div>
      <div className="recordActions">
        <button type="button" className="talk" onClick={() => onOpen("mic")}>
          <span className="mic" aria-hidden="true">
            ●
          </span>
          <span className="actionCopy">
            <b>SPEAK AN UPDATE</b>
            <small>Open microphone</small>
          </span>
        </button>
        <button type="button" className="typeUpdate" onClick={() => onOpen("text")}>
          <span className="typeIcon" aria-hidden="true">
            Aa
          </span>
          <span>
            <strong>Type an update</strong>
            <small>Open text window</small>
          </span>
        </button>
      </div>
    </section>
  );
}

/** An update Ari started but did not send; it is kept on the phone until she continues or discards it. */
export function UnsentUpdate({ draft, onContinue, onDiscard }: { draft: Draft; onContinue: () => void; onDiscard: () => void }) {
  return (
    <section className="reply clarify" aria-label="Unsent update">
      <strong>You have an update that isn’t saved yet</strong>
      <p>
        {draft.text ? `“${draft.text.slice(0, 120)}${draft.text.length > 120 ? "…" : ""}”` : "A photo you chose"}
        {draft.text && draft.photo ? " (with a photo)" : ""}. It’s kept on this phone.
      </p>
      <div className="recButtons">
        <button type="button" className="primary" onClick={onContinue}>
          Continue
        </button>
        <button type="button" className="recSecondary" onClick={onDiscard}>
          Discard
        </button>
      </div>
    </section>
  );
}

function QuickAction({
  icon,
  tone,
  title,
  hint,
  onClick,
}: {
  icon: string;
  tone: string;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}>
      <span className={`actionIcon ${tone}`} aria-hidden="true">
        {icon}
      </span>
      <span>
        <strong>{title}</strong>
        <small>{hint}</small>
      </span>
      <b aria-hidden="true">›</b>
    </button>
  );
}

export function QuickActions({ onOpen }: { onOpen: (mode: CaptureMode) => void }) {
  return (
    <section className="quickGrid">
      <QuickAction icon="▣" tone="photo" title="Add photo" hint="Document a cat" onClick={() => onOpen("photo")} />
      <QuickAction icon="?" tone="ask" title="Ask your assistant" hint="Query your records" onClick={() => onOpen("ask")} />
    </section>
  );
}

export default Hero;
