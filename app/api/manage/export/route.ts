import { env } from "cloudflare:workers";
import { serve } from "../../../manage/http";
import * as resource from "../../../portability/export";

export const GET = serve(() => env.DB, resource.resource).GET;
