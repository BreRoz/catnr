// Words shared by the whole app: the screens, manual record management (app/manage) and the AI path
// (app/api/assistant) all use these lists, so a record made by hand and one made by voice look identical.
export const CAT_STATUSES = [
  "observed",
  "captured",
  "awaiting vet",
  "recovering",
  "foster",
  "available for adoption",
  "adoption pending",
  "adopted",
  "returned to colony",
  "lost",
  "deceased",
] as const;
