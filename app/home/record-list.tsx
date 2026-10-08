import type { CatGroup, Row } from "./types";

const CAT_GROUPS: [CatGroup, string][] = [
  ["current", "Current cats"],
  ["adopted", "Adopted cats"],
];

const iconClass = (kind: string) => (kind === "income" || kind === "in-kind" ? "green" : kind === "expense" ? "coral" : "blue");

function RowIcon({ item }: { item: Row }) {
  if (item.kind === "cat" && item.photoId) return <img src={`/api/assistant?photoId=${encodeURIComponent(item.photoId)}`} alt="" />;
  if (item.kind === "cat") return <>♧</>;
  if (item.kind === "income") return <>↗</>;
  if (item.kind === "expense") return <>↘</>;
  return <>✦</>;
}

type Props = {
  tab: "cats" | "activity";
  rows: Row[];
  /** Cats tab only: which group is showing, how many cats are in each, and how to switch. */
  catGroup: CatGroup;
  catCounts: Record<CatGroup, number>;
  onCatGroup: (group: CatGroup) => void;
  loading: boolean;
  onOpenCat: (id: string) => void;
  onEdit: (row: Row) => void;
};

/** The Cats and Activity tabs: one tappable button per line (a cat opens its history; an entry opens for correction). */
export default function RecordList({ tab, rows, catGroup, catCounts, onCatGroup, loading, onOpenCat, onEdit }: Props) {
  return (
    <section className="recent">
      <div className="sectionTitle">
        <div>
          <p className="eyebrow">RECORDED</p>
          <h3>{tab === "cats" ? "Cats" : "All activity"}</h3>
        </div>
        {tab === "activity" && <span className="editHint">Tap an entry to correct it</span>}
      </div>
      {tab === "cats" && (
        <div className="recTabs" role="tablist" aria-label="Cats">
          {CAT_GROUPS.map(([group, label]) => (
            <button
              key={group}
              type="button"
              role="tab"
              aria-selected={catGroup === group}
              className={catGroup === group ? "active" : ""}
              onClick={() => onCatGroup(group)}
            >
              {label} ({catCounts[group]})
            </button>
          ))}
        </div>
      )}
      <div className="memoryList">
        {rows.slice(0, 50).map((item) => (
          <button
            type="button"
            key={item.id}
            className={`rowBtn ${item.kind === "cat" ? "catRow" : "activityRow"}`}
            onClick={() => (item.kind === "cat" ? onOpenCat(item.id) : onEdit(item))}
          >
            <span className={`eventIcon ${iconClass(item.kind)}`} aria-hidden="true">
              <RowIcon item={item} />
            </span>
            <span>
              {item.title && <strong>{item.title}</strong>}
              <p>{item.detail}</p>
            </span>
            <span className="rowHint">
              {item.kind === "cat" ? `${item.createdAt} ›` : item.correctionId ? "Corrected · Edit ›" : "Edit ›"}
            </span>
          </button>
        ))}
        {!rows.length && !loading && (
          <div className="empty">
            {tab === "cats"
              ? catGroup === "adopted"
                ? "No adopted cats yet."
                : catCounts.adopted
                  ? "No current cats."
                  : "No cats yet. Tell the assistant about a cat, or add one under Records."
              : "Your first memory will appear here."}
          </div>
        )}
      </div>
    </section>
  );
}
