import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GradeEntry, SaveGradesResult } from "@/modules/grading/assessments";
import { cellKey, OfflineDb, sheetKey } from "./db";
import {
  clearCopies,
  countPending,
  createLocalAssessment,
  discardCell,
  keepMine,
  recordCells,
  saveCourseCopy,
} from "./store";
import { syncPending, type SyncApi, type SyncReply } from "./sync";
import { callKey, markKey } from "./db";
import { discardMark, keepMyMark, recordMarks, saveRollCallCopy } from "./roll-store";

const OWNER = "ecole:compte";
const CLASS = "classe";
const SUBJECT = "maths";
const A = "evaluation-a";

let db: OfflineDb;

/** Faux serveur : notes en mémoire, même règle de conflit que `saveGrades`. */
function fakeServer() {
  const grades = new Map<string, string>(); // `${assessment}|${enrollment}` → valeur
  const assessments = new Set<string>([A]);
  const roll = new Map<string, string>(); // `classe|jour|créneau|inscription` → statut
  let offline = false;
  let session = true;
  const api: SyncApi = {
    createAssessment: vi.fn(async (op) => {
      if (offline) throw new TypeError("Failed to fetch");
      if (!session) return { ok: false, code: "session", message: "" } as const;
      if (op.input.maxScore > 100) {
        return { ok: false, code: "refused", message: "Évaluation invalide" } as const;
      }
      assessments.add(op.id);
      return { ok: true, result: { id: op.id } } as const;
    }),
    saveGrades: vi.fn(
      async (assessmentId: string, entries: GradeEntry[]): Promise<SyncReply<SaveGradesResult>> => {
        if (offline) throw new TypeError("Failed to fetch");
        if (!session) return { ok: false, code: "session", message: "" };
        if (!assessments.has(assessmentId)) {
          return { ok: false, code: "refused", message: "Évaluation introuvable" };
        }
        const result: SaveGradesResult = { saved: 0, problems: [], conflicts: [] };
        for (const e of entries) {
          if (e.value === "99") {
            result.problems.push({ enrollmentId: e.enrollmentId, problem: "outOfRange" });
          }
        }
        if (result.problems.length > 0) return { ok: true, result };
        for (const e of entries) {
          const key = `${assessmentId}|${e.enrollmentId}`;
          const now = grades.get(key) ?? "";
          if (now === e.value) continue;
          if (now !== e.expected) {
            result.conflicts.push({ enrollmentId: e.enrollmentId, current: now });
            continue;
          }
          if (e.value === "") grades.delete(key);
          else grades.set(key, e.value);
          result.saved++;
        }
        return { ok: true, result };
      },
    ),
    saveRollCall: vi.fn(async (call, entries) => {
      if (offline) throw new TypeError("Failed to fetch");
      if (!session) return { ok: false, code: "session", message: "" } as const;
      const conflicts: { enrollmentId: string; current: "" | "present" | "absent" | "late" }[] = [];
      let saved = 0;
      for (const e of entries) {
        const key = `${call.classId}|${call.date}|${call.slotId}|${e.enrollmentId}`;
        const now = roll.get(key) ?? "";
        if (now === e.value) continue;
        if (now !== e.expected) {
          conflicts.push({ enrollmentId: e.enrollmentId, current: now as "present" });
          continue;
        }
        roll.set(key, e.value);
        saved++;
      }
      return { ok: true, result: { saved, conflicts } } as const;
    }),
  };
  return {
    api,
    grades,
    roll,
    goOffline: (v: boolean) => (offline = v),
    expireSession: () => (session = false),
  };
}

beforeEach(async () => {
  db = new OfflineDb(`test-${crypto.randomUUID()}`);
  await saveCourseCopy(
    db,
    {
      owner: OWNER,
      classId: CLASS,
      subjectId: SUBJECT,
      className: "6e A",
      subjectName: "Mathématiques",
      periods: [{ id: "t1", label: "Trimestre 1", startDate: "2026-10-01", endDate: "2026-12-31" }],
      currentPeriodId: "t1",
      defaultMaxScore: 20,
      students: [
        { enrollmentId: "ada", lastName: "ADA", firstNames: "Test" },
        { enrollmentId: "bob", lastName: "BOB", firstNames: "Test" },
      ],
    },
    [
      {
        assessmentId: A,
        periodId: "t1",
        kind: "quiz",
        title: null,
        date: "2026-11-05",
        maxScore: 20,
        values: { ada: "10" },
      },
    ],
  );
});

const cell = (assessmentId: string, enrollmentId: string) =>
  db.cells.get(cellKey(OWNER, assessmentId, enrollmentId));
const sheetValues = async (assessmentId: string) =>
  (await db.sheets.get(sheetKey(OWNER, assessmentId)))?.values;

describe("Saisies gardées sur le téléphone", () => {
  it("une case garde la valeur du serveur au début de la saisie ; revenir à cette valeur l'annule", async () => {
    await recordCells(db, OWNER, A, [{ enrollmentId: "ada", value: "12" }]);
    await recordCells(db, OWNER, A, [{ enrollmentId: "ada", value: "13" }]);
    expect(await cell(A, "ada")).toMatchObject({ expected: "10", value: "13", state: "pending" });
    await recordCells(db, OWNER, A, [{ enrollmentId: "ada", value: "10,0" }]);
    expect(await cell(A, "ada")).toBeUndefined();
  });

  it("à la déconnexion, les copies partent mais pas les saisies en attente", async () => {
    await recordCells(db, OWNER, A, [{ enrollmentId: "bob", value: "a" }]);
    await clearCopies(db, OWNER);
    expect(await db.courses.count()).toBe(0);
    expect(await sheetValues(A)).toEqual({ ada: "10" }); // évaluation encore utile
    expect(await countPending(db, OWNER)).toMatchObject({ pending: 1 });
  });
});

describe("Envoi au retour du réseau", () => {
  it("sans réseau, rien n'est perdu ; au retour, les notes partent et deviennent la référence", async () => {
    const server = fakeServer();
    server.grades.set(`${A}|ada`, "10");
    await recordCells(db, OWNER, A, [
      { enrollmentId: "ada", value: "12,50" },
      { enrollmentId: "bob", value: "a" },
    ]);
    server.goOffline(true);
    expect(await syncPending(db, OWNER, server.api)).toEqual({ status: "offline", sent: 0 });
    expect(await countPending(db, OWNER)).toMatchObject({ pending: 2 });

    server.goOffline(false);
    expect(await syncPending(db, OWNER, server.api)).toEqual({ status: "done", sent: 2 });
    expect(await db.cells.count()).toBe(0);
    expect(await sheetValues(A)).toEqual({ ada: "12,5", bob: "a" });
    expect(server.grades.get(`${A}|ada`)).toBe("12,50");
  });

  it("une note changée sur le serveur n'est pas remplacée ; l'enseignant choisit", async () => {
    const server = fakeServer();
    server.grades.set(`${A}|ada`, "10");
    await recordCells(db, OWNER, A, [{ enrollmentId: "ada", value: "12" }]);
    server.grades.set(`${A}|ada`, "15"); // le directeur corrige pendant ce temps
    await syncPending(db, OWNER, server.api);
    expect(await cell(A, "ada")).toMatchObject({ state: "conflict", current: "15", value: "12" });
    expect(server.grades.get(`${A}|ada`)).toBe("15");

    // Un conflit ne repart jamais tout seul.
    await syncPending(db, OWNER, server.api);
    expect(server.grades.get(`${A}|ada`)).toBe("15");

    // « Garder ma note » : envoyée en connaissance de la valeur actuelle.
    await keepMine(db, (await cell(A, "ada"))!);
    await syncPending(db, OWNER, server.api);
    expect(server.grades.get(`${A}|ada`)).toBe("12");
    expect(await cell(A, "ada")).toBeUndefined();
  });

  it("« garder la note actuelle » abandonne la saisie et reprend la valeur du serveur", async () => {
    const server = fakeServer();
    await recordCells(db, OWNER, A, [{ enrollmentId: "bob", value: "8" }]);
    server.grades.set(`${A}|bob`, "d");
    await syncPending(db, OWNER, server.api);
    await discardCell(db, (await cell(A, "bob"))!);
    expect(await cell(A, "bob")).toBeUndefined();
    expect((await sheetValues(A))?.bob).toBe("d");
  });

  it("une évaluation créée sur le téléphone part avant ses notes, une seule fois", async () => {
    const server = fakeServer();
    const id = await createLocalAssessment(
      db,
      OWNER,
      { classId: CLASS, subjectId: SUBJECT },
      {
        periodId: "t1",
        kind: "composition",
        title: "",
        date: "2026-11-20",
        maxScore: 20,
      },
    );
    await recordCells(db, OWNER, id, [{ enrollmentId: "ada", value: "14" }]);
    expect(await countPending(db, OWNER)).toMatchObject({ assessments: 1, pending: 1 });
    expect(await syncPending(db, OWNER, server.api)).toEqual({ status: "done", sent: 2 });
    expect(server.grades.get(`${id}|ada`)).toBe("14");
    expect(server.api.createAssessment).toHaveBeenCalledTimes(1);
    expect(await countPending(db, OWNER)).toEqual({
      pending: 0,
      conflicts: 0,
      errors: 0,
      assessments: 0,
    });
  });

  it("une évaluation refusée reste sur le téléphone avec le motif ; ses notes attendent", async () => {
    const server = fakeServer();
    const id = await createLocalAssessment(
      db,
      OWNER,
      { classId: CLASS, subjectId: SUBJECT },
      {
        periodId: "t1",
        kind: "quiz",
        title: "",
        date: "2026-11-20",
        maxScore: 500,
      },
    );
    await recordCells(db, OWNER, id, [{ enrollmentId: "ada", value: "14" }]);
    await syncPending(db, OWNER, server.api);
    expect((await db.assessments.get(id))?.error).toBe("Évaluation invalide");
    expect(await cell(A, "ada")).toBeUndefined();
    expect((await cell(id, "ada"))?.state).toBe("pending");
    expect(server.api.saveGrades).not.toHaveBeenCalled();
  });

  it("une case refusée est signalée ; les autres cases de l'évaluation ne partent pas sans elle", async () => {
    const server = fakeServer();
    await recordCells(db, OWNER, A, [
      { enrollmentId: "ada", value: "99" },
      { enrollmentId: "bob", value: "7" },
    ]);
    await syncPending(db, OWNER, server.api);
    expect(await cell(A, "ada")).toMatchObject({
      state: "error",
      error: "Note au-dessus du barème",
    });
    expect((await cell(A, "bob"))?.state).toBe("pending");
    expect(server.grades.size).toBe(0);
  });

  it("session expirée : l'envoi s'arrête, tout reste en attente", async () => {
    const server = fakeServer();
    await recordCells(db, OWNER, A, [{ enrollmentId: "bob", value: "7" }]);
    server.expireSession();
    expect(await syncPending(db, OWNER, server.api)).toEqual({ status: "session", sent: 0 });
    expect((await cell(A, "bob"))?.state).toBe("pending");
  });

  it("une case modifiée pendant l'envoi garde la nouvelle saisie", async () => {
    const server = fakeServer();
    await recordCells(db, OWNER, A, [{ enrollmentId: "bob", value: "7" }]);
    const original = server.api.saveGrades;
    server.api.saveGrades = async (id, entries) => {
      await recordCells(db, OWNER, A, [{ enrollmentId: "bob", value: "8" }]);
      return original(id, entries);
    };
    await syncPending(db, OWNER, server.api);
    expect(await cell(A, "bob")).toMatchObject({ expected: "7", value: "8", state: "pending" });
    server.api.saveGrades = original;
    await syncPending(db, OWNER, server.api);
    expect(server.grades.get(`${A}|bob`)).toBe("8");
  });

  it("chaque compte ne voit et n'envoie que ses saisies", async () => {
    const server = fakeServer();
    await recordCells(db, "autre:compte", A, [{ enrollmentId: "bob", value: "7" }]);
    expect(await syncPending(db, OWNER, server.api)).toEqual({ status: "done", sent: 0 });
    expect(await countPending(db, OWNER)).toMatchObject({ pending: 0 });
  });
});

describe("Appel sur le téléphone (3e)", () => {
  const CALL = { classId: CLASS, date: "2026-11-24", slotId: "matin", classSubjectId: null };
  const CK = callKey(OWNER, CLASS, CALL.date, CALL.slotId);
  const mark = (enrollmentId: string) => db.marks.get(markKey(CK, enrollmentId));

  it("appel fait sans réseau : tout part au retour, et la copie du serveur garde les absents", async () => {
    const server = fakeServer();
    await recordMarks(db, OWNER, CALL, [
      { enrollmentId: "ada", value: "present" },
      { enrollmentId: "bob", value: "absent" },
    ]);
    expect(await countPending(db, OWNER)).toMatchObject({ pending: 2 });
    server.goOffline(true);
    expect(await syncPending(db, OWNER, server.api)).toEqual({ status: "offline", sent: 0 });
    server.goOffline(false);
    expect(await syncPending(db, OWNER, server.api)).toEqual({ status: "done", sent: 2 });
    expect(server.roll.get(`${CLASS}|2026-11-24|matin|bob`)).toBe("absent");
    expect(await db.marks.count()).toBe(0);
    expect((await db.rollCalls.get(CK))?.values).toEqual({ ada: "present", bob: "absent" });
  });

  it("ligne changée sur le serveur : conflit, jamais envoyé seul ; l'enseignant tranche", async () => {
    const server = fakeServer();
    await saveRollCallCopy(db, OWNER, CALL, { bob: "absent" });
    server.roll.set(`${CLASS}|2026-11-24|matin|bob`, "absent");
    await recordMarks(db, OWNER, CALL, [{ enrollmentId: "bob", value: "late" }]);
    server.roll.set(`${CLASS}|2026-11-24|matin|bob`, "present"); // le secrétariat corrige
    await syncPending(db, OWNER, server.api);
    expect(await mark("bob")).toMatchObject({
      state: "conflict",
      current: "present",
      value: "late",
    });
    await syncPending(db, OWNER, server.api);
    expect(server.roll.get(`${CLASS}|2026-11-24|matin|bob`)).toBe("present");

    await keepMyMark(db, (await mark("bob"))!);
    await syncPending(db, OWNER, server.api);
    expect(server.roll.get(`${CLASS}|2026-11-24|matin|bob`)).toBe("late");

    // Autre conflit, cette fois abandonné : la valeur du serveur reste.
    await recordMarks(db, OWNER, CALL, [{ enrollmentId: "bob", value: "absent" }]);
    server.roll.set(`${CLASS}|2026-11-24|matin|bob`, "present");
    await syncPending(db, OWNER, server.api);
    await discardMark(db, (await mark("bob"))!);
    expect(await mark("bob")).toBeUndefined();
    expect((await db.rollCalls.get(CK))?.values.bob).toBe("present");
  });

  it("revenir à la valeur du serveur annule la ligne ; la déconnexion garde les lignes en attente", async () => {
    await saveRollCallCopy(db, OWNER, CALL, { ada: "present" });
    await recordMarks(db, OWNER, CALL, [{ enrollmentId: "ada", value: "absent" }]);
    await recordMarks(db, OWNER, CALL, [{ enrollmentId: "ada", value: "present" }]);
    expect(await mark("ada")).toBeUndefined();
    await recordMarks(db, OWNER, CALL, [{ enrollmentId: "ada", value: "late" }]);
    await clearCopies(db, OWNER);
    expect(await mark("ada")).toBeDefined();
    expect(await db.rollCalls.get(CK)).toBeDefined();
  });
});
