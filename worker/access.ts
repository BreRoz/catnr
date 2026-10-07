/**
 * Cloudflare Access verification.
 *
 * Access sits in front of the worker and signs every request it lets through
 * with a JWT in the `Cf-Access-Jwt-Assertion` header. We verify that token
 * against the team's public keys and only then hand the app a trusted identity.
 */

export type AccessIdentity = { userId: string; email: string };

type Jwk = JsonWebKey & { kid: string };
type Certs = { keys: Jwk[] };

const CERT_TTL_MS = 10 * 60 * 1000;
let certCache: { domain: string; keys: Map<string, CryptoKey>; fetchedAt: number } | null = null;

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function decodeJson<T>(segment: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(segment))) as T;
}

async function signingKeys(teamDomain: string, forceRefresh: boolean): Promise<Map<string, CryptoKey>> {
  if (!forceRefresh && certCache && certCache.domain === teamDomain && Date.now() - certCache.fetchedAt < CERT_TTL_MS) {
    return certCache.keys;
  }
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access certs unavailable (${response.status})`);
  const certs = (await response.json()) as Certs;
  const keys = new Map<string, CryptoKey>();
  for (const jwk of certs.keys) {
    keys.set(jwk.kid, await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
  }
  certCache = { domain: teamDomain, keys, fetchedAt: Date.now() };
  return keys;
}

/** Returns the verified identity, or null when the token is missing or invalid. */
export async function verifyAccessJwt(token: string | null, teamDomain: string, audience: string): Promise<AccessIdentity | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;

  let header: { alg?: string; kid?: string };
  let payload: { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; sub?: string; email?: string };
  try {
    header = decodeJson(headerPart);
    payload = decodeJson(payloadPart);
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || !header.kid) return null;

  let key = (await signingKeys(teamDomain, false)).get(header.kid);
  // Access rotates keys; refetch once if this kid is new to us.
  if (!key) key = (await signingKeys(teamDomain, true)).get(header.kid);
  if (!key) return null;

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlDecode(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!valid) return null;

  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(audience)) return null;
  if (payload.iss !== `https://${teamDomain}`) return null;
  if (!payload.exp || payload.exp < now) return null;
  if (payload.nbf && payload.nbf > now + 60) return null;
  if (!payload.email || !payload.sub) return null;

  // Records are keyed by email so they survive the Access app being recreated.
  const email = payload.email.trim().toLowerCase();
  return { userId: email, email };
}
