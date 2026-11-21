import Link from "next/link";
import { Suspense } from "react";
import { t, type MessageKey } from "@/i18n";
import { getSetupStatus } from "@/modules/settings/setup-status";
import { canBrowseStudents } from "@/modules/students/students";
import { can, type Action, type Principal } from "@/server/auth/permissions";
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
const MENU: {
  href: string;
  label: MessageKey;
  action: Action;
  visible?: (p: Principal) => boolean;
}[] = [
  { href: "/eleves", label: "nav.students", action: "students:read", visible: canBrowseStudents },
  { href: "/plateforme/ecoles", label: "nav.schools", action: "school:create" },
  { href: "/parametres/demarrage", label: "nav.setup", action: "settings:write" },
  { href: "/parametres/ecole", label: "nav.schoolProfile", action: "settings:read" },
  { href: "/parametres/annees", label: "nav.years", action: "settings:read" },
  { href: "/parametres/niveaux", label: "nav.levels", action: "settings:read" },
  { href: "/parametres/matieres", label: "nav.subjects", action: "settings:read" },
  { href: "/parametres/coefficients", label: "nav.coefficients", action: "settings:read" },
  { href: "/parametres/classes", label: "nav.classes", action: "settings:read" },
  { href: "/parametres/creneaux", label: "nav.timeSlots", action: "settings:read" },
  { href: "/parametres/frais", label: "nav.fees", action: "settings:read" },
  { href: "/parametres/personnel", label: "nav.staff", action: "staff:manage" },
];

async function Welcome() {
  const { principal, userName } = await requireSession();
  const roles = principal.roles.map((r) => t(`roles.${r}`)).join(", ");
  const links = MENU.filter(
    (link) => can(principal, link.action) && (link.visible?.(principal) ?? true),
  );
  // Rappel du démarrage pour le directeur, tant que le paramétrage n'est pas terminé.
  const setup = can(principal, "settings:write") ? await getSetupStatus(principal) : null;
  const setupDone = setup?.steps.filter((s) => s.done).length ?? 0;
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("session.welcome", { nom: userName })}</h1>
      <p>{principal.schoolId ? t("session.roles", { roles }) : t("session.platform")}</p>
      {setup?.next && (
        <div className="flex flex-col gap-3 rounded-md border border-amber-600 bg-amber-50 p-4">
          <p>{t("setup.homeBanner", { faites: setupDone, total: setup.steps.length })}</p>
          <Link
            href="/parametres/demarrage"
            className="flex h-12 items-center justify-center rounded-md bg-blue-700 px-4 font-semibold text-white"
          >
            {t("setup.homeLink")}
          </Link>
        </div>
      )}
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
