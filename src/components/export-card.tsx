"use client";

import { useState } from "react";
import { DownloadPdfButton } from "@/components/download-pdf-button";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import type { ExportRequest } from "@/modules/exports/lists";
import { excelHref } from "@/modules/exports/params";

export type ExportField =
  | {
      name: string;
      label: string;
      type: "select";
      options: { value: string; label: string }[];
      initial: string;
    }
  | { name: string; label: string; type: "date"; initial: string };

/** Boutons Excel et PDF d'une liste : Excel téléchargé tout de suite, PDF préparé par le serveur. */
export function ExportButtons({ request }: { request: ExportRequest }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <a
        href={excelHref(request)}
        download
        className="flex h-12 items-center justify-center rounded-md border border-blue-700 px-4 font-semibold text-blue-800"
      >
        {t("exports.excel")}
      </a>
      <DownloadPdfButton request={{ kind: "export", request }} label={t("exports.pdf")} />
    </div>
  );
}

/** Une liste exportable, avec ses filtres (classe, dates, période…). */
export function ExportCard({
  title,
  base,
  fields = [],
}: {
  title: string;
  base: Record<string, string>;
  fields?: ExportField[];
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.name, f.initial])),
  );
  const request = Object.fromEntries(
    Object.entries({ ...base, ...values }).filter(([, v]) => v !== ""),
  ) as unknown as ExportRequest;
  const id = (name: string) => `export-${base.list}-${name}`;
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 rounded-md border border-zinc-300 p-4"
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      {fields.map((f) => (
        <div key={f.name} className="flex flex-col gap-1">
          <label htmlFor={id(f.name)} className="font-medium">
            {f.label}
          </label>
          {f.type === "select" ? (
            <select
              id={id(f.name)}
              value={values[f.name]}
              onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              className={`${inputClass} bg-white`}
            >
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={id(f.name)}
              type="date"
              value={values[f.name]}
              onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              className={`${inputClass} bg-white`}
            />
          )}
        </div>
      ))}
      <ExportButtons request={request} />
    </section>
  );
}
