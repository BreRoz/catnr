import { env } from "cloudflare:workers";
import { aiConfig } from "../../config";
import { handleRead } from "./read";
import { handleDelete } from "./undo";
import { handleWrite } from "./write";

// The assistant API. This file only connects the Worker's bindings to the handlers; the work is in the modules
// beside it (read, write, undo), each of which takes the database and settings it needs as arguments.

export const GET = (req: Request) => handleRead(req, env.DB, env.PHOTOS);
export const POST = (req: Request) => handleWrite(req, false, { db: env.DB, ai: aiConfig(env) });
export const PATCH = (req: Request) => handleWrite(req, true, { db: env.DB, ai: aiConfig(env) });
export const DELETE = (req: Request) => handleDelete(req, env.DB);
