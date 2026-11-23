// Base locale du téléphone (IndexedDB, via Dexie) pour la saisie des notes hors connexion (3c).
// Tout est rangé par « propriétaire » (école + compte) : deux comptes sur un même téléphone ne voient
// jamais les données l'un de l'autre.
import Dexie, { type EntityTable } from "dexie";
import type { AssessmentKind } from "@/modules/grading/grade-input";

/** Propriétaire des données : `<école>:<compte>`. */
export type Owner = string;

export type OfflineStudent = { enrollmentId: string; lastName: string; firstNames: string };

/** Copie d'une matière d'une classe : de quoi créer une évaluation et noter sans réseau. */
export type OfflineCourse = {
  key: string;
  owner: Owner;
  classId: string;
  subjectId: string;
  className: string;
  subjectName: string;
  periods: { id: string; label: string; startDate: string; endDate: string }[];
  currentPeriodId: string | null;
  defaultMaxScore: number;
  /** Périodes closes pour la classe (notes verrouillées) ; absent dans les copies anciennes. */
  closedPeriodIds?: string[];
  students: OfflineStudent[];
  savedAt: number;
};

/** Copie d'une évaluation et des notes connues du serveur (référence pour détecter les conflits). */
export type OfflineSheet = {
  key: string;
  owner: Owner;
  assessmentId: string;
  classId: string;
  subjectId: string;
  periodId: string;
  kind: AssessmentKind;
  title: string | null;
  date: string;
  maxScore: number;
  /** Valeur enregistrée sur le serveur, par inscription. */
  values: Record<string, string>;
  savedAt: number;
};

export type AssessmentDraft = {
  periodId: string;
  kind: AssessmentKind;
  title: string;
  date: string;
  maxScore: number;
};

/** Évaluation créée sur le téléphone, pas encore envoyée (identifiant créé sur le téléphone). */
export type PendingAssessment = {
  id: string;
  owner: Owner;
  classId: string;
  subjectId: string;
  input: AssessmentDraft;
  createdAt: number;
  /** Refus du serveur (texte affiché) : l'évaluation reste sur le téléphone. */
  error?: string;
};

/**
 * Case saisie, pas encore enregistrée sur le serveur :
 * - pending : à envoyer ;
 * - conflict : la note a changé sur le serveur depuis la saisie ; l'enseignant choisit ;
 * - error : refusée par le serveur (motif affiché).
 */
export type PendingCell = {
  key: string;
  owner: Owner;
  assessmentId: string;
  enrollmentId: string;
  /** Valeur du serveur quand la saisie a commencé. */
  expected: string;
  value: string;
  state: "pending" | "conflict" | "error";
  /** Valeur trouvée sur le serveur lors d'un conflit. */
  current?: string;
  /** Motif d'un refus. */
  error?: string;
  updatedAt: number;
};

/** Copie d'une classe pour faire l'appel sans réseau (3e). */
export type OfflineRollClass = {
  key: string;
  owner: Owner;
  classId: string;
  className: string;
  slots: { id: string; label: string; startTime: string; endTime: string }[];
  subjects: { classSubjectId: string; name: string }[];
  students: OfflineStudent[];
  yearStart: string;
  yearEnd: string;
  savedAt: number;
};

/** Appel connu du serveur pour une classe, un jour et un créneau (référence des conflits). */
export type OfflineRollCall = {
  key: string;
  owner: Owner;
  classId: string;
  date: string;
  slotId: string;
  /** « present », « absent », « late » par inscription ; absent de la liste = appel pas fait. */
  values: Record<string, string>;
  savedAt: number;
};

/** Ligne d'appel saisie sur le téléphone, pas encore enregistrée sur le serveur. */
export type PendingMark = {
  key: string;
  owner: Owner;
  /** Appel concerné : `<propriétaire>|<classe>|<jour>|<créneau>`. */
  callKey: string;
  classId: string;
  date: string;
  slotId: string;
  classSubjectId: string | null;
  enrollmentId: string;
  expected: string;
  value: string;
  state: "pending" | "conflict" | "error";
  current?: string;
  error?: string;
  updatedAt: number;
};

export class OfflineDb extends Dexie {
  courses!: EntityTable<OfflineCourse, "key">;
  sheets!: EntityTable<OfflineSheet, "key">;
  assessments!: EntityTable<PendingAssessment, "id">;
  cells!: EntityTable<PendingCell, "key">;
  rollClasses!: EntityTable<OfflineRollClass, "key">;
  rollCalls!: EntityTable<OfflineRollCall, "key">;
  marks!: EntityTable<PendingMark, "key">;

  constructor(name = "gestion-ecole-notes") {
    super(name);
    this.version(1).stores({
      courses: "&key, owner",
      sheets: "&key, owner, [owner+classId+subjectId]",
      assessments: "&id, owner",
      cells: "&key, owner, [owner+assessmentId]",
    });
    // 3e : appel hors connexion.
    this.version(2).stores({
      rollClasses: "&key, owner",
      rollCalls: "&key, owner",
      marks: "&key, owner, callKey",
    });
  }
}

export const courseKey = (owner: Owner, classId: string, subjectId: string) =>
  `${owner}|${classId}|${subjectId}`;
export const sheetKey = (owner: Owner, assessmentId: string) => `${owner}|${assessmentId}`;
export const cellKey = (owner: Owner, assessmentId: string, enrollmentId: string) =>
  `${owner}|${assessmentId}|${enrollmentId}`;
export const rollClassKey = (owner: Owner, classId: string) => `${owner}|${classId}`;
export const callKey = (owner: Owner, classId: string, date: string, slotId: string) =>
  `${owner}|${classId}|${date}|${slotId}`;
export const markKey = (call: string, enrollmentId: string) => `${call}|${enrollmentId}`;

let instance: OfflineDb | null = null;

/** Base du navigateur (une seule instance par onglet). */
export function offlineDb(): OfflineDb {
  instance ??= new OfflineDb();
  return instance;
}
