import { formatMoney } from "../../money";
import { buildReport } from "../../reports/queries";
import { display } from "./cats";
import { listPending } from "./clarifications";
import { listCorrections } from "./corrections";
import { revision } from "./reliability";
import { noStoreJson, unauthorized } from "./responses";
import { ownerFrom } from "../../identity";
import type { CatRow, D1 } from "./types";

// GET /api/assistant — everything the app screen reads. Every query is limited to the signed-in owner.

const notFound = () => new Response("Not found", { status: 404 });

/** Photos are stored either inline (a data: URL) or in the photo bucket under the owner's own prefix. */
async function photoResponse(db: D1, bucket: R2Bucket | undefined, owner: string, photoId: string): Promise<Response> {
  const photo = await db
    .prepare("SELECT storage_location FROM photos WHERE id=? AND owner_id=?")
    .bind(photoId, owner)
    .first<{ storage_location: string }>();
  if (!photo) return notFound();
  const location = photo.storage_location;
  if (location.startsWith("data:image/")) {
    const [header, data] = location.split(",");
    return new Response(
      Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
      {
        headers: { "content-type": header.slice(5).split(";")[0], "cache-control": "private, no-store" },
      },
    );
  }
  if (!location.startsWith(`cats/${encodeURIComponent(owner)}/`) || !bucket) return notFound();
  const object = await bucket.get(location);
  if (!object) return notFound();
  return new Response(object.body, {
    headers: { "content-type": object.httpMetadata?.contentType || "image/jpeg", "cache-control": "private, no-store" },
  });
}

async function catDetail(db: D1, owner: string, catId: string): Promise<Response> {
  const cat = await db
    .prepare(
      "SELECT c.*,co.name origin FROM cats c LEFT JOIN colonies co ON co.id=c.origin_colony_id AND co.owner_id=c.owner_id WHERE c.id=? AND c.owner_id=?",
    )
    .bind(catId, owner)
    .first<CatRow>();
  if (!cat) return Response.json({ message: "Cat not found." }, { status: 404 });
  const [events, photos] = await Promise.all([
    db
      .prepare(
        "SELECT e.*,p.name person_name FROM active_events e LEFT JOIN people p ON p.id=e.person_id AND p.owner_id=e.owner_id WHERE e.owner_id=? AND e.cat_id=? ORDER BY e.occurred_at DESC",
      )
      .bind(owner, catId)
      .all(),
    db.prepare("SELECT id,taken_at,caption FROM photos WHERE owner_id=? AND cat_id=? ORDER BY taken_at DESC").bind(owner, catId).all(),
  ]);
  return Response.json({ cat: { ...cat, displayName: display(cat) }, events: events.results, photos: photos.results });
}

// Money reaches the client as exact integer minor units plus display text; nothing is floating point.
const shapeMemory = <M extends { amountMinor?: number | null; currency?: string | null; detail?: string | null }>(m: M): M =>
  m.amountMinor == null ? m : { ...m, detail: `${formatMoney(m.amountMinor, m.currency || undefined)} · ${m.detail || ""}` };

const CATS_SQL =
  "SELECT c.*,co.name origin,(SELECT COUNT(*) FROM active_events e WHERE e.cat_id=c.id AND e.owner_id=c.owner_id) events,(SELECT id FROM photos p WHERE p.cat_id=c.id AND p.owner_id=c.owner_id ORDER BY taken_at DESC LIMIT 1) photo_id FROM cats c LEFT JOIN colonies co ON co.id=c.origin_colony_id AND co.owner_id=c.owner_id WHERE c.owner_id=? AND c.archived_at IS NULL ORDER BY c.updated_at DESC";

// The newest 50 events and money records together, each marked with the correction (if any) that produced it.
const MEMORIES_SQL =
  "SELECT id,'event' recordType,event_type kind,COALESCE((SELECT name FROM cats WHERE id=cat_id AND cats.owner_id=active_events.owner_id),event_type) title,notes detail,created_at createdAt,version,NULL amountMinor,NULL currency,(SELECT id FROM corrections c WHERE c.owner_id=active_events.owner_id AND c.replacement_id=active_events.id AND c.kind='correction' AND c.status='applied') correctionId FROM active_events WHERE owner_id=? UNION ALL SELECT id,'transaction',CASE WHEN transaction_type='in_kind_donation' THEN 'in-kind' WHEN direction='inflow' THEN 'income' ELSE 'expense' END,description,CASE WHEN amount_minor IS NOT NULL THEN COALESCE(category,'') ELSE COALESCE(CAST(quantity AS TEXT)||' '||unit||' · '||item,'Resource') END,created_at,version,amount_minor amountMinor,currency,(SELECT id FROM corrections c WHERE c.owner_id=active_transactions.owner_id AND c.replacement_id=active_transactions.id AND c.kind='correction' AND c.status='applied') correctionId FROM active_transactions WHERE owner_id=? ORDER BY createdAt DESC LIMIT 50";

// Every cat ever recorded, except ones that were merged away into another cat.
const CATS_RECORDED_SQL =
  "SELECT COUNT(*) catsRecorded FROM cats WHERE owner_id=? AND NOT EXISTS(SELECT 1 FROM merges m WHERE m.owner_id=cats.owner_id AND m.record_type='cat' AND m.merged_id=cats.id)";

async function overview(db: D1, owner: string): Promise<Response> {
  const [cats, memories, stats, report] = await Promise.all([
    db.prepare(CATS_SQL).bind(owner).all<CatRow & { events: number; photo_id: string | null }>(),
    db.prepare(MEMORIES_SQL).bind(owner, owner).all(),
    db.prepare(CATS_RECORDED_SQL).bind(owner).first<{ catsRecorded: number }>(),
    buildReport(db, owner),
  ]);
  return Response.json({
    revision: await revision(db, owner),
    cats: cats.results.map((c) => ({
      id: c.id,
      displayName: c.name || "",
      description: [c.appearance, c.sex, c.age_class, c.origin].filter(Boolean).join(" · "),
      status: c.current_status,
      origin: c.origin,
      events: c.events,
      photoId: c.photo_id,
    })),
    memories: memories.results.map(shapeMemory),
    stats: {
      catsRecorded: stats?.catsRecorded || 0,
      catsFoundHomes: report.cats.adopted,
      spayedNeutered: report.cats.sterilized,
      vaccinated: report.cats.vaccinated,
      cashIn: report.money.cashIn,
      cashOut: report.money.cashOut,
      cashInText: report.money.cashInText,
      cashOutText: report.money.cashOutText,
    },
  });
}

export async function handleRead(req: Request, db: D1, photos: R2Bucket | undefined): Promise<Response> {
  const owner = ownerFrom(req);
  if (!owner) return unauthorized();
  const url = new URL(req.url);
  const photoId = url.searchParams.get("photoId");
  if (photoId) return photoResponse(db, photos, owner, photoId);
  if (url.searchParams.has("clarifications")) return noStoreJson({ clarifications: await listPending(db, owner) });
  if (url.searchParams.has("corrections"))
    return noStoreJson({ corrections: await listCorrections(db, owner, url.searchParams.get("recordId")) });
  const catId = url.searchParams.get("catId");
  if (catId) return catDetail(db, owner, catId);
  return overview(db, owner);
}
