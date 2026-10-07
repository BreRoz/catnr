import { env } from "cloudflare:workers";
import { serve } from "../../../manage/http";
import { makeResource, type PhotoBucket } from "../../../manage/photos";

const handlers = serve(() => env.DB, makeResource(() => (env as unknown as { PHOTOS?: PhotoBucket }).PHOTOS));
export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
