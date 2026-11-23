"use client";

import { useActionState, useState } from "react";
import { FormMessage, inputClass, SubmitButton } from "@/components/form-fields";
import { t } from "@/i18n";
import { formatXAF } from "@/lib/money";
import { payOnlineAction, type PayState } from "./actions";

type Line = { id: string; label: string; remaining: number; overdue: boolean };

/** Choix des échéances (entières) et de l'opérateur ; le total se met à jour en direct. */
export function PayForm({
  enrollmentId,
  lines,
  phone,
}: {
  enrollmentId: string;
  lines: Line[];
  phone: string;
}) {
  const [state, action] = useActionState<PayState, FormData>(payOnlineAction, { error: null });
  // Les échéances en retard sont cochées d'office.
  const [chosen, setChosen] = useState<string[]>(() =>
    lines.filter((l) => l.overdue).map((l) => l.id),
  );
  const total = lines.filter((l) => chosen.includes(l.id)).reduce((sum, l) => sum + l.remaining, 0);

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="inscription" value={enrollmentId} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">{t("online.choose")}</legend>
        {lines.map((l) => (
          <label
            key={l.id}
            className={`flex min-h-14 items-center gap-3 rounded-lg border px-3 ${l.overdue ? "border-red-300" : "border-zinc-300"}`}
          >
            <input
              type="checkbox"
              name="echeance"
              value={l.id}
              checked={chosen.includes(l.id)}
              onChange={(e) =>
                setChosen((all) =>
                  e.target.checked ? [...all, l.id] : all.filter((x) => x !== l.id),
                )
              }
              className="size-6 shrink-0"
            />
            <span className="flex-1">{l.label}</span>
            <span className="font-semibold">{formatXAF(l.remaining)}</span>
          </label>
        ))}
      </fieldset>
      <p className="text-xl font-bold">{t("online.total", { montant: formatXAF(total) })}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">{t("online.operator")}</legend>
        {(["airtel", "mtn"] as const).map((op) => (
          <label
            key={op}
            className="flex min-h-12 items-center gap-3 rounded-lg border border-zinc-300 px-3"
          >
            <input
              type="radio"
              name="operateur"
              value={op}
              defaultChecked={op === "airtel"}
              className="size-6"
            />
            {t(op === "airtel" ? "online.airtel" : "online.mtn")}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1">
        <label htmlFor="pay-phone" className="font-medium">
          {t("online.phone")}
        </label>
        <input
          id="pay-phone"
          name="telephone"
          type="tel"
          inputMode="tel"
          defaultValue={phone}
          aria-describedby="pay-phone-help"
          className={inputClass}
        />
        <p id="pay-phone-help" className="text-sm text-zinc-600">
          {t("online.phoneHelp")}
        </p>
      </div>
      <FormMessage status="error" message={state.error} />
      <SubmitButton label={t("online.submit", { montant: formatXAF(total) })} />
    </form>
  );
}
