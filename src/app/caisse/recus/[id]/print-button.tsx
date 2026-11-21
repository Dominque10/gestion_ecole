"use client";

import { t } from "@/i18n";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="h-12 rounded-md bg-blue-700 px-4 font-semibold text-white"
    >
      {t("receipt.print")}
    </button>
  );
}
