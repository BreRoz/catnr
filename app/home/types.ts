import type { Memory } from "../correction-sheet";

export type Cat = {
  id: string;
  displayName: string;
  description: string;
  status: string;
  origin: string;
  events: number;
  photoId?: string | null;
};

export type LifetimeStats = {
  catsRecorded: number;
  catsFoundHomes: number;
  spayedNeutered: number;
  vaccinated: number;
  cashInText: string;
  cashOutText: string;
};

export type Banner = { message: string; retry?: () => void };

/** One line in the Cats or Activity list. */
export type Row = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  createdAt: string;
  photoId?: string | null;
  correctionId?: string | null;
  memory?: Memory;
};

export const EMPTY_STATS: LifetimeStats = {
  catsRecorded: 0,
  catsFoundHomes: 0,
  spayedNeutered: 0,
  vaccinated: 0,
  cashInText: "$0.00",
  cashOutText: "$0.00",
};

export const TABS = [
  ["home", "⌂", "Home"],
  ["cats", "♧", "Cats"],
  ["activity", "◎", "Activity"],
  ["dashboard", "▥", "Dashboard"],
  ["records", "☰", "Records"],
] as const;
