import type { ImportError } from "@/modules/students/import-parse";

/** État du formulaire d'import (hors du fichier d'actions : il ne peut exporter que des fonctions). */
export type ImportState = {
  status: "idle" | "checked" | "imported" | "error";
  message: string | null;
  total: number;
  valid: number;
  errors: ImportError[];
};

export const idleImportState: ImportState = {
  status: "idle",
  message: null,
  total: 0,
  valid: 0,
  errors: [],
};
