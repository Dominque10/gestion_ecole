import { documentFile } from "@/modules/documents/requests";
import { getSession } from "@/server/auth/session";

/** Téléchargement du PDF produit, réservé à la personne qui l'a demandé. */
export async function GET(_request: Request, ctx: RouteContext<"/api/v1/documents/[id]/file">) {
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return new Response(null, { status: 401 });
  const file = await documentFile(session.principal, id);
  if (!file) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${file.fileName.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
