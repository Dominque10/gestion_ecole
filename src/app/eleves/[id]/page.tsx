import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ImageUploadForm } from "@/components/image-upload-form";
import { inputClass } from "@/components/styles";
import { t } from "@/i18n";
import { formatDay } from "@/lib/dates";
import { DOCUMENT_KINDS, listStudentDocuments } from "@/modules/students/media";
import { getMedical } from "@/modules/students/medical";
import { getStudent } from "@/modules/students/students";
import { can } from "@/server/auth/permissions";
import { requireAction } from "@/server/auth/session";
import { uploadDocumentAction, uploadPhotoAction } from "../actions";
import {
  AddGuardianForm,
  DeleteDocumentButton,
  EditStudentForm,
  GuardianItem,
  MedicalForm,
} from "../student-forms";

export const metadata: Metadata = { title: t("students.title") };

type Props = Pick<PageProps<"/eleves/[id]">, "params" | "searchParams">;

export default function StudentPage({ params, searchParams }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <Link href="/eleves" className="text-blue-800 underline">
        {t("students.back")}
      </Link>
      <Suspense fallback={<p>{t("session.loading")}</p>}>
        <Content params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const asText = (v: string | null) => v ?? "";

async function Content({ params, searchParams }: Props) {
  const { principal } = await requireAction("students:read");
  const { id } = await params;
  const created = (await searchParams).cree;
  const student = await getStudent(principal, id);
  const canEdit = can(principal, "students:write");
  const canMedical = can(principal, "students:medical");
  const [documents, medical] = await Promise.all([
    listStudentDocuments(principal, id),
    canMedical ? getMedical(principal, id) : Promise.resolve(null),
  ]);
  const photoVersion = student.photoKey?.split("/").pop();

  return (
    <>
      <div className="flex items-center gap-4">
        {photoVersion ? (
          // eslint-disable-next-line @next/next/no-img-element -- photo privée servie par l'API, déjà réduite
          <img
            src={`/api/v1/students/${student.id}/photo?v=${encodeURIComponent(photoVersion)}`}
            alt={t("students.photoTitle")}
            className="size-20 shrink-0 rounded-md border border-zinc-200 object-cover"
          />
        ) : null}
        <div>
          <h1 className="text-2xl font-semibold">
            {student.lastName} {student.firstNames}
          </h1>
          <p className="font-medium text-zinc-700">
            {t("students.matricule", { matricule: student.matricule })}
          </p>
        </div>
      </div>
      {created && (
        <p role="status" className="rounded-md bg-green-50 p-3 text-green-900">
          {created === "parent"
            ? t("students.createdExistingGuardian", { matricule: student.matricule })
            : t("students.created", { matricule: student.matricule })}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">{t("students.guardiansTitle")}</h2>
        <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-300 px-4">
          {student.guardians.map((g) => (
            <GuardianItem key={g.id} studentId={student.id} guardian={g} canEdit={canEdit} />
          ))}
        </ul>
        {canEdit && (
          <details className="rounded-md bg-zinc-50 p-3">
            <summary className="min-h-11 cursor-pointer content-center font-medium">
              {t("students.addGuardianTitle")}
            </summary>
            <div className="mt-3">
              <AddGuardianForm studentId={student.id} />
            </div>
          </details>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">{t("students.identityTitle")}</h2>
        <EditStudentForm
          studentId={student.id}
          readOnly={!canEdit}
          initial={{
            lastName: student.lastName,
            firstNames: student.firstNames,
            sex: student.sex,
            birthDate: asText(student.birthDate),
            birthPlace: asText(student.birthPlace),
            nationality: asText(student.nationality),
            previousSchool: asText(student.previousSchool),
          }}
        />
      </section>

      {canEdit && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">{t("students.photoTitle")}</h2>
          {!photoVersion && <p className="text-zinc-600">{t("students.noPhoto")}</p>}
          <ImageUploadForm
            action={uploadPhotoAction}
            id="student-photo"
            chooseLabel={t("students.photoChoose")}
            submitLabel={t("students.photoUpload")}
            fields={{ studentId: student.id }}
            maxSide={600}
            targetBytes={150 * 1024}
          />
        </section>
      )}

      {medical && (
        <section className="flex flex-col gap-3 rounded-md border border-amber-600 p-4">
          <h2 className="text-xl font-semibold">{t("students.medicalTitle")}</h2>
          <MedicalForm
            studentId={student.id}
            initial={{
              allergies: asText(medical.allergies),
              treatments: asText(medical.treatments),
              emergencyContactName: asText(medical.emergencyContactName),
              emergencyContactPhone: asText(medical.emergencyContactPhone),
              notes: asText(medical.notes),
            }}
          />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">{t("students.documentsTitle")}</h2>
        {documents.length === 0 ? (
          <p className="text-zinc-600">{t("students.noDocuments")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-300 px-4">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span>
                  <span className="font-medium">{t(`students.documentKinds.${d.kind}`)}</span>
                  {d.label && ` · ${d.label}`}
                  <span className="block text-sm text-zinc-600">
                    {formatDay(d.createdAt.toISOString().slice(0, 10))}
                  </span>
                </span>
                <span className="flex gap-2">
                  <a
                    href={`/api/v1/students/documents/${d.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-11 items-center rounded-md border border-zinc-400 px-3 text-sm font-medium"
                  >
                    {t("students.view")}
                  </a>
                  {canEdit && <DeleteDocumentButton documentId={d.id} />}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <ImageUploadForm
            action={uploadDocumentAction}
            id="student-document"
            chooseLabel={t("students.documentChoose")}
            submitLabel={t("students.documentUpload")}
            fields={{ studentId: student.id }}
            maxSide={1600}
            targetBytes={500 * 1024}
          >
            <label htmlFor="document-kind" className="font-medium">
              {t("students.documentKind")}
            </label>
            <select id="document-kind" name="kind" className={`${inputClass} bg-white`}>
              {DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`students.documentKinds.${k}`)}
                </option>
              ))}
            </select>
            <label htmlFor="document-label" className="font-medium">
              {t("students.documentLabel")}
            </label>
            <input
              id="document-label"
              name="label"
              maxLength={80}
              aria-describedby="document-label-help"
              className={inputClass}
            />
            <p id="document-label-help" className="text-sm text-zinc-600">
              {t("students.documentLabelHelp")}
            </p>
          </ImageUploadForm>
        )}
      </section>
    </>
  );
}
