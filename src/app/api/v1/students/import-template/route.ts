import { buildImportTemplate } from "@/modules/students/import";
import { ForbiddenError } from "@/server/auth/permissions";
import { getSession } from "@/server/auth/session";

/** Modèle d'import à remplir (Excel ou CSV), avec les niveaux et classes de l'école. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response(null, { status: 401 });
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  try {
    const file = await buildImportTemplate(session.principal, {
      format,
      academicYearId: url.searchParams.get("annee"),
    });
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response(null, { status: 403 });
    throw error;
  }
}
