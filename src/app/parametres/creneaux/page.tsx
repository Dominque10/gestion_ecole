import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { listTimeSlots } from "@/modules/settings/time-slots";
import { can } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";
import { CreateTimeSlotForm, TimeSlotItem } from "./time-slot-forms";

export const metadata: Metadata = { title: t("timeSlots.title") };

export default function TimeSlotsPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("timeSlots.title")}</h1>
      <p>{t("timeSlots.intro")}</p>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const { principal } = await requireAction("settings:read");
  const slots = await listTimeSlots(principal);
  const canEdit = can(principal, "settings:write");
  return (
    <>
      {slots.length === 0 ? (
        <p>{t("timeSlots.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-300 px-4">
          {slots.map((slot) => (
            <TimeSlotItem key={slot.id} slot={slot} canEdit={canEdit} />
          ))}
        </ul>
      )}
      {canEdit && (
        <>
          <h2 className="text-xl font-semibold">{t("timeSlots.addTitle")}</h2>
          <CreateTimeSlotForm />
        </>
      )}
    </>
  );
}
