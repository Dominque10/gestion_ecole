import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/i18n";
import { getClass, listTeachers } from "@/modules/settings/classes";
import { listLevels } from "@/modules/settings/levels";
import { listYears } from "@/modules/settings/years";
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
