// Phase 4, sous-étape 4e — annonces aux parents : public (école, niveau, classe), un message par famille,
// lecture dans l'espace parents limitée aux annonces qui concernent ses enfants.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, type Principal } from "@/server/auth/permissions";
import { requestParentCode, verifyParentCode } from "@/server/auth/parent";
import { closeDb, withSchool } from "@/server/db/client";
import { announcements } from "@/server/db/schema";
import { FakeSmsProvider } from "@/server/sms";
import {
  getChildAnnouncements,
  listAnnouncements,
  publishAnnouncement,
} from "@/modules/announcements/announcements";
import { processNotice, type NoticeJob } from "@/modules/notifications/notices";
import { SettingsError } from "@/modules/settings/errors";
import { createClass } from "@/modules/settings/classes";
import { addDefaultLevels, listLevels } from "@/modules/settings/levels";
import { activateYear, createYear } from "@/modules/settings/years";
import { assignClass, preEnroll, validateEnrollment } from "@/modules/students/enrollments";
import { createStudent } from "@/modules/students/students";
import { createSchoolWithDirector, createSuperadmin, resetDatabase } from "./helpers";

type School = { schoolId: string; directorId: string };
let a: School;
const as = (...roles: Principal["roles"]): Principal => ({
  userId: a.directorId,
  schoolId: a.schoolId,
  roles,
  isSuperadmin: false,
});
const director = () => as("director");
const jobs: NoticeJob[] = [];
const schedule = async (job: NoticeJob) => void jobs.push(job);
const level: Record<string, string> = {};
const cls: Record<string, string> = {};
const kid: Record<string, string> = {};

async function parent(phone: string): Promise<Principal> {
  const sms = new FakeSmsProvider();
  const t0 = new Date("2026-11-23T08:00:00Z");
  await requestParentCode(phone, sms, t0);
  const result = await verifyParentCode(phone, sms.sent[0].body.match(/\d{6}/)![0], t0);
  if (!result.ok) throw new Error("connexion parent impossible");
  return result.principal;
}

beforeAll(async () => {
  await resetDatabase();
  const superadminId = await createSuperadmin();
  a = await createSchoolWithDirector(superadminId, "annonces");
  await addDefaultLevels(director(), "college");
  for (const l of await listLevels(director())) level[l.name] = l.id;
  const year = await createYear(director(), {
    label: "2026-2027",
    startDate: "2026-10-01",
    endDate: "2027-06-30",
    periodKind: "trimester",
  });
  for (const [name, lvl] of [
    ["6e A", "6e"],
    ["6e B", "6e"],
    ["5e A", "5e"],
  ]) {
    cls[name] = await createClass(director(), year, {
      levelId: level[lvl],
      series: "",
      name,
      capacity: "",
      headTeacherId: "",
    });
  }
  await activateYear(director(), year);
  // ADA (6e A) et BOB (6e B) ont le même responsable ; CHLOE (5e A) un autre.
  for (const [name, lvl, className, phone] of [
    ["ADA", "6e", "6e A", "06 640 00 01"],
    ["BOB", "6e", "6e B", "06 640 00 01"],
    ["CHLOE", "5e", "5e A", "06 640 00 02"],
  ]) {
    const s = await createStudent(director(), {
      student: {
        lastName: name,
        firstNames: "Test",
        sex: "F",
        birthDate: "",
        birthPlace: "",
        nationality: "",
        previousSchool: "",
      },
      guardian: { fullName: "Parent", phone, otherPhone: "", relationship: "" },
    });
    const e = await preEnroll(director(), {
      studentId: s.id,
      academicYearId: year,
      levelId: level[lvl],
    });
    await validateEnrollment(director(), e);
    await assignClass(director(), e, cls[className]);
    kid[name] = e;
  }
});

afterAll(async () => {
  await closeDb();
});

describe("Publier une annonce", () => {
  it("le secrétariat publie pour toute l'école : un message par famille (les frères et sœurs n'en reçoivent qu'un)", async () => {
    const result = await publishAnnouncement(
      as("secretary"),
      {
        audience: "school",
        levelId: null,
        classId: null,
        title: "Réunion des parents",
        body: "Samedi 5 décembre à 9 h, dans la cour.",
        sendMessage: true,
      },
      schedule,
    );
    expect(result.messages).toBe(2);
    expect(jobs.map((j) => j.type)).toEqual(["announcement", "announcement"]);
    for (const role of ["teacher", "accountant", "parent"] as const) {
      await expect(
        publishAnnouncement(
          as(role),
          {
            audience: "school",
            levelId: null,
            classId: null,
            title: "x",
            body: "y",
            sendMessage: false,
          },
          schedule,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("pour un niveau sans message ; pour une classe avec message ; public mal choisi refusé", async () => {
    expect(
      (
        await publishAnnouncement(
          director(),
          {
            audience: "level",
            levelId: level["6e"],
            classId: null,
            title: "Sortie 6e",
            body: "Sortie au musée jeudi.",
            sendMessage: false,
          },
          schedule,
        )
      ).messages,
    ).toBe(0);
    expect(
      (
        await publishAnnouncement(
          director(),
          {
            audience: "class",
            levelId: null,
            classId: cls["5e A"],
            title: "5e A",
            body: "Cahier de sciences à apporter.",
            sendMessage: true,
          },
          schedule,
        )
      ).messages,
    ).toBe(1);
    await expect(
      publishAnnouncement(
        director(),
        {
          audience: "level",
          levelId: null,
          classId: null,
          title: "x",
          body: "y",
          sendMessage: false,
        },
        schedule,
      ),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof SettingsError && e.code === "announcementInvalid",
    );
    expect((await listAnnouncements(director())).map((x) => [x.title, x.messageCount])).toEqual([
      ["5e A", 1],
      ["Sortie 6e", 0],
      ["Réunion des parents", 2],
    ]);
  });

  it("le message d'annonce reprend le titre et le texte", async () => {
    const sms = new FakeSmsProvider();
    expect(await processNotice(jobs[0], () => sms)).toBe("sent");
    expect(sms.sent[0].body).toBe(
      "École annonces : Réunion des parents : Samedi 5 décembre à 9 h, dans la cour.",
    );
  });
});

describe("Lecture dans l'espace parents", () => {
  it("chaque parent ne voit que les annonces qui concernent ses enfants", async () => {
    const p1 = await parent("06 640 00 01");
    expect((await getChildAnnouncements(p1, kid.ADA)).map((x) => x.title)).toEqual([
      "Sortie 6e",
      "Réunion des parents",
    ]);
    const p2 = await parent("06 640 00 02");
    expect((await getChildAnnouncements(p2, kid.CHLOE)).map((x) => x.title)).toEqual([
      "5e A",
      "Réunion des parents",
    ]);
    // Même en lisant la table directement, la base ne lui montre que les siennes.
    const seen = await withSchool({ schoolId: a.schoolId, userId: p1.userId }, (tx) =>
      tx.select({ title: announcements.title }).from(announcements),
    );
    expect(seen.map((s) => s.title).sort()).toEqual(["Réunion des parents", "Sortie 6e"]);
    expect(await getChildAnnouncements(p1, kid.CHLOE)).toEqual([]);
  });
});
