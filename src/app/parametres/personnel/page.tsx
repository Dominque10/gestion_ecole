import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { listStaff } from "@/modules/settings/staff";
import { PASSWORD_MIN_LENGTH } from "@/server/auth/password";
import { requireAction } from "@/server/auth/session";
import { AddStaffForm, StaffMemberCard } from "./staff-forms";

export const metadata: Metadata = { title: t("staff.title") };

export default function StaffPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("staff.title")}</h1>
      <p>{t("staff.intro")}</p>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const { principal } = await requireAction("staff:manage");
  const staff = await listStaff(principal);
  return (
    <>
      <ul className="flex flex-col gap-4">
        {staff.map((member) => (
          <StaffMemberCard
            key={member.userId}
            member={member}
            isSelf={member.userId === principal.userId}
            minLength={PASSWORD_MIN_LENGTH}
          />
        ))}
      </ul>
      <h2 className="text-xl font-semibold">{t("staff.addTitle")}</h2>
      <AddStaffForm minLength={PASSWORD_MIN_LENGTH} />
    </>
  );
}
