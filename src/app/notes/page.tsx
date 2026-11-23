import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { listCourses, type Course } from "@/modules/grading/assessments";
import { listResultClasses } from "@/modules/grading/results";
import { requireAction } from "@/server/auth/session";

export const metadata: Metadata = { title: t("grading.title") };

export default function GradesPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/accueil" className="text-blue-800 underline">
        {t("nav.home")}
      </Link>
      <h1 className="text-2xl font-semibold">{t("grading.title")}</h1>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const { principal } = await requireAction("grades:write");
  const director = principal.roles.includes("director");
  const [courses, resultClasses] = await Promise.all([
    listCourses(principal),
    listResultClasses(principal),
  ]);
  // Directeur et professeurs principaux : résultats de la classe et clôture des périodes.
  const resultsLink = resultClasses.length > 0 && (
    <Link
      href="/notes/resultats"
      className="flex min-h-12 items-center rounded-md bg-blue-700 px-4 font-semibold text-white"
    >
      {t("results.link")}
    </Link>
  );
  if (courses.length === 0) {
    return (
      <>
        {resultsLink}
        <p>{t(director ? "grading.noCourse" : "grading.noCourseTeacher")}</p>
      </>
    );
  }
  // Regroupement par classe, dans l'ordre des niveaux.
  const byClass = new Map<string, Course[]>();
  for (const c of courses) byClass.set(c.classId, [...(byClass.get(c.classId) ?? []), c]);
  return (
    <>
      {resultsLink}
      <p>{t(director ? "grading.intro" : "grading.introTeacher")}</p>
      <Link href="/notes/hors-ligne" className="text-blue-800 underline">
        {t("offline.title")}
      </Link>
      {[...byClass.values()].map((list) => (
        <section key={list[0].classId} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{list[0].className}</h2>
          <ul className="flex flex-col gap-2">
            {list.map((c) => (
              <li key={c.subjectId}>
                <Link
                  href={`/notes/${c.classId}/${c.subjectId}`}
                  className="flex min-h-12 flex-col justify-center rounded-md border border-zinc-400 px-4 py-2"
                >
                  <span className="font-medium">{c.subjectName}</span>
                  {director && (
                    <span className="text-sm text-zinc-600">
                      {c.teacherName
                        ? t("grading.teacher", { nom: c.teacherName })
                        : t("grading.noTeacher")}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
