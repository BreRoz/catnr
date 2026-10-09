import { env } from "cloudflare:workers";
import { serve } from "../../../manage/http";
import * as resource from "../../../manage/roll-call";

const handlers = serve(() => env.DB, resource);
export const GET = handlers.GET;
