/**
 * The sign-in session: a signed cookie that says "this email signed in with Google until <time>".
 * It is HMAC-signed with SESSION_SECRET, so it cannot be forged or edited without that secret.
 */

export const SESSION_COOKIE = "catnr_session";
export const SESSION_SECONDS = 30 * 24 * 3600;

const encoder = new TextEncoder();

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  let text = "";
  for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createSession(email: string, secret: string, now = Date.now()): Promise<string> {
  const body = base64Url(encoder.encode(JSON.stringify({ email, exp: Math.floor(now / 1000) + SESSION_SECONDS })));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body));
  return `${body}.${base64Url(signature)}`;
}

/** The signed-in email, or null if the cookie is missing, edited, signed with another secret or expired. */
export async function readSession(cookieHeader: string | null, secret: string, now = Date.now()): Promise<string | null> {
  if (!cookieHeader || !secret) return null;
  const raw = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!raw) return null;
  const [body, signature] = raw.split(".");
  if (!body || !signature) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromBase64Url(signature), encoder.encode(body));
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as { email?: unknown; exp?: unknown };
    if (typeof claims.email !== "string" || !claims.email || typeof claims.exp !== "number" || claims.exp < now / 1000) return null;
    return claims.email;
  } catch {
    return null;
  }
}

export function sessionCookie(value: string, secure: boolean, maxAge = SESSION_SECONDS): string {
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
