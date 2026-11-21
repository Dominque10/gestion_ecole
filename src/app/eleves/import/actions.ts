"use server";

import { refresh } from "next/cache";
import { t } from "@/i18n";
import { checkImport, ImportFileError, runImport } from "@/modules/students/import";
import { requireAction } from "@/server/auth/session";
import { refusalMessage } from "@/server/forms";
import { idleImportState, type ImportState } from "./import-state";

function fileError(error: ImportFileError): string {
  switch (error.reason) {
    case "tooLarge":
      return t("studentImport.errors.tooLarge");
    case "empty":
      return t("studentImport.errors.empty");
    case "tooManyRows":
      return t("studentImport.errors.tooManyRows", { n: error.detail });
    case "missingColumns":
      return t("studentImport.errors.missingColumns", { colonnes: error.detail });
    default:
      return t("studentImport.errors.unreadable");
  }
}

export async function importAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const { principal } = await requireAction("students:write");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ...idleImportState, status: "error", message: t("studentImport.errors.noFile") };
  }
  const input = {
    bytes: new Uint8Array(await file.arrayBuffer()),
    fileName: file.name,
    academicYearId: String(formData.get("annee") ?? ""),
  };
  const mode = formData.get("mode") === "import" ? "import" : "check";
  try {
    if (mode === "check") {
      const report = await checkImport(principal, input);
      return {
        status: "checked",
        message:
          report.errors.length === 0
            ? t("studentImport.checkedOk", { n: report.valid })
            : t("studentImport.checkedErrors", { n: report.errors.length, total: report.total }),
        ...report,
      };
    }
    const result = await runImport(principal, {
      ...input,
      validated: formData.get("validated") === "on",
    });
    if (result.imported === 0) {
      return {
        status: "error",
        message: t("studentImport.notImported", { n: result.errors.length }),
        total: result.total,
        valid: result.valid,
        errors: result.errors,
      };
    }
    refresh();
    return {
      status: "imported",
      message: t("studentImport.imported", { n: result.imported }),
      total: result.total,
      valid: result.valid,
      errors: [],
    };
  } catch (error) {
    const message = error instanceof ImportFileError ? fileError(error) : refusalMessage(error);
    return { ...idleImportState, status: "error", message };
  }
}
