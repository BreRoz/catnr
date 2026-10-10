/** The sign-in page and the two endpoints behind it (/auth/google, /auth/signout). These are the only routes that work signed out. */
import { verifyGoogleIdToken } from "./google";
import { createSession, sessionCookie } from "./session";

export type AuthEnv = { GOOGLE_CLIENT_ID?: string; SESSION_SECRET?: string };

export const PUBLIC_PATHS = new Set(["/signin", "/auth/google", "/auth/signout"]);

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function signInPage(clientId: string, notice = ""): Response {
  const id = JSON.stringify(clientId).replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · Cat Tracker</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#faf7f2;color:#2b2622}
main{max-width:22rem;padding:2rem 1.25rem;text-align:center}
h1{font-size:1.5rem;margin:0 0 .5rem}p{margin:0 0 1.5rem;color:#5d544c}
#button{display:flex;justify-content:center;min-height:44px}
#message{margin-top:1rem;min-height:1.5rem;color:#a02020}
</style></head><body><main>
<h1>Cat Tracker</h1>
<p>Sign in with your Google account to open your rescue assistant.</p>
<div id="button"></div>
<div id="message" role="alert">${escapeHtml(notice)}</div>
</main>
<script src="https://accounts.google.com/gsi/client" async defer></script>
<script>
const message = document.getElementById('message');
async function onCredential(response) {
  message.textContent = 'Signing you in…';
  try {
    const result = await fetch('/auth/google', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: response.credential }) });
    if (result.ok) { location.replace('/'); return; }
    message.textContent = result.status === 503 ? 'Sign-in is temporarily unavailable. Please try again in a minute.' : 'That Google account could not be signed in. Please try again.';
  } catch { message.textContent = 'Could not reach the server. Check your connection and try again.'; }
}
window.onload = function () {
  if (!window.google) { message.textContent = 'Google sign-in could not load. Check your connection and reload.'; return; }
  google.accounts.id.initialize({ client_id: ${id}, callback: onCredential, ux_mode: 'popup' });
  google.accounts.id.renderButton(document.getElementById('button'), { theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'pill' });
};
</script></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

const isHttps = (url: URL) => url.protocol === "https:";
const sameOrigin = (request: Request, url: URL) => {
  const origin = request.headers.get("origin");
  return !origin || origin === url.origin;
};

/** Handles the signed-out routes. Returns null for any other path. */
export async function handleAuthRoute(request: Request, env: AuthEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const secret = env.SESSION_SECRET?.trim() ?? "";

  if (url.pathname === "/signin" && request.method === "GET") return signInPage(clientId);

  if (url.pathname === "/auth/signout" && request.method === "POST") {
    if (!sameOrigin(request, url)) return new Response("Forbidden", { status: 403 });
    return new Response(null, { status: 204, headers: { "set-cookie": sessionCookie("", isHttps(url), 0) } });
  }

  if (url.pathname === "/auth/google" && request.method === "POST") {
    if (!sameOrigin(request, url)) return new Response("Forbidden", { status: 403 });
    if (!clientId || !secret) return new Response("Sign-in is not configured for this site yet.", { status: 503 });
    let credential: unknown;
    try {
      credential = ((await request.json()) as { credential?: unknown }).credential;
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    let identity;
    try {
      identity = await verifyGoogleIdToken(typeof credential === "string" ? credential : null, clientId);
    } catch {
      return new Response("Sign-in is temporarily unavailable. Please try again in a minute.", {
        status: 503,
        headers: { "retry-after": "30" },
      });
    }
    if (!identity) return new Response("That Google sign-in was not accepted.", { status: 401 });
    const session = await createSession(identity.email, secret);
    return new Response(null, { status: 204, headers: { "set-cookie": sessionCookie(session, isHttps(url)) } });
  }

  if (PUBLIC_PATHS.has(url.pathname)) return new Response("Method not allowed", { status: 405 });
  return null;
}
