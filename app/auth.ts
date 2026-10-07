import { headers } from "next/headers";

export type CatnrUser = { userId: string; email: string };

// Set by worker/index.ts only after it verifies the Cloudflare Access token.
const USER_ID_HEADER = "x-catnr-user-id";
const USER_EMAIL_HEADER = "x-catnr-user-email";

export async function getUser(): Promise<CatnrUser | null> {
  const requestHeaders = await headers();
  const userId = requestHeaders.get(USER_ID_HEADER);
  const email = requestHeaders.get(USER_EMAIL_HEADER);
  return userId && email ? { userId, email } : null;
}
