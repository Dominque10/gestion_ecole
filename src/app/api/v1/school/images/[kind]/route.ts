import { isSchoolImageKind, readSchoolImage } from "@/modules/settings/school-profile";
import { getSession } from "@/server/auth/session";
import { recordSupportRead } from "@/server/auth/support";

/**
 * Image de l'école de session (logo, cachet, signature). Droits vérifiés à chaque requête :
 * logo pour tout le personnel, cachet et signature pour la direction (et le Support, tracé).
 * L'URL porte la version du fichier (?v=…) : le navigateur peut la garder en cache sans risque.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/v1/school/images/[kind]">) {
  const { kind } = await ctx.params;
  const session = await getSession();
  if (!session) return new Response(null, { status: 401 });
  if (!isSchoolImageKind(kind)) return new Response(null, { status: 404 });

  const image = await readSchoolImage(session.principal, kind);
  if (!image) return new Response(null, { status: 404 });
  await recordSupportRead(session.principal, `school.image.${kind}`);

  return new Response(Buffer.from(image.bytes), {
    headers: {
      "Content-Type": image.type,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
