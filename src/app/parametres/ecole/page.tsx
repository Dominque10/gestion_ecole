import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { getSchoolProfile, SCHOOL_IMAGE_KINDS } from "@/modules/settings/school-profile";
import { can } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";
import { ImageField, ProfileForm } from "./profile-forms";

export const metadata: Metadata = { title: t("schoolProfile.title") };

export default function SchoolProfilePage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("schoolProfile.title")}</h1>
      <p>{t("schoolProfile.intro")}</p>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

/** Version courte d'une clé de fichier (nom du fichier), pour l'URL de l'image. */
const versionOf = (key: string | null) => (key ? (key.split("/").pop() ?? null) : null);

async function Content() {
  const { principal } = await requireAction("settings:read");
  const profile = await getSchoolProfile(principal);
  const canEdit = can(principal, "settings:write");
  return (
    <>
      <div className="rounded-md bg-zinc-100 p-3 text-sm">
        <p>{t("schoolProfile.code", { code: profile.code })}</p>
        <p>{t("schoolProfile.prefix", { prefix: profile.matriculePrefix })}</p>
        <p className="text-zinc-600">{t("schoolProfile.fixedHelp")}</p>
      </div>
      {canEdit ? (
        <ProfileForm profile={profile} />
      ) : (
        <dl className="flex flex-col gap-2">
          <dt className="font-medium">{t("schoolProfile.name")}</dt>
          <dd>{profile.name}</dd>
          <dt className="font-medium">{t("schoolProfile.address")}</dt>
          <dd>{profile.address ?? "—"}</dd>
          <dt className="font-medium">{t("schoolProfile.phone")}</dt>
          <dd>{profile.phone ?? "—"}</dd>
        </dl>
      )}
      <h2 className="text-xl font-semibold">{t("schoolProfile.imagesTitle")}</h2>
      {canEdit && <p>{t("schoolProfile.imagesIntro")}</p>}
      {SCHOOL_IMAGE_KINDS.map((kind) => (
        <ImageField
          key={kind}
          kind={kind}
          version={versionOf(profile.images[kind])}
          canEdit={canEdit}
        />
      ))}
    </>
  );
}
