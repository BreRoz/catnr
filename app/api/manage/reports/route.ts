import { env } from "cloudflare:workers";
import { serve } from "../../../manage/http";
import * as resource from "../../../manage/reports";

const handlers = serve(() => env.DB, resource);
export const GET = handlers.GET;
