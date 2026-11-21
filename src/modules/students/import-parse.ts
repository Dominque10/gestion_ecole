// Import d'élèves (M2, 2g) : lecture et vérification des lignes (fonctions pures, testées).
// Les numéros de ligne sont ceux du tableur : ligne 1 = en-têtes, première élève = ligne 2.
import { normalizePhone } from "@/server/auth/phone";
import { isValidDate } from "@/modules/settings/periods-logic";
import { formatFirstNames, formatLastName, searchKey } from "./identity";

/** Colonnes du modèle, dans l'ordre. `required` : obligatoire sur chaque ligne. */
export const IMPORT_COLUMNS = [
  { key: "lastName", header: "Nom", required: true },
  { key: "firstNames", header: "Prénoms", required: true },
  { key: "sex", header: "Sexe (F ou M)", required: true },
  { key: "birthDate", header: "Date de naissance (JJ/MM/AAAA)", required: false },
  { key: "birthPlace", header: "Lieu de naissance", required: false },
  { key: "nationality", header: "Nationalité", required: false },
  { key: "previousSchool", header: "École d'origine", required: false },
  { key: "guardianName", header: "Nom du responsable", required: true },
  { key: "guardianPhone", header: "Téléphone du responsable", required: true },
  { key: "relationship", header: "Lien avec l'élève", required: false },
  { key: "otherPhone", header: "Autre téléphone", required: false },
  { key: "level", header: "Niveau", required: false },
  { key: "className", header: "Classe", required: false },
] as const;

export type ImportKey = (typeof IMPORT_COLUMNS)[number]["key"];
export type RawRow = Partial<Record<ImportKey, unknown>>;

/** Limite par fichier (au-delà, découper le fichier). */
export const MAX_IMPORT_ROWS = 3000;

const HEADER_KEYS = new Map<string, ImportKey>(
  IMPORT_COLUMNS.map((c) => [searchKey(c.header.replace(/\(.*\)/, "")), c.key]),
);

/** Reconnaît un en-tête (accents, casse et précisions entre parenthèses ignorés). */
export function headerKey(header: string): ImportKey | null {
  return HEADER_KEYS.get(searchKey(String(header).replace(/\(.*\)/, ""))) ?? null;
}

/**
 * Lit un fichier CSV : séparateur « ; » (Excel en français), « , » ou tabulation, détecté sur la
 * ligne d'en-têtes ; guillemets doubles ; marque d'ordre des octets retirée.
 */
export function parseCsv(text: string): string[][] {
  const content = text.replace(/^﻿/, "");
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [";", "\t", ","].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best,
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (quoted) {
      if (c === '"' && content[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && content[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Transforme un tableau (en-têtes + lignes) en lignes nommées ; ignore les colonnes inconnues. */
export function tableToRows(table: unknown[][]): { rows: RawRow[]; missingColumns: string[] } {
  const [headers = [], ...lines] = table;
  const keys = headers.map((h) => headerKey(String(h ?? "")));
  const missingColumns = IMPORT_COLUMNS.filter((c) => c.required && !keys.includes(c.key)).map(
    (c) => c.header,
  );
  const rows = lines.map((line) => {
    const row: RawRow = {};
    keys.forEach((key, i) => {
      if (key) row[key] = line[i];
    });
    return row;
  });
  return { rows, missingColumns };
}

/** Texte d'une cellule (nombre, date, texte) sans espaces superflus. */
function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

/**
 * Date de naissance : « 12/03/2014 », « 12-03-2014 », « 2014-03-12 » ou date Excel.
 * Renvoie AAAA-MM-JJ, "" si vide, null si invalide.
 */
export function parseDate(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const t = text(value);
  if (t === "") return "";
  let iso = t;
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (fr) iso = `${fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}`;
  return isValidDate(iso) ? iso : null;
}

/**
 * Téléphone : Excel enlève le 0 initial des numéros saisis comme des nombres (061234567 devient
 * 61234567) ; on le remet pour les numéros congolais à 8 chiffres. Renvoie null si invalide.
 */
export function parsePhone(value: unknown): string | null {
  let t = text(value).replace(/\.0+$/, "");
  if (/^\d{8}$/.test(t)) t = `0${t}`;
  return t === "" ? null : normalizePhone(t);
}

/** Sexe : F, M, Fille, Garçon, Féminin, Masculin (casse et accents ignorés). */
export function parseSex(value: unknown): "M" | "F" | null {
  const t = searchKey(text(value));
  if (["f", "fille", "feminin", "femme"].includes(t)) return "F";
  if (["m", "g", "garcon", "masculin", "homme"].includes(t)) return "M";
  return null;
}

export type ImportRow = {
  line: number;
  lastName: string;
  firstNames: string;
  sex: "M" | "F";
  birthDate: string | null;
  birthPlace: string | null;
  nationality: string | null;
  previousSchool: string | null;
  guardianName: string;
  guardianPhone: string;
  otherPhone: string | null;
  relationship: string | null;
  levelId: string | null;
  classId: string | null;
};

export type ImportError = { line: number; column: string; message: string };

export type ImportContext = {
  /** Niveaux de l'école par nom (casse et accents ignorés). */
  levels: Map<string, { id: string }>;
  /** Classes de l'année cible par nom, avec leur niveau. */
  classes: Map<string, { id: string; levelId: string }>;
  /** Élèves déjà dans l'école : clé nom + prénoms + date de naissance. */
  existing: Set<string>;
};

/** Clé de doublon : nom, prénoms et date de naissance. */
export const duplicateKey = (lastName: string, firstNames: string, birthDate: string | null) =>
  `${searchKey(lastName)}|${searchKey(firstNames)}|${birthDate ?? ""}`;

const optional = (value: unknown, max: number) => {
  const t = text(value);
  return t === "" ? null : t.slice(0, max);
};

/** Vérifie toutes les lignes ; chaque problème est rapporté avec sa ligne et sa colonne. */
export function validateRows(
  rows: readonly RawRow[],
  context: ImportContext,
): { valid: ImportRow[]; errors: ImportError[] } {
  const valid: ImportRow[] = [];
  const errors: ImportError[] = [];
  const seen = new Map<string, number>();
  rows.forEach((raw, index) => {
    const line = index + 2;
    const lineErrors: ImportError[] = [];
    const fail = (column: ImportKey, message: string) =>
      lineErrors.push({
        line,
        column: IMPORT_COLUMNS.find((c) => c.key === column)!.header,
        message,
      });

    const lastName = text(raw.lastName);
    const firstNames = text(raw.firstNames);
    if (lastName === "" || lastName.length > 80) fail("lastName", "Nom manquant ou trop long.");
    if (firstNames === "" || firstNames.length > 120) {
      fail("firstNames", "Prénoms manquants ou trop longs.");
    }
    const sex = parseSex(raw.sex);
    if (!sex) fail("sex", "Indiquez F (fille) ou M (garçon).");
    const birthDate = parseDate(raw.birthDate);
    if (birthDate === null)
      fail("birthDate", "Date invalide : utilisez JJ/MM/AAAA, ex. 12/03/2014.");
    const guardianName = text(raw.guardianName);
    if (guardianName.length < 2 || guardianName.length > 120) {
      fail("guardianName", "Nom du responsable manquant.");
    }
    const guardianPhone = parsePhone(raw.guardianPhone);
    if (!guardianPhone) fail("guardianPhone", "Téléphone invalide, ex. 06 123 45 67.");
    const otherRaw = text(raw.otherPhone);
    const otherPhone = otherRaw === "" ? null : parsePhone(otherRaw);
    if (otherRaw !== "" && !otherPhone) fail("otherPhone", "Téléphone invalide, ex. 05 123 45 67.");

    const levelName = text(raw.level);
    const level = levelName === "" ? null : context.levels.get(searchKey(levelName));
    if (levelName !== "" && !level) fail("level", `Niveau « ${levelName} » inconnu de l'école.`);
    const className = text(raw.className);
    const schoolClass = className === "" ? null : context.classes.get(searchKey(className));
    if (className !== "") {
      if (!schoolClass) fail("className", `Classe « ${className} » inconnue pour cette année.`);
      else if (!level) fail("level", "Indiquez le niveau de l'élève placé dans une classe.");
      else if (schoolClass.levelId !== level.id) {
        fail("className", `La classe « ${className} » n'est pas du niveau « ${levelName} ».`);
      }
    }

    if (lastName && firstNames && birthDate !== null) {
      const key = duplicateKey(lastName, firstNames, birthDate || null);
      if (context.existing.has(key)) fail("lastName", "Cet élève est déjà dans l'école.");
      const previous = seen.get(key);
      if (previous)
        fail("lastName", `Élève en double dans le fichier (voir la ligne ${previous}).`);
      else seen.set(key, line);
    }

    if (lineErrors.length > 0) {
      errors.push(...lineErrors);
      return;
    }
    valid.push({
      line,
      lastName: formatLastName(lastName),
      firstNames: formatFirstNames(firstNames),
      sex: sex as "M" | "F",
      birthDate: birthDate || null,
      birthPlace: optional(raw.birthPlace, 80),
      nationality: optional(raw.nationality, 60),
      previousSchool: optional(raw.previousSchool, 120),
      guardianName,
      guardianPhone: guardianPhone as string,
      otherPhone,
      relationship: optional(raw.relationship, 40),
      levelId: level?.id ?? null,
      classId: schoolClass?.id ?? null,
    });
  });
  return { valid, errors };
}
