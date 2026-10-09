"use client";
import { useState } from "react";

const URL_ = "/api/manage/export?download=zip&profile=shareable";
const FILE_NAME = "cat-tracker-share-summary.zip";

/** Opens the phone's share sheet (email, text, AirDrop…) with the summary attached; falls back to a normal download. */
export default function ShareSummary() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function share() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(URL_);
      if (!res.ok) throw new Error("fetch failed");
      const file = new File([await res.blob()], FILE_NAME, { type: "application/zip" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Cat Tracker summary", text: "Cat Tracker safe-to-share summary" });
      } else {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(file);
        link.download = FILE_NAME;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError("Could not prepare the summary. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="primary dataLink" onClick={share} disabled={busy}>
        {busy ? "Preparing…" : "Share the summary"}
      </button>
      {error && (
        <p className="recError" role="alert">
          {error}
        </p>
      )}
      <p className="recHint">
        Opens your share options (email, text and more).{" "}
        <a href={URL_} download>
          Download instead
        </a>
      </p>
    </>
  );
}
