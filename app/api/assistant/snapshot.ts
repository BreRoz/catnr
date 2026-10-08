import type { CatRow, D1, Snapshot } from "./types";

/** The owner's current records, given to the interpreter so it can recognise cats and people Ari already mentioned. */
export async function snapshot(db: D1, owner: string): Promise<Snapshot> {
  const [cats, people, recentEvents] = await Promise.all([
    db
      .prepare(
        "SELECT c.*,co.name origin FROM cats c LEFT JOIN colonies co ON co.id=c.origin_colony_id AND co.owner_id=c.owner_id WHERE c.owner_id=? AND c.archived_at IS NULL ORDER BY c.updated_at DESC LIMIT 150",
      )
      .bind(owner)
      .all<CatRow>(),
    db
      .prepare(
        "SELECT id,name,type,general_location,contact FROM people WHERE owner_id=? AND archived_at IS NULL ORDER BY created_at DESC LIMIT 100",
      )
      .bind(owner)
      .all(),
    db
      .prepare(
        "SELECT id,cat_id,event_type,occurred_at,location,notes FROM active_events WHERE owner_id=? ORDER BY occurred_at DESC LIMIT 120",
      )
      .bind(owner)
      .all(),
  ]);
  return { cats: cats.results, people: people.results, recentEvents: recentEvents.results };
}
