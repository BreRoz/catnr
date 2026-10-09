import { getUser } from "./auth";
import { firstNameFromEmail } from "./display-name";
import RescueClient from "./rescue-client";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await getUser();
  if (!user) return <main style={{ padding: 24 }}>Please sign in to Cat Tracker.</main>;
  return <RescueClient name={firstNameFromEmail(user.email)} />;
}
