import { env } from "cloudflare:workers";
import { serve } from "../../../manage/http";
import * as resource from "../../../portability/import";

const handlers = serve(() => env.DB, resource.resource);
export const GET = handlers.GET;
export const POST = handlers.POST;
