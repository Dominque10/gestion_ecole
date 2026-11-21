import { t } from "@/i18n";
import type { YearStatus } from "@/modules/settings/years";

const BADGE: Record<YearStatus, string> = {
  active: "bg-green-100 text-green-900",
  upcoming: "bg-blue-100 text-blue-900",
  archived: "bg-zinc-200 text-zinc-800",
};

export function YearStatusBadge({ status }: { status: YearStatus }) {
  return (
    <span className={`rounded px-2 py-0.5 text-sm font-medium ${BADGE[status]}`}>
      {t(`years.status.${status}`)}
    </span>
  );
}
