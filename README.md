# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `drizzle/*.sql` are the only definition of the database; `db/schema.ts` is a typed description checked against them (see `docs/STAGE-6-SCHEMA.md`)
- manual record management (no AI) lives in `app/manage/` (server), `app/api/manage/` (routes) and `app/records/` (UI); see `docs/STAGE-7-RECORDS.md`
- every reported number is defined in one place, `app/reports/` (what it counts, what it does not, and the SQL); see `docs/STAGE-8-REPORTS.md`
- export, import, whole-account deletion and data-retention rules live in `app/portability/` (the **My data** tab); see `docs/STAGE-10-PORTABILITY.md`
- deployment checks, monitoring, usage limits, backups, restore and rollback live in `app/ops/` and `scripts/`; see `docs/RUNBOOK.md` and `docs/STAGE-11-OPERATIONS.md`
- `examples/d1/` contains an optional D1 example surface

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run lint`, `npm run typecheck`, `npm run migrations:check`, `npm test`, `npm run test:d1`, `npm run test:e2e`: the checks CI runs; `npm run ci` runs them all. See `docs/STAGE-12-TESTING.md` (including manual phone tests)
- `npm run db:migrate:local`: apply pending migrations to the local development database
- `npm run db:reset:local`: bring a local database that predates migrations in line (backs it up first)
- `npm run deploy` / `npm run deploy:staging`: guarded releases; `npm run verify`, `npm run ops:report`, `npm run backup`, `npm run flag` (see the runbook)
- `npm run db:migrate`: apply pending migrations to the production D1 database (run before `npm run deploy`)
- `npm run test:d1`: run the migrations on the real D1 engine (Miniflare) and check upgrade, constraints and rollback
- Schema changes are hand-written migrations in `drizzle/` (plus a `drizzle/meta/_journal.json` entry); do not use `drizzle-kit generate`

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
