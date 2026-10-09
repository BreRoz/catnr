"use client";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { createKeyer, post, type Reply } from "./assistant-client";
import ConfirmCard from "./confirm-card";
import { Sheet } from "./dialog";
import { createDraftStore, type Draft } from "./drafts";
import { describeMicError, workingLabel } from "./feedback";
import { resizeToDataUrl } from "./records/api";

export type CaptureMode = Draft["mode"];
export const drafts = createDraftStore();

// The browser's speech API is not in TypeScript's DOM types.
type SpeechResult = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((e: SpeechResult) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

const TITLES: Record<CaptureMode, [eyebrow: string, title: string]> = {
  ask: ["ASK YOUR ASSISTANT", "What do you want to know?"],
  photo: ["PHOTO + CONTEXT", "Add a cat photo"],
  mic: ["VOICE", "Say what happened"],
  text: ["TYPE AN UPDATE", "Tell me what happened"],
};

type Props = { initial: Pick<Draft, "mode" | "text" | "photo">; sessionId: string; onClose: () => void; onSaved: (toast: string) => void };

/**
 * Voice, typed, photo and question capture. Whatever Ari has typed, said or photographed is kept on the
 * phone as a draft until it is saved, so closing the sheet, a dropped signal or a reload never loses it.
 */
export default function CaptureSheet({ initial, sessionId, onClose, onSaved }: Props) {
  const [mode, setMode] = useState<CaptureMode>(initial.mode);
  const [text, setText] = useState(initial.text);
  const [photo, setPhoto] = useState(initial.photo);
  const [reply, setReply] = useState<Reply | null>(null);
  const [busy, setBusy] = useState<"save" | "confirm" | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState("");
  const [photoNote, setPhotoNote] = useState("");
  const keyer = useRef(createKeyer());
  const speech = useRef<Recognition | null>(null);
  const latest = useRef({ mode, text, photo });
  const finished = useRef(false);
  const libraryRef = useRef<HTMLInputElement>(null),
    cameraRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    latest.current = { mode, text, photo };
  });

  // Keep the draft current while Ari works, and once more when the sheet goes away.
  useEffect(() => {
    if (mode === "ask") return; // a question is cheap to retype and must never be mistaken for an unsent update
    const timer = window.setTimeout(() => {
      const saved = drafts.save({ mode, text, photo });
      if (saved === "text-only") setPhotoNote("This photo is too large to keep if the page reloads. Your words are kept.");
    }, 300);
    return () => window.clearTimeout(timer);
  }, [mode, text, photo]);
  useEffect(
    () => () => {
      speech.current?.abort();
      if (!finished.current && latest.current.mode !== "ask") drafts.save(latest.current);
    },
    [],
  );
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Date.now() - started), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  // Save the draft before the parent re-reads it: the unmount cleanup below runs too late for that.
  const closeKeepingDraft = () => {
    stopMic();
    if (!finished.current && latest.current.mode !== "ask") drafts.save(latest.current);
    onClose();
  };
  const done = useCallback(
    (toast: string) => {
      finished.current = true;
      drafts.clear();
      onSaved(toast);
    },
    [onSaved],
  );

  const startMic = () => {
    setReply(null);
    setMicError("");
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      setMicError("Voice typing isn’t available in this browser, so I switched to typing. It works the same way.");
      setMode("text");
      return;
    }
    const base = latest.current.text.trim();
    const recognition = new Ctor();
    speech.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onstart = () => setListening(true);
    recognition.onresult = (event) => {
      let words = "";
      for (let i = 0; i < event.results.length; i++) words += event.results[i][0].transcript;
      setText(base ? `${base} ${words.trim()}` : words.trim());
    };
    recognition.onerror = (event) => {
      setListening(false);
      setMicError(describeMicError(event.error));
    };
    recognition.onend = () => setListening(false);
    setMode("mic");
    try {
      recognition.start();
    } catch {
      setMicError(describeMicError("audio-capture"));
    }
  };
  const stopMic = () => {
    speech.current?.stop();
    setListening(false);
  };

  // Opened from the Speak button: start listening straight away.
  useEffect(() => {
    if (initial.mode !== "mic") return;
    const timer = window.setTimeout(startMic, 0); // still within the tap that opened the sheet
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoNote("");
    try {
      setPhoto({ name: file.name, dataUrl: await resizeToDataUrl(file) });
      setMode((m) => (m === "ask" ? m : "photo"));
      setReply(null);
    } catch {
      setReply({
        outcome: "rejected",
        title: "Couldn’t use that photo",
        message:
          "I couldn’t read that photo. It may be in a format this browser can’t open. Nothing was saved. Take a new photo or choose a different one — your typed words are kept.",
      });
    }
  };

  const submit = async () => {
    stopMic();
    if (busy || (!text.trim() && !photo)) return;
    setElapsed(0);
    setBusy("save");
    setReply(null);
    const payload = { input: text.trim(), mode, sessionId, photoName: photo?.name, photoDataUrl: photo?.dataUrl };
    const result = await post(
      { ...payload, requestKey: keyer.current.keyFor(payload) },
      { action: mode === "ask" ? "answer that" : "save that update", kind: mode === "ask" ? "read" : "write", inputKept: true },
    );
    setBusy(null);
    if (!result.ok) {
      setReply(result.reply);
      return;
    }
    keyer.current.reset();
    const d = result.data;
    const changed = (d.created?.length || 0) + (d.updated?.length || 0);
    if (changed && mode !== "ask" && !d.clarification) done("Records added");
    else {
      // A question the server has stored keeps Ari's words safely on its side; the phone's copy is no longer an unsent update.
      if (d.clarification && d.clarificationId) {
        finished.current = true;
        drafts.clear();
      }
      setReply(d);
    }
  };

  const confirm = async () => {
    const id = reply?.proposalId;
    if (!id || busy) return;
    setElapsed(0);
    setBusy("confirm");
    const result = await post(
      { confirmProposalId: id, photoDataUrl: photo?.dataUrl, requestKey: `confirm-${id}` },
      { action: "save that update", kind: "write", inputKept: true },
    );
    setBusy(null);
    if (!result.ok) {
      setReply(result.reply);
      return;
    }
    done("Records added");
  };
  const dismiss = async () => {
    const id = reply?.proposalId;
    setReply(null);
    if (id) await post({ rejectProposalId: id }, { action: "cancel that", kind: "read" }, "DELETE"); // an unanswered proposal expires on its own
  };

  const [eyebrow, title] =
    mode === "mic" ? [listening ? "MICROPHONE IS ON" : "VOICE", listening ? "I’m listening…" : "Review what I heard"] : TITLES[mode];
  const needsConfirm = reply?.outcome === "needs_confirmation";
  const ready = !!text.trim() || !!photo;
  const submitLabel = busy === "save" ? "Working…" : mode === "ask" ? "Ask" : mode === "photo" ? "Save photo" : "Review & record";
  const retryable = ["uncertain", "retryable", "ai_unavailable", "failed"].includes(reply?.outcome ?? "");
  const step = photo ? "photo" : mode === "ask" ? "answer" : "assistant";

  return (
    <Sheet title={title} eyebrow={eyebrow} onClose={closeKeepingDraft} className="captureSheet" footer={false}>
      {mode === "mic" && (
        <div className="voiceCapture">
          <button
            type="button"
            data-autofocus
            className={`bigMic ${listening ? "isListening" : ""}`}
            onClick={listening ? stopMic : startMic}
            aria-label={listening ? "Stop microphone" : "Start microphone"}
            aria-pressed={listening}
          >
            {listening ? "■" : "●"}
          </button>
          <p aria-live="polite">
            {listening
              ? text
                ? ""
                : "Start speaking — your words will appear below."
              : text
                ? "Tap the microphone to keep talking, or fix any words below."
                : "Tap the microphone and start speaking."}
          </p>
        </div>
      )}
      {micError && (
        <div className="micError" role="alert">
          {micError}
        </div>
      )}
      {mode === "photo" && (
        <div className="photoChooser">
          {photo ? <img src={photo.dataUrl} alt="Your selected cat" /> : <p>Choose an existing photo or take a new one.</p>}
          <div>
            <button type="button" data-autofocus={photo ? undefined : true} onClick={() => libraryRef.current?.click()}>
              Photo library
            </button>
            <button type="button" onClick={() => cameraRef.current?.click()}>
              Take photo
            </button>
          </div>
          <small>If the camera doesn’t open, allow camera access for this browser in your phone’s settings, or use Photo library.</small>
          {photoNote && <small role="status">{photoNote}</small>}
          {photo && (
            <button type="button" className="recLink" onClick={() => setPhoto(null)}>
              Remove this photo
            </button>
          )}
        </div>
      )}
      <input ref={libraryRef} type="file" accept="image/*" hidden onChange={onPhoto} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
      <label className="srOnly" htmlFor="capture-text">
        {mode === "ask" ? "Your question" : "What happened"}
      </label>
      <textarea
        id="capture-text"
        data-autofocus={mode === "text" || mode === "ask" ? true : undefined}
        value={text}
        readOnly={listening}
        enterKeyHint="send"
        onChange={(e) => setText(e.target.value)}
        placeholder={
          mode === "photo"
            ? "Add what you know about this cat (optional)…"
            : mode === "mic"
              ? "What I heard appears here — you can edit it."
              : mode === "ask"
                ? "Ask this app anything about your TNR work."
                : "Write normally…"
        }
      />
      {needsConfirm && reply && <ConfirmCard reply={reply} busy={busy === "confirm"} onYes={confirm} onNo={dismiss} />}
      {reply && !needsConfirm && (
        <div
          className={`reply ${reply.clarification ? "clarify" : reply.outcome === "committed" || mode === "ask" ? "" : "failed"}`}
          role={reply.outcome === "committed" || reply.clarification || mode === "ask" ? "status" : "alert"}
        >
          <strong>
            {reply.clarification
              ? "One quick question"
              : reply.title ||
                (mode === "ask"
                  ? "Answer"
                  : reply.outcome === "committed"
                    ? "Recorded"
                    : reply.outcome === "uncertain"
                      ? "Save status unknown"
                      : "Update not saved")}
          </strong>
          <p>{reply.clarification || reply.message}</p>
        </div>
      )}
      {busy && (
        <p className="working" role="status">
          {workingLabel(busy === "confirm" ? "saving" : step, elapsed)}
        </p>
      )}
      <button type="button" className="primary" disabled={!!busy || !ready} onClick={submit}>
        {retryable ? "Try again" : submitLabel}
      </button>
      <button type="button" className="close" onClick={closeKeepingDraft}>
        {ready ? "Close — keep my draft" : "Close"}
      </button>
    </Sheet>
  );
}
