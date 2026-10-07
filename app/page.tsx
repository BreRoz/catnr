import { requireChatGPTUser } from "./chatgpt-auth";
import RescueClient from "./rescue-client";
export const dynamic = "force-dynamic";
export default async function Home(){ await requireChatGPTUser("/"); return <RescueClient/>; }
