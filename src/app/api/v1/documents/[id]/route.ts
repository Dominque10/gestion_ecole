import { documentStatus } from "@/modules/documents/requests";
import { getSession } from "@/server/auth/session";

/** État d'un document demandé (interrogé par la page toutes les secondes). */
export async function GET(_request: Request, ctx: RouteContext<"/api/v1/documents/[id]">) {
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const status = await documentStatus(session.principal, id);
  if (!status) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
