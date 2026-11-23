"use client";

import { useActionState } from "react";
import { FormMessage, inputClass, SubmitButton } from "@/components/form-fields";
import { t, type MessageKey } from "@/i18n";
import { idleFormState } from "@/lib/form-state";
import type { GradingRules } from "@/modules/grading/rules";
import { MENTION_ROWS } from "@/modules/grading/rules-form";
import { saveGradingRulesAction } from "./actions";

type Choice = { value: string; label: MessageKey };

const GROUPS: {
  name: keyof GradingRules;
  legend: MessageKey;
  help?: MessageKey;
  choices: Choice[];
}[] = [
  {
    name: "primaryScale",
    legend: "gradingRules.primaryScale",
    help: "gradingRules.primaryScaleHelp",
    choices: [
      { value: "20", label: "gradingRules.scale20" },
      { value: "10", label: "gradingRules.scale10" },
    ],
  },
  {
    name: "subjectAverage",
    legend: "gradingRules.subjectAverage",
    choices: [
      { value: "continuousAndComposition", label: "gradingRules.continuousAndComposition" },
      { value: "allEqual", label: "gradingRules.allEqual" },
    ],
  },
  {
    name: "compositionWeight",
    legend: "gradingRules.compositionWeight",
    choices: [
      { value: "1", label: "gradingRules.weight1" },
      { value: "2", label: "gradingRules.weight2" },
      { value: "3", label: "gradingRules.weight3" },
    ],
  },
  {
    name: "rounding",
    legend: "gradingRules.rounding",
    choices: [
      { value: "hundredth", label: "gradingRules.hundredth" },
      { value: "tenth", label: "gradingRules.tenth" },
      { value: "hundredthTruncated", label: "gradingRules.hundredthTruncated" },
    ],
  },
  {
    name: "ranking",
    legend: "gradingRules.ranking",
    choices: [
      { value: "competition", label: "gradingRules.competition" },
      { value: "dense", label: "gradingRules.dense" },
      { value: "tiebreak", label: "gradingRules.tiebreak" },
    ],
  },
  {
    name: "optionalSubjects",
    legend: "gradingRules.optionalSubjects",
    help: "gradingRules.optionalSubjectsHelp",
    choices: [
      { value: "bonusAboveHalf", label: "gradingRules.bonusAboveHalf" },
      { value: "normal", label: "gradingRules.normal" },
      { value: "excluded", label: "gradingRules.excluded" },
    ],
  },
  {
    name: "absence",
    legend: "gradingRules.absence",
    choices: [
      { value: "excluded", label: "gradingRules.absenceExcluded" },
      { value: "zero", label: "gradingRules.absenceZero" },
    ],
  },
  {
    name: "annualAverage",
    legend: "gradingRules.annualAverage",
    choices: [
      { value: "periodsMean", label: "gradingRules.periodsMean" },
      { value: "lastDouble", label: "gradingRules.lastDouble" },
    ],
  },
  {
    name: "generalAverageBase",
    legend: "gradingRules.generalAverageBase",
    choices: [
      { value: "roundedSubjects", label: "gradingRules.roundedSubjects" },
      { value: "exactSubjects", label: "gradingRules.exactSubjects" },
    ],
  },
  {
    name: "missingPart",
    legend: "gradingRules.missingPart",
    choices: [
      { value: "useAvailable", label: "gradingRules.useAvailable" },
      { value: "countZero", label: "gradingRules.countZero" },
    ],
  },
  {
    name: "emptySubject",
    legend: "gradingRules.emptySubject",
    choices: [
      { value: "excluded", label: "gradingRules.emptyExcluded" },
      { value: "zero", label: "gradingRules.emptyZero" },
      { value: "unranked", label: "gradingRules.emptyUnranked" },
    ],
  },
];

const formatThreshold = (n: number) => String(n).replace(".", ",");

export function GradingRulesForm({ rules, readOnly }: { rules: GradingRules; readOnly: boolean }) {
  const [state, formAction] = useActionState(saveGradingRulesAction, idleFormState);
  const v = state.status === "error" ? state.values : {};
  return (
    // La clé suit les règles enregistrées : les choix affichés se remettent à jour après l'envoi.
    <form
      key={JSON.stringify(rules)}
      action={formAction}
      className="flex flex-col gap-6"
      noValidate
    >
      {GROUPS.map((group) => (
        <fieldset key={group.name} className="flex flex-col gap-1" disabled={readOnly}>
          <legend className="mb-1 font-medium">{t(group.legend)}</legend>
          {group.choices.map((choice) => (
            <label key={choice.value} className="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                name={group.name}
                value={choice.value}
                defaultChecked={String(rules[group.name]) === choice.value}
                className="size-5 shrink-0"
              />
              {t(choice.label)}
            </label>
          ))}
          {group.help && <p className="text-sm text-zinc-600">{t(group.help)}</p>}
        </fieldset>
      ))}

      <fieldset className="flex flex-col gap-2" disabled={readOnly}>
        <legend className="mb-1 font-medium">{t("gradingRules.mentions")}</legend>
        <p className="text-sm text-zinc-600">{t("gradingRules.mentionsHelp")}</p>
        {Array.from({ length: MENTION_ROWS }, (_, i) => {
          const mention = rules.mentions[i];
          return (
            <div key={i} className="flex gap-2">
              <input
                name={`mention-${i}`}
                defaultValue={v[`mention-${i}`] ?? mention?.label ?? ""}
                maxLength={40}
                aria-label={t("gradingRules.mentionLabel", { n: i + 1 })}
                className={`${inputClass} flex-1`}
              />
              <input
                name={`seuil-${i}`}
                inputMode="decimal"
                defaultValue={
                  v[`seuil-${i}`] ?? (mention ? formatThreshold(mention.minAverage) : "")
                }
                aria-label={t("gradingRules.mentionThreshold", { n: i + 1 })}
                className={`${inputClass} w-24 text-center`}
              />
            </div>
          );
        })}
      </fieldset>

      <FormMessage status={state.status} message={state.message} />
      {!readOnly && <SubmitButton label={t("gradingRules.save")} />}
    </form>
  );
}
