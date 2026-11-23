import { readFile } from "node:fs/promises";
import path from "node:path";
import { connection } from "next/server";

/**
 * Sert le service worker construit par `scripts/build-sw.mts` (absent en développement : 404).
 * Jamais mis en cache par le navigateur, pour que chaque version soit prise aussitôt.
 */
export async function GET() {
  await connection();
  let content: Buffer;
  try {
    content = await readFile(path.join(process.cwd(), ".next", "sw.js"));
  } catch {
    return new Response("", { status: 404 });
  }
  return new Response(new Uint8Array(content), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
