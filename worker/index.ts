/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { verifyAccessJwt } from "./access";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  IMAGES?: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Trusted identity headers read by the app. Only this worker may set them.
const USER_ID_HEADER = "x-catnr-user-id";
const USER_EMAIL_HEADER = "x-catnr-user-email";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

async function withIdentity(request: Request, env: Env): Promise<Request | Response> {
  const headers = new Headers(request.headers);
  headers.delete(USER_ID_HEADER);
  headers.delete(USER_EMAIL_HEADER);

  const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.ACCESS_AUD?.trim();
  if (!teamDomain || !audience) {
    // Local development runs without Access; deployed workers fail closed.
    if (!LOCAL_HOSTS.has(new URL(request.url).hostname)) {
      return new Response("Sign-in is not configured for this site yet.", { status: 503 });
    }
    headers.set(USER_ID_HEADER, "dev@localhost");
    headers.set(USER_EMAIL_HEADER, "dev@localhost");
    return new Request(request, { headers });
  }

  const identity = await verifyAccessJwt(request.headers.get("cf-access-jwt-assertion"), teamDomain, audience);
  if (!identity) return new Response("Please sign in to Cat Tracker.", { status: 401 });
  headers.set(USER_ID_HEADER, identity.userId);
  headers.set(USER_EMAIL_HEADER, identity.email);
  return new Request(request, { headers });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const authed = await withIdentity(request, env);
    if (authed instanceof Response) return authed;
    request = authed;

    if (url.pathname === "/_vinext/image") {
      if (!env.IMAGES) return env.ASSETS.fetch(new Request(new URL(url.searchParams.get("url") || "/", request.url)));
      const images = env.IMAGES;
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await images.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
