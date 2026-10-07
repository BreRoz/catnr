"use client";
import { useRef, useState } from "react";
import { photoUrl, resizeToDataUrl } from "./api";
import { useAction, useList } from "./hooks";
import { Message, Pager, Sheet, when } from "./ui";

type Photo = { id: string; catId: string | null; takenAt: string; caption: string | null; archivedAt: string | null };

/** A cat's photos. Listings carry no image data; each thumbnail loads (and is cached) on its own. */
export default function PhotoGallery({ catId, catName, onChanged }: { catId: string; catName: string; onChanged?: () => void }) {
  const [page, setPage] = useState(1);
  const [showHidden, setShowHidden] = useState(false);
  const [open, setOpen] = useState<Photo | null>(null);
  const [caption, setCaption] = useState("");
  const [uploadError, setUploadError] = useState("");
  const files = useRef<HTMLInputElement>(null);
  const { data, loading, error, reload } = useList<Photo>("photos", { catId, page, archived: showHidden ? "archived" : "active" });
  const upload = useAction();
  const edit = useAction();

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setUploadError("");
    try {
      const photoDataUrl = await resizeToDataUrl(file);
      if (await upload.run("photos", { catId, photoDataUrl })) { setPage(1); reload(); onChanged?.(); }
    } catch (e) { setUploadError(e instanceof Error ? e.message : "I couldn’t read that photo."); }
    if (files.current) files.current.value = "";
  };
  const change = async (body: Record<string, unknown>, method: "POST" | "PATCH" = "POST") => {
    if (await edit.run("photos", body, method)) { setOpen(null); reload(); onChanged?.(); }
  };

  return (
    <section className="recGallery" aria-label={`Photos of ${catName}`}>
      <div className="recRow">
        <h3>Photos{data ? ` (${data.total})` : ""}</h3>
        <div>
          <button type="button" className="recLink" onClick={() => { setShowHidden((v) => !v); setPage(1); }}>{showHidden ? "Show gallery" : "Show hidden"}</button>
          <button type="button" className="recSmall" disabled={upload.busy} onClick={() => files.current?.click()}>{upload.busy ? "Adding…" : "+ Add photo"}</button>
        </div>
      </div>
      <input ref={files} type="file" accept="image/*" hidden onChange={(e) => choose(e.target.files?.[0])} />
      <Message error={uploadError || upload.error || error} notice={upload.notice} />
      <div className="recGrid" aria-busy={loading}>
        {data?.items.map((p) => (
          <button key={p.id} type="button" className="recThumb" onClick={() => { setOpen(p); setCaption(p.caption ?? ""); edit.clear(); }} aria-label={p.caption || `Photo from ${when(p.takenAt)}`}>
            <img src={photoUrl(p.id)} alt={p.caption || `${catName}, ${when(p.takenAt)}`} loading="lazy" decoding="async" />
          </button>
        ))}
      </div>
      {data && !data.items.length && <p className="recEmpty">{showHidden ? "No hidden photos." : "No photos yet."}</p>}
      <Pager page={data} onPage={setPage} />
      {open && (
        <Sheet title={open.caption || `Photo from ${when(open.takenAt)}`} eyebrow={catName.toUpperCase()} onClose={() => setOpen(null)}>
          <img className="recFull" src={photoUrl(open.id)} alt={open.caption || catName} />
          <form onSubmit={(e) => { e.preventDefault(); change({ action: "caption", id: open.id, caption }, "PATCH"); }} className="recForm">
            <div className="recField"><label htmlFor="photo-caption">Caption</label><input id="photo-caption" value={caption} onChange={(e) => setCaption(e.target.value)} /></div>
            <Message error={edit.error} notice={edit.notice} />
            <div className="recButtons">
              <button className="primary" type="submit" disabled={edit.busy || caption.trim() === (open.caption ?? "")}>Save caption</button>
              <button type="button" className="recSecondary" disabled={edit.busy} onClick={() => change({ action: open.archivedAt ? "restore" : "archive", id: open.id })}>{open.archivedAt ? "Put back in gallery" : "Hide from gallery"}</button>
            </div>
          </form>
        </Sheet>
      )}
    </section>
  );
}
