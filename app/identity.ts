/**
 * Who is making this request. The identity headers are set only by worker/index.ts after it has verified the
 * Cloudflare Access token; nothing in a request body is ever used to decide ownership.
 */
export function ownerFrom(req: Request): string | null {
  const owner = req.headers.get("x-catnr-user-id");
  const reserved = owner === "local-owner" || owner?.startsWith("legacy:");
  return owner && req.headers.get("x-catnr-user-email") && owner.trim() && !reserved ? owner : null;
}
