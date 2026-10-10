/**
 * Google sign-in verification.
 *
 * The sign-in page gets a signed ID token (a JWT) from Google. We verify its signature against Google's public
 * keys and check it was issued for THIS app (audience), is unexpired, and belongs to a verified email address.
 * Only then does the worker issue its own session cookie (see session.ts).
 */

export type GoogleIdentity = { userId: string; email: string };

type Jwk = JsonWebKey & { kid: string };

const CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const CERT_TTL_MS = 10 * 60 * 1000;
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
let certCache: { keys: Map<string, CryptoKey>; fetchedAt: number } | null = null;

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function decodeJson<T>(segment: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(segment))) as T;
}

async function signingKeys(forceRefresh: boolean): Promise<Map<string, CryptoKey>> {
  if (!forceRefresh && certCache && Date.now() - certCache.fetchedAt < CERT_TTL_MS) return certCache.keys;
  const response = await fetch(CERTS_URL);
  if (!response.ok) throw new Error(`Google certs unavailable (${response.status})`);
  const certs = (await response.json()) as { keys: Jwk[] };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of certs.keys) {
    keys.set(jwk.kid, await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
  }
  certCache = { keys, fetchedAt: Date.now() };
  return keys;
}

/** Returns the verified identity, or null when the token is missing or invalid. Throws only if Google's keys cannot be fetched. */
export async function verifyGoogleIdToken(token: string | null | undefined, clientId: string): Promise<GoogleIdentity | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;

  let header: { alg?: string; kid?: string };
  let payload: { aud?: string; iss?: string; exp?: number; nbf?: number; sub?: string; email?: string; email_verified?: boolean | string };
  try {
    header = decodeJson(headerPart);
    payload = decodeJson(payloadPart);
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || !header.kid) return null;

  let key = (await signingKeys(false)).get(header.kid);
  // Google rotates keys; refetch once if this kid is new to us.
  if (!key) key = (await signingKeys(true)).get(header.kid);
  if (!key) return null;

  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64UrlDecode(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== clientId) return null;
  if (!payload.iss || !ISSUERS.has(payload.iss)) return null;
  if (!payload.exp || payload.exp < now) return null;
  if (payload.nbf && payload.nbf > now + 60) return null;
  if (!payload.email || !payload.sub) return null;
  if (payload.email_verified !== true && payload.email_verified !== "true") return null;

  // Records are keyed by lower-cased email, the same key they have always had, so existing records stay with their owner.
  const email = payload.email.trim().toLowerCase();
  return { userId: email, email };
}
