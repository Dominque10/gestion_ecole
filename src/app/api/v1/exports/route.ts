import { ZodError } from "zod";
import { buildExport, ExportError } from "@/modules/exports/lists";
import { exportRequestFromParams } from "@/modules/exports/params";
import { tableToXlsx } from "@/modules/exports/table";
import { ForbiddenError } from "@/server/auth/permissions";
import { getSession } from "@/server/auth/session";
import { StudentError } from "@/modules/students/errors";
import { GradingError } from "@/modules/grading/errors";

/** Export Excel d'une liste (4g) ; le PDF de la même liste passe par la file des documents. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response(null, { status: 401 });
  try {
    const table = await buildExport(
      session.principal,
      exportRequestFromParams(new URL(request.url).searchParams),
    );
    return new Response(new Uint8Array(await tableToXlsx(table)), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${table.fileName}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response(null, { status: 403 });
    if (
      error instanceof ZodError ||
      error instanceof ExportError ||
      error instanceof StudentError ||
      error instanceof GradingError
    ) {
      return new Response(null, {
        status: error instanceof ExportError && error.code === "dateRange" ? 400 : 404,
      });
    }
    throw error;
  }
}
