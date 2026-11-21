import { Suspense } from "react";
import { t } from "@/i18n";
import { requireSession } from "@/server/auth/session";
import { logoutAction } from "./actions";

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Welcome />
      </Suspense>
    </main>
  );
}

async function Welcome() {
  const { principal, userName } = await requireSession();
  const roles = principal.roles.map((r) => t(`roles.${r}`)).join(", ");
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("session.welcome", { nom: userName })}</h1>
      <p>{principal.schoolId ? t("session.roles", { roles }) : t("session.platform")}</p>
      <form action={logoutAction}>
        <button type="submit" className="h-12 rounded-md border border-zinc-400 px-4 font-medium">
          {t("session.logout")}
        </button>
      </form>
    </>
  );
}
