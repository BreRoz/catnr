import { all, ManageError, type D1 } from "./common";
import { periodFrom } from "./reports";
import type { Resource } from "./http";

const IN_RANGE = "owner_id=? AND cat_id IS NOT NULL AND substr(occurred_at,1,10) BETWEEN ? AND ?";

// Read-only. Returns the owner's raw rows for the share image's date range; app/share/roll-call.ts decides what they mean.
export const read: Resource["read"] = async (db: D1, owner, url) => {
  const { from, to } = periodFrom(url.searchParams);
  if (!from || !to) throw new ManageError("Pick a start and end date.");
  const [events, cats, photos] = await Promise.all([
    all(
      db,
      `SELECT id,cat_id,event_type,occurred_at,created_at,superseded_at,voided_at FROM active_events WHERE ${IN_RANGE} ORDER BY occurred_at DESC LIMIT 5000`,
      owner,
      from,
      to,
    ),
    all(
      db,
      `SELECT id,name,appearance,distinguishing_characteristics,current_status,archived_at FROM cats
       WHERE owner_id=? AND archived_at IS NULL AND id IN (SELECT cat_id FROM active_events WHERE ${IN_RANGE})`,
      owner,
      owner,
      from,
      to,
    ),
    all(
      db,
      `SELECT id,cat_id,taken_at,archived_at FROM photos
       WHERE owner_id=? AND archived_at IS NULL AND cat_id IN (SELECT cat_id FROM active_events WHERE ${IN_RANGE}) ORDER BY taken_at DESC`,
      owner,
      owner,
      from,
      to,
    ),
  ]);
  return { events, cats, photos };
};
