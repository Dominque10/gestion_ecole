import Link from "next/link";
import { Suspense } from "react";
import { t, type MessageKey } from "@/i18n";
import { getSetupStatus } from "@/modules/settings/setup-status";
import { canBrowseStudents } from "@/modules/students/students";
import { can, type Action, type Principal } from "@/server/auth/permissions";
import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth/session";
import { LogoutButton } from "./logout-button";

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
  { href: "/tableau-de-bord", label: "nav.dashboard", action: "dashboard:finance" },
  { href: "/eleves", label: "nav.students", action: "students:read", visible: canBrowseStudents },
  {
    href: "/inscriptions",
    label: "nav.enrollments",
    action: "students:read",
    visible: canBrowseStudents,
  },
  { href: "/listes", label: "nav.lists", action: "students:read", visible: canBrowseStudents },
  { href: "/exports", label: "nav.exports", action: "students:read", visible: canBrowseStudents },
  { href: "/parent", label: "nav.parentSpace", action: "parent:view" },
  { href: "/notes", label: "nav.grades", action: "grades:write" },
  { href: "/appel", label: "nav.rollCall", action: "attendance:write" },
  { href: "/absences", label: "nav.absences", action: "attendance:justify" },
  { href: "/annonces", label: "nav.announcements", action: "announcements:send" },
  { href: "/caisse", label: "nav.cash", action: "payments:collect" },
  { href: "/caisse/cloture", label: "nav.closure", action: "cash:close" },
  { href: "/impayes", label: "nav.arrears", action: "dashboard:finance" },
  { href: "/caisse/annulations", label: "nav.cancellations", action: "payments:cancel:approve" },
  { href: "/caisse/clotures", label: "nav.closures", action: "cash:reopen" },
  { href: "/plateforme/ecoles", label: "nav.schools", action: "school:create" },
  { href: "/parametres/demarrage", label: "nav.setup", action: "settings:write" },
  { href: "/parametres/ecole", label: "nav.schoolProfile", action: "settings:read" },
  { href: "/parametres/annees", label: "nav.years", action: "settings:read" },
  { href: "/parametres/niveaux", label: "nav.levels", action: "settings:read" },
  { href: "/parametres/matieres", label: "nav.subjects", action: "settings:read" },
  { href: "/parametres/coefficients", label: "nav.coefficients", action: "settings:read" },
  { href: "/parametres/calcul", label: "nav.gradingRules", action: "settings:read" },
  { href: "/parametres/classes", label: "nav.classes", action: "settings:read" },
  { href: "/parametres/creneaux", label: "nav.timeSlots", action: "settings:read" },
  { href: "/parametres/frais", label: "nav.fees", action: "settings:read" },
  {
    href: "/parametres/notifications",
    label: "nav.notifications",
    action: "notifications:templates",
  },
  { href: "/parametres/personnel", label: "nav.staff", action: "staff:manage" },
];

async function Welcome() {
  const { principal, userName } = await requireSession();
  // Compte qui n'est que parent dans cette école : son espace à lui.
  if (principal.roles.length > 0 && principal.roles.every((r) => r === "parent"))
    redirect("/parent");
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
      <LogoutButton />
    </>
  );
}
