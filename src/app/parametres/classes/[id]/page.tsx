import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { getClass, listTeachers } from "@/modules/settings/classes";
import { listLevels } from "@/modules/settings/levels";
import { listYears } from "@/modules/settings/years";
import { listEnrollments } from "@/modules/students/enrollments";
import { can } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";
import { DeleteClassForm, EditClassForm, TeachersForm } from "../class-forms";

export const metadata: Metadata = { title: t("classes.title") };

type Props = Pick<PageProps<"/parametres/classes/[id]">, "params">;

export default function ClassPage({ params }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content params={params} />
      </Suspense>
    </main>
  );
}

async function Content({ params }: Props) {
  const { principal } = await requireAction("settings:read");
  const { id } = await params;
  const schoolClass = await getClass(principal, id);
  const [levels, teachers, years] = await Promise.all([
    listLevels(principal),
    listTeachers(principal),
    listYears(principal),
  ]);
  const year = years.find((y) => y.id === schoolClass.academicYearId);
  const roster = await listEnrollments(principal, schoolClass.academicYearId, {
    classId: schoolClass.id,
    status: "enrolled",
  });
  const readOnly = !can(principal, "settings:write") || year?.status === "archived";

  return (
    <>
      <Link
        href={`/parametres/classes?annee=${schoolClass.academicYearId}`}
        className="text-blue-800 underline"
      >
        {t("classes.back")}
      </Link>
      <h1 className="text-2xl font-semibold">
        {t("classes.classTitle", { nom: schoolClass.name })}
      </h1>
      {year?.status === "archived" && (
        <p className="rounded-md bg-zinc-100 p-3">{t("classes.readOnly")}</p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">
          {schoolClass.capacity
            ? t("enrollments.rosterTitleCapacity", { n: roster.length, max: schoolClass.capacity })
            : t("enrollments.rosterTitle", { n: roster.length })}
        </h2>
        {roster.length === 0 ? (
          <p className="text-zinc-600">{t("enrollments.rosterEmpty")}</p>
        ) : (
          <ol className="flex list-decimal flex-col gap-1 rounded-md border border-zinc-300 py-2 pr-3 pl-10">
            {roster.map((r) => (
              <li key={r.id}>
                <Link href={`/eleves/${r.studentId}`} className="text-blue-800 underline">
                  {r.lastName} {r.firstNames}
                </Link>{" "}
                <span className="text-sm text-zinc-600">{r.matricule}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <h2 className="text-xl font-semibold">{t("classes.subjectsTitle")}</h2>
      {schoolClass.subjects.length === 0 ? (
        <p>{t("classes.noSubjects")}</p>
      ) : (
        <>
          {!readOnly && <p>{t("classes.subjectsHelp")}</p>}
          <TeachersForm
            classId={schoolClass.id}
            subjects={schoolClass.subjects}
            teachers={teachers}
            readOnly={readOnly}
          />
        </>
      )}

      <h2 className="text-xl font-semibold">{t("classes.editTitle")}</h2>
      <EditClassForm
        classId={schoolClass.id}
        initial={{
          levelId: schoolClass.levelId,
          series: schoolClass.series,
          name: schoolClass.name,
          capacity: schoolClass.capacity?.toString() ?? "",
          headTeacherId: schoolClass.headTeacherId ?? "",
        }}
        levels={levels.map((l) => ({ id: l.id, name: l.name }))}
        teachers={teachers}
        readOnly={readOnly}
      />

      {!readOnly && (
        <DeleteClassForm
          classId={schoolClass.id}
          yearId={schoolClass.academicYearId}
          name={schoolClass.name}
        />
      )}
    </>
  );
}
