"use client";
import { useEffect, useState } from "react";
import { getJson } from "./api";
import { buildRollCall, resolveRange, type RollCallData, type TimeFrame } from "../share/roll-call";
import { renderRollCallPng } from "../share/roll-call-image";

const FRAMES: Array<[TimeFrame, string]> = [
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["month", "This month"],
  ["custom", "Custom dates"],
];
const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Builds the 1080×1350 weekly "roll call" picture from the records, then shares or downloads it as a PNG. */
export default function RollCallShare() {
  const [frame, setFrame] = useState<TimeFrame>("7d");
  const [start, setStart] = useState(""),
    [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState<string | null>(null);
  const [png, setPng] = useState<{ blob: Blob; url: string; name: string } | null>(null);

  useEffect(() => () => void (png && URL.revokeObjectURL(png.url)), [png]);

  async function make() {
    setBusy(true);
    setError(null);
    setEmpty(null);
    setPng(null);
    try {
      const range = resolveRange(frame, localDay(), { start, end });
      const data = await getJson<RollCallData>("roll-call", { from: range.start, to: range.end });
      const roll = buildRollCall(data, range);
      if (!roll.cats.length) {
        setEmpty(`No activity between ${roll.dateLabel}, so there is no image to make.`);
        return;
      }
      const blob = await renderRollCallPng(roll);
      setPng({ blob, url: URL.createObjectURL(blob), name: `roll-call-${range.start}-to-${range.end}.png` });
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Could not make the image. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!png) return;
    const link = document.createElement("a");
    link.href = png.url;
    link.download = png.name;
    link.click();
  }

  async function share() {
    if (!png) return;
    const file = new File([png.blob], png.name, { type: "image/png" });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: "Meet the cats we're helping" });
      else download();
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError("Could not open the share options. Use Download instead.");
    }
  }

  return (
    <details className="dataCard">
      <summary>
        <strong>Share a roll call</strong>
      </summary>
      <p>A picture of the cats you helped, with the key numbers, for social media or donors.</p>
      <label>
        Time frame{" "}
        <select value={frame} onChange={(e) => setFrame(e.target.value as TimeFrame)}>
          {FRAMES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {frame === "custom" && (
        <div className="recDates">
          <label>
            From <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            To <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
      )}
      <button type="button" className="primary dataLink" onClick={make} disabled={busy}>
        {busy ? "Making the image…" : "Make the image"}
      </button>
      {error && (
        <p className="recError" role="alert">
          {error}
        </p>
      )}
      {empty && (
        <p className="recNotice" role="status">
          {empty}
        </p>
      )}
      {png && (
        <>
          <img src={png.url} alt="Roll call preview" style={{ width: "100%", maxWidth: 360, display: "block", margin: "12px 0" }} />
          <button type="button" className="primary dataLink" onClick={share}>
            Share
          </button>{" "}
          <button type="button" className="recLink" onClick={download}>
            Download PNG
          </button>
        </>
      )}
    </details>
  );
}
