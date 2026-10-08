import { CAT_STATUSES } from "../../vocabulary";
import type { CatRow } from "./types";

/** The statuses the interpreter may set, as a set for quick checks (the list itself is shared: app/vocabulary.ts). */
export const CAT_STATUS_SET: ReadonlySet<string> = new Set(CAT_STATUSES);

/** The name Ari would use for a cat: its name, or else whatever describes it. */
export const display = (c: Partial<CatRow>) =>
  String(c.name || [c.distinguishing_characteristics, c.appearance, c.sex, c.age_class].filter(Boolean).join(" ") || "Unnamed cat");

export const isCatStatus = (value: string | null | undefined): value is string => !!value && CAT_STATUS_SET.has(value);
