"use client";

import { useState } from "react";
import { requestDocumentAction } from "@/app/documents/actions";
import { t } from "@/i18n";
import type { DocumentRequest } from "@/modules/documents/documents";

type Phase = "idle" | "preparing" | "ready" | "failed" | "slow" | "error";

/** Le PDF est produit par le worker : on dépose la demande, on attend qu'il soit prêt, on télécharge. */
export function DownloadPdfButton({
  request,
  label,
  variant = "primary",
}: {
  request: DocumentRequest;
  label: string;
  variant?: "primary" | "secondary";
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPhase("preparing");
    setError(null);
    const result = await requestDocumentAction(request);
    if ("error" in result) {
      setPhase("error");
      setError(result.error);
      return;
    }
    // Jusqu'à 60 s d'attente (téléphone, 3G : on interroge toutes les 1,5 s).
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const response = await fetch(`/api/v1/documents/${result.jobId}`, { cache: "no-store" });
      if (!response.ok) continue;
      const status = (await response.json()) as { state: "pending" | "ready" | "failed" };
      if (status.state === "ready") {
        setPhase("ready");
        // Téléchargement d'un fichier (route d'API), pas une page : navigation du navigateur voulue.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(`/api/v1/documents/${result.jobId}/file`);
        return;
      }
      if (status.state === "failed") {
        setPhase("failed");
        return;
      }
    }
    setPhase("slow");
  }

  const message =
    phase === "preparing"
      ? t("documents.preparing")
      : phase === "ready"
        ? t("documents.ready")
        : phase === "failed"
          ? t("documents.failed")
          : phase === "slow"
            ? t("documents.slow")
            : error;
  const styles =
    variant === "primary" ? "bg-blue-700 text-white" : "border border-zinc-400 bg-white";
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={start}
        disabled={phase === "preparing"}
        className={`h-12 rounded-md px-4 font-semibold disabled:opacity-60 ${styles}`}
      >
        {label}
      </button>
      {message && (
        <p
          role={phase === "preparing" || phase === "ready" ? "status" : "alert"}
          className="text-sm"
        >
          {message}
        </p>
      )}
    </div>
  );
}
