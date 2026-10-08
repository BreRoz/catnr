"use client";
import { Sheet } from "./dialog";

export type CatDetail = {
  cat: Record<string, string | null> & { displayName: string };
  events: Array<{
    id: string;
    event_type: string;
    occurred_at: string;
    notes: string | null;
    location: string | null;
    person_name: string | null;
  }>;
  photos: Array<{ id: string; taken_at: string; caption: string | null }>;
};

export default function CatHistorySheet({
  detail,
  onClose,
  onAddUpdate,
}: {
  detail: CatDetail;
  onClose: () => void;
  onAddUpdate: () => void;
}) {
  const { cat } = detail;
  return (
    <Sheet title={cat.displayName} eyebrow="CAT HISTORY" onClose={onClose} className="detailSheet" footer={false}>
      {detail.photos[0] && (
        <img className="detailPhoto" src={`/api/assistant?photoId=${encodeURIComponent(detail.photos[0].id)}`} alt={cat.displayName} />
      )}
      <div className="catFacts">
        <span>{cat.current_status}</span>
        {cat.origin && <span>{cat.origin}</span>}
        {cat.current_location && <span>{cat.current_location}</span>}
      </div>
      <div className="timeline" role="list" aria-label="History">
        {detail.events.map((e) => (
          <article role="listitem" key={e.id}>
            <time>{e.occurred_at.slice(0, 10)}</time>
            <div>
              <strong>{e.event_type.replaceAll("_", " ")}</strong>
              <p>{e.notes}</p>
            </div>
          </article>
        ))}
        {!detail.events.length && <div className="empty">No history yet.</div>}
      </div>
      <button type="button" className="primary" onClick={onAddUpdate}>
        Add an update
      </button>
      <button type="button" className="close" onClick={onClose}>
        Close
      </button>
    </Sheet>
  );
}
