import { env } from "cloudflare:workers";
import { serve } from "../../../manage/http";
import * as merge from "../../../manage/merge";

// GET previews a merge (read-only); POST performs it. There is no PATCH.
const handlers = serve(() => env.DB, { read: merge.read, write: (ctx, body) => merge.write(ctx, body) });
export const GET = handlers.GET;
export const POST = handlers.POST;
