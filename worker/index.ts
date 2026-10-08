/** Cloudflare Worker entry point: checks who is calling, then hands the request to the app. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { verifyAccessJwt } from "./access";
import { purgeExpired } from "../app/portability/retention";
import { observe, recordAuthFailure } from "../app/ops/observe";
import { recordEvent } from "../app/ops/log";
import { opsStatus, type OpsEnv } from "../app/ops/status";

interface Env extends OpsEnv {
  ASSETS: Fetcher;
  DB: D1Database;
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

  let identity: Awaited<ReturnType<typeof verifyAccessJwt>>;
  try {
    identity = await verifyAccessJwt(request.headers.get("cf-access-jwt-assertion"), teamDomain, audience);
  } catch {
    // Access' public keys could not be fetched. Refuse (fail closed) with a clear, retryable answer.
    return new Response("Sign-in is temporarily unavailable. Please try again in a minute.", {
      status: 503,
      headers: { "retry-after": "30" },
    });
  }
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

// Largest request body any route accepts (a photo is capped lower, inside the app). Refused before any work is done.
const MAX_REQUEST_BYTES = 3_000_000;
const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

function hardened(response: Response, url: URL): Response {
  const out = new Response(response.body, response);
  out.headers.set("x-content-type-options", "nosniff");
  out.headers.set("referrer-policy", "same-origin");
  out.headers.set("x-frame-options", "DENY");
  out.headers.set("permissions-policy", "microphone=(self), camera=(self), geolocation=()");
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_ops/")) out.headers.set("cache-control", "private, no-store");
  return out;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const started = Date.now();
    const authed = await withIdentity(request, env);
    if (authed instanceof Response) {
      ctx.waitUntil(
        recordAuthFailure(
          env.DB,
          url.pathname,
          authed.status,
          authed.status === 503 ? "sign-in unavailable or not configured" : "missing or invalid Access token",
        ),
      );
      return hardened(authed, url);
    }
    request = authed;

    if (url.pathname === "/_ops/status" && request.method === "GET") {
      return hardened(Response.json(await opsStatus(env.DB, env)), url);
    }
    if (
      url.pathname.startsWith("/api/") &&
      WRITE_METHODS.has(request.method) &&
      Number(request.headers.get("content-length") || 0) > MAX_REQUEST_BYTES
    ) {
      ctx.waitUntil(observe(env.DB, { pathname: url.pathname, status: 413, ms: 0, owner: request.headers.get(USER_ID_HEADER) }));
      return hardened(Response.json({ outcome: "rejected", message: "That request is too large." }, { status: 413 }), url);
    }

    if (url.pathname === "/_vinext/image") {
      if (!env.IMAGES) return env.ASSETS.fetch(new Request(new URL(url.searchParams.get("url") || "/", request.url)));
      const images = env.IMAGES;
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await images
              .input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    const response = await handler.fetch(request, env, ctx);
    ctx.waitUntil(
      observe(env.DB, {
        pathname: url.pathname,
        status: response.status,
        ms: Date.now() - started,
        owner: request.headers.get(USER_ID_HEADER),
      }),
    );
    return hardened(response, url);
  },
};

export default {
  ...worker,
  // Daily: applies the two automatic retention rules (see app/portability/retention.ts).
  // Success and failure are both recorded so a silently dead job shows up (see scripts/ops-report.mjs).
  async scheduled(_event: unknown, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const started = Date.now();
        try {
          const result = await purgeExpired(env.DB);
          await recordEvent(env.DB, {
            kind: "job_ok",
            route: "scheduled:purge",
            durationMs: Date.now() - started,
            detail: JSON.stringify(result),
          });
        } catch (error) {
          await recordEvent(env.DB, { kind: "job_failure", route: "scheduled:purge", durationMs: Date.now() - started, detail: error });
          throw error; // Let Cloudflare mark the invocation as failed as well.
        }
      })(),
    );
  },
};
