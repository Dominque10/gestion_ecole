import { connection } from "next/server";
import { healthReport } from "@/server/health";

/**
 * État du service pour la surveillance externe : 200 si tout va bien, 503 sinon.
 * Public, sans donnée : base, file d'attente et worker, chacun « ok » ou « down ».
 */
export async function GET() {
  await connection();
  const report = await healthReport();
  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
