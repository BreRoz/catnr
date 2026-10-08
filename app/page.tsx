import { getUser } from "./auth";
import RescueClient from "./rescue-client";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (!(await getUser())) return <main style={{ padding: 24 }}>Please sign in to Cat Tracker.</main>;
  return <RescueClient />;
}
