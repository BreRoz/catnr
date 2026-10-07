import { env } from "cloudflare:workers";
import { serve } from "../../../manage/http";
import * as resource from "../../../manage/people";

const handlers = serve(() => env.DB, resource);
export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
