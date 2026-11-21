import Link from "next/link";
import { Suspense } from "react";
import { t, type MessageKey } from "@/i18n";
import { can, type Action } from "@/server/auth/permissions";
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

/** Entrées du menu, affichées selon les droits (le serveur revérifie sur chaque page). */
const MENU: { href: string; label: MessageKey; action: Action }[] = [
  { href: "/plateforme/ecoles", label: "nav.schools", action: "school:create" },
  { href: "/parametres/ecole", label: "nav.schoolProfile", action: "settings:read" },
  { href: "/parametres/annees", label: "nav.years", action: "settings:read" },
  { href: "/parametres/niveaux", label: "nav.levels", action: "settings:read" },
  { href: "/parametres/matieres", label: "nav.subjects", action: "settings:read" },
  { href: "/parametres/coefficients", label: "nav.coefficients", action: "settings:read" },
  { href: "/parametres/personnel", label: "nav.staff", action: "staff:manage" },
];

async function Welcome() {
  const { principal, userName } = await requireSession();
  const roles = principal.roles.map((r) => t(`roles.${r}`)).join(", ");
  const links = MENU.filter((link) => can(principal, link.action));
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("session.welcome", { nom: userName })}</h1>
      <p>{principal.schoolId ? t("session.roles", { roles }) : t("session.platform")}</p>
      {links.length > 0 && (
        <nav aria-label={t("session.menu")} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("session.menu")}</h2>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex h-12 items-center rounded-md border border-zinc-400 px-4 font-medium"
            >
              {t(link.label)}
            </Link>
          ))}
        </nav>
      )}
      <form action={logoutAction}>
        <button type="submit" className="h-12 rounded-md border border-zinc-400 px-4 font-medium">
          {t("session.logout")}
        </button>
      </form>
    </>
  );
}
