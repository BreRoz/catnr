import { env } from "cloudflare:workers";
import { serve } from "../../../manage/http";
import * as duplicates from "../../../manage/duplicates";

// GET suggests likely duplicates; POST {action:"dismiss"} remembers "these are different".
const handlers = serve(() => env.DB, { read: duplicates.read, write: (ctx, body) => duplicates.write(ctx, body) });
export const GET = handlers.GET;
export const POST = handlers.POST;
