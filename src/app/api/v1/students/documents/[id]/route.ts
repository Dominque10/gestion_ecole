import { readStudentDocument } from "@/modules/students/media";
import { getSession } from "@/server/auth/session";
import { recordSupportRead } from "@/server/auth/support";
import { ForbiddenError } from "@/server/auth/permissions";
import { StudentError } from "@/modules/students/errors";

/** Pièce jointe d'un élève de l'école de session ; droits vérifiés à chaque requête. */
export async function GET(_request: Request, ctx: RouteContext<"/api/v1/students/documents/[id]">) {
  const { id } = await ctx.params;
  const session = await getSession();
  if (!session) return new Response(null, { status: 401 });
  try {
    const image = await readStudentDocument(session.principal, id);
    if (!image) return new Response(null, { status: 404 });
    await recordSupportRead(session.principal, "student.document");
    return new Response(Buffer.from(image.bytes), {
      headers: {
        "Content-Type": image.type,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof StudentError) {
      return new Response(null, { status: 404 });
    }
    throw error;
  }
}
