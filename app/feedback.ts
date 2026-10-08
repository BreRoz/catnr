// Turns any failed request into three plain answers for Ari: what failed, whether anything was saved,
// and what to do next. Pure so it can be tested without a browser.

export type FailureInput = {
  /** What Ari was doing, as a short phrase: "save that update", "load your cats". */
  action: string;
  /** "write" changes records (retry needs a key); "read" only fetches. */
  kind: "write" | "read";
  status?: number;
  outcome?: string;
  /** The server's own explanation, when it sent one. */
  message?: string;
  /** fetch() itself failed: no signal, airplane mode, dropped connection. */
  network?: boolean;
  /** We gave up waiting. */
  timedOut?: boolean;
  /** The reply wasn't the JSON the app expects (usually the sign-in page after a session expired). */
  unreadable?: boolean;
  /** Whether Ari's typed text/photo are still on screen or on the phone. */
  inputKept?: boolean;
};

export type Failure = { title: string; message: string; saved: "no" | "unknown"; retrySafe: boolean };

const KEPT = " What you typed is still here.";

export function describeFailure(f: FailureInput): Failure {
  const kept = f.inputKept ? KEPT : "";
  const write = f.kind === "write";

  if (f.network || f.timedOut) {
    if (!write)
      return {
        title: `Couldn’t ${f.action}`,
        message: `${f.timedOut ? "The server took too long to answer." : "There’s no connection right now."} Nothing was changed. Check your signal and tap Try again.`,
        saved: "no",
        retrySafe: true,
      };
    return {
      title: "Not sure if that saved",
      message: `${f.timedOut ? "The server took too long to answer" : "The connection dropped"} while I tried to ${f.action}, so I can’t tell whether it saved. Tap Try again — it checks first and won’t create a duplicate.${kept}`,
      saved: "unknown",
      retrySafe: true,
    };
  }
  if (f.unreadable || f.status === 401 || f.status === 403) {
    return {
      title: "Please sign in again",
      message: `Your sign-in has expired, so I couldn’t ${f.action}. Nothing was changed. Reload the page to sign in, then try again.${f.inputKept ? " What you typed is saved on this phone and will be waiting." : ""}`,
      saved: "no",
      retrySafe: true,
    };
  }
  if (f.outcome === "uncertain")
    return {
      title: "Not sure if that saved",
      message: f.message || `I can’t confirm that ${f.action} worked. Try again — it checks first and won’t create a duplicate.${kept}`,
      saved: "unknown",
      retrySafe: true,
    };
  if (f.outcome === "ai_unavailable")
    return {
      title: "The assistant is unavailable",
      message:
        f.message ||
        `The assistant couldn’t be reached, so nothing was saved.${kept} Try again shortly, or use Records, which works without it.`,
      saved: "no",
      retrySafe: true,
    };
  if (f.status === 413)
    return {
      title: "That’s too large",
      message: `The photo or text was too big to send, so I couldn’t ${f.action}. Nothing was saved. Choose a smaller photo or shorten the text.${kept}`,
      saved: "no",
      retrySafe: false,
    };
  if (f.status === 429)
    return {
      title: "Too many requests",
      message: `I’m being asked for too much at once, so I couldn’t ${f.action}. Nothing was changed. Wait a moment and try again.${kept}`,
      saved: "no",
      retrySafe: true,
    };
  if (f.message) {
    // The server's explanation already says what happened and what to do; add only what it can't know.
    const tail =
      f.outcome === "conflict" || f.outcome === "rejected" || /nothing|not saved|didn’t|still here/i.test(f.message)
        ? ""
        : write
          ? " Nothing was saved."
          : "";
    return {
      title: f.outcome === "conflict" ? "These records changed" : `Couldn’t ${f.action}`,
      message: `${f.message}${tail}`,
      saved: "no",
      retrySafe: f.outcome !== "rejected",
    };
  }
  if (f.status && f.status >= 500)
    return {
      title: `Couldn’t ${f.action}`,
      message: write
        ? `The server had a problem (error ${f.status}). I can’t be sure whether it saved. Tap Try again — it checks first and won’t create a duplicate.${kept}`
        : `The server had a problem (error ${f.status}). Nothing was changed. Try again in a moment.`,
      saved: write ? "unknown" : "no",
      retrySafe: true,
    };
  return {
    title: `Couldn’t ${f.action}`,
    message: `That didn’t work${f.status ? ` (error ${f.status})` : ""}. Nothing was changed. Try again, and if it keeps failing, reload the page.${kept}`,
    saved: "no",
    retrySafe: true,
  };
}

/** Plain-language mic problems; the browser's speech codes mean nothing to Ari. */
export function describeMicError(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked. Allow the microphone for this site in your browser settings (the lock or ⓘ icon next to the address), then tap the microphone again. Or use Type an update.";
    case "audio-capture":
      return "I can’t find a working microphone. Check that nothing else is using it, then tap the microphone again. Or use Type an update.";
    case "network":
      return "Voice typing needs a connection and it dropped. What I heard so far is kept below. Tap the microphone to continue, or type the rest.";
    case "no-speech":
      return "I didn’t hear anything. Tap the microphone and speak, or use Type an update.";
    case "aborted":
      return "";
    default:
      return "I couldn’t hear that clearly. What I heard so far is kept below. Tap the microphone to try again, or type it.";
  }
}

/** Status text for work in progress; the work is a single request, so only honest, coarse stages are shown. */
export function workingLabel(step: "saving" | "assistant" | "photo" | "undo" | "answer", elapsedMs: number): string {
  const base = {
    saving: "Saving…",
    assistant: "Understanding your update…",
    photo: "Uploading your photo and reading your update…",
    undo: "Undoing…",
    answer: "Looking through your records…",
  }[step];
  return elapsedMs > 12000 ? `${base} Still working — slow signal or a busy assistant. Your input is safe.` : base;
}
