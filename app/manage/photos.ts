import { validatedPhoto } from "../api/assistant/reliability";
import {
  ManageError,
  all,
  dateValue,
  first,
  makeId,
  pageInfo,
  paging,
  recordId,
  text,
  type Ctx,
  type D1,
  type Row,
  type Write,
} from "./common";
import { photoRefusal } from "../ops/limits";
import { recordEvent } from "../ops/log";
import { displayName, loadCat } from "./cats";

// List queries never select storage_location: photos are stored inline, so a gallery page must not
// drag megabytes of image data into memory. Images are fetched one at a time from ?image=<id>.
const META = "p.id,p.cat_id,p.event_id,p.taken_at,p.caption,p.archived_at,p.created_at";
const shape = (p: Row) => ({
  id: p.id,
  catId: p.cat_id,
  eventId: p.event_id,
  takenAt: p.taken_at,
  caption: p.caption,
  archivedAt: p.archived_at,
  createdAt: p.created_at,
  catName: p.cat_id ? displayName(p) : null,
});

export async function listPhotos(db: D1, owner: string, params: URLSearchParams) {
  const { page, pageSize, offset } = paging(params, 24);
  const where = ["p.owner_id=?"],
    binds: string[] = [owner];
  const archived = params.get("archived") || "active";
  if (archived === "active") where.push("p.archived_at IS NULL");
  else if (archived === "archived") where.push("p.archived_at IS NOT NULL");
  else if (archived !== "all") throw new ManageError("archived must be active, archived or all.");
  for (const [param, column] of [
    ["catId", "p.cat_id"],
    ["eventId", "p.event_id"],
  ] as const) {
    const v = params.get(param);
    if (v) {
      where.push(`${column}=?`);
      binds.push(v);
    }
  }
  const filter = where.join(" AND ");
  const [count, rows] = await Promise.all([
    first<{ n: number }>(db, `SELECT COUNT(*) n FROM photos p WHERE ${filter}`, ...binds),
    all(
      db,
      `SELECT ${META},c.name,c.appearance,c.distinguishing_characteristics,c.sex,c.age_class FROM photos p LEFT JOIN cats c ON c.id=p.cat_id AND c.owner_id=p.owner_id
      WHERE ${filter} ORDER BY p.taken_at DESC, p.id LIMIT ? OFFSET ?`,
      ...binds,
      pageSize,
      offset,
    ),
  ]);
  return { items: rows.map(shape), ...pageInfo(Number(count?.n || 0), page, pageSize) };
}

/** One image, owner-scoped. Photos never change after upload, so browsers may cache them privately. */
export type PhotoBucket =
  | { get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null> }
  | undefined;

export async function imageResponse(db: D1, owner: string, id: string, req: Request, bucket?: PhotoBucket) {
  const photo = await first<{ storage_location: string }>(db, "SELECT storage_location FROM photos WHERE id=? AND owner_id=?", id, owner);
  if (!photo) return new Response("Not found", { status: 404 });
  const etag = `"${id}"`,
    headers: Record<string, string> = { "cache-control": "private, max-age=86400", etag };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  const location = photo.storage_location;
  if (location.startsWith("data:image/")) {
    const match = location.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) return new Response("Not found", { status: 404 });
    return new Response(
      Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0)),
      { headers: { ...headers, "content-type": match[1], "x-content-type-options": "nosniff" } },
    );
  }
  if (!location.startsWith(`cats/${encodeURIComponent(owner)}/`) || !bucket) return new Response("Not found", { status: 404 });
  const object = await bucket.get(location);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: { ...headers, "content-type": object.httpMetadata?.contentType || "image/jpeg", "x-content-type-options": "nosniff" },
  });
}

/** ?image=<id> streams one photo (cacheable); anything else lists gallery metadata without image data. */
export const makeResource = (getBucket: () => PhotoBucket) => ({
  read: (db: D1, owner: string, url: URL, req: Request) => {
    const image = url.searchParams.get("image");
    return image ? imageResponse(db, owner, image, req, getBucket()) : listPhotos(db, owner, url.searchParams);
  },
  write,
});

export async function write(ctx: Ctx, body: Row, method: "POST" | "PATCH"): Promise<Write> {
  const action = typeof body.action === "string" ? body.action : method === "POST" ? "upload" : "caption";
  if (action === "upload") {
    const catId = recordId(body.catId, "Cat", true)!,
      cat = await loadCat(ctx.db, ctx.owner, catId);
    if (cat.archived_at) throw new ManageError("This cat is archived. Restore it before adding photos.", 409);
    let eventId = recordId(body.eventId, "Event");
    if (eventId && !(await first(ctx.db, "SELECT id FROM active_events WHERE id=? AND owner_id=? AND cat_id=?", eventId, ctx.owner, catId)))
      throw new ManageError("That history entry doesn’t belong to this cat.", 404);
    eventId ??= null;
    let dataUrl: string | null;
    try {
      dataUrl = validatedPhoto(body.photoDataUrl);
    } catch (error) {
      await recordEvent(ctx.db, { kind: "upload_rejected", owner: ctx.owner, route: "/api/manage/photos", status: 400, detail: error });
      throw new ManageError(error instanceof Error ? error.message : "That photo couldn’t be read.");
    }
    const refusal = await photoRefusal(ctx.db, ctx.owner);
    if (refusal) {
      await recordEvent(ctx.db, {
        kind: "limit_hit",
        owner: ctx.owner,
        route: "/api/manage/photos",
        status: refusal.status,
        detail: refusal.detail,
      });
      throw new ManageError(refusal.message, refusal.status);
    }
    if (!dataUrl) throw new ManageError("Choose a photo to add.");
    const id = makeId("photo"),
      takenAt = dateValue(body.takenAt, "Date taken", false) ?? ctx.now,
      caption = text(body.caption, "Caption", 300);
    const row = { id, cat_id: catId, event_id: eventId, taken_at: takenAt, caption };
    return {
      statements: [
        ctx.stmt(
          "INSERT INTO photos(id,owner_id,cat_id,event_id,storage_location,taken_at,caption,created_at) VALUES(?,?,?,?,?,?,?,?)",
          id,
          ctx.owner,
          catId,
          eventId,
          dataUrl,
          takenAt,
          caption,
          ctx.now,
        ),
        ctx.audit({ recordType: "photo", recordId: id, action: "create", after: row }),
      ],
      response: { outcome: "saved", id, message: "Photo added." },
    };
  }
  const id = recordId(body.id, "Photo", true)!;
  const photo = await first(
    ctx.db,
    "SELECT id,cat_id,event_id,taken_at,caption,archived_at,created_at FROM photos WHERE id=? AND owner_id=?",
    id,
    ctx.owner,
  );
  if (!photo) throw new ManageError("Photo not found.", 404);
  if (action === "caption") {
    const caption = text(body.caption, "Caption", 300);
    if (caption === (photo.caption ?? null)) throw new ManageError("Nothing changed.");
    return {
      statements: [
        ctx.stmt("UPDATE photos SET caption=? WHERE id=? AND owner_id=?", caption, id, ctx.owner),
        ctx.audit({ recordType: "photo", recordId: id, action: "update", before: photo, after: { ...photo, caption } }),
      ],
      response: { outcome: "saved", id, message: "Saved." },
    };
  }
  if (action === "archive" || action === "restore") {
    const archiving = action === "archive";
    if (archiving === !!photo.archived_at)
      throw new ManageError(archiving ? "This photo is already hidden." : "This photo isn’t hidden.", 409);
    const archivedAt = archiving ? ctx.now : null;
    return {
      statements: [
        ctx.stmt("UPDATE photos SET archived_at=? WHERE id=? AND owner_id=?", archivedAt, id, ctx.owner),
        ctx.audit({
          recordType: "photo",
          recordId: id,
          action: archiving ? "archive" : "restore",
          before: photo,
          after: { ...photo, archived_at: archivedAt },
        }),
      ],
      response: { outcome: "saved", id, message: archiving ? "Hidden from the gallery. It isn’t deleted." : "Back in the gallery." },
    };
  }
  throw new ManageError("Unknown action.");
}
