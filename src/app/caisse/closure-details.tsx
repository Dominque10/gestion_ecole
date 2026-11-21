import { t } from "@/i18n";
import { formatDateTime } from "@/lib/dates";
import { formatXAF } from "@/lib/money";
import type { Closure } from "@/modules/finance/closures";

export function ClosureDetails({ closure }: { closure: Closure }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p>{t("closure.closedOn", { date: formatDateTime(closure.closedAt) })}</p>
      <p>
        {t("closure.receipts", { n: closure.receiptCount })} ·{" "}
        {t("closure.total", { montant: formatXAF(closure.total) })}
      </p>
      <p>{t("closure.counted", { montant: formatXAF(closure.countedCash) })}</p>
      <p className={closure.difference === 0 ? "" : "font-semibold text-red-800"}>
        {closure.difference === 0
          ? t("closure.differenceNone")
          : t("closure.difference", { montant: formatXAF(closure.difference) })}
      </p>
      {closure.note && <p>{closure.note}</p>}
      {closure.reopenReason && (
        <p>{t("closure.reopenedReason", { motif: closure.reopenReason })}</p>
      )}
    </div>
  );
}
