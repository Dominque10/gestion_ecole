import { describe, expect, it } from "vitest";
import {
  duplicateKey,
  headerKey,
  parseCsv,
  parseDate,
  parsePhone,
  parseSex,
  tableToRows,
  validateRows,
  type ImportContext,
  type RawRow,
} from "./import-parse";

describe("parseCsv", () => {
  it("Excel français : point-virgule, guillemets, BOM, lignes vides ignorées", () => {
    const csv = '﻿Nom;Prénoms\r\nNGOMA;"Paul; dit ""Polo"""\r\n\r\nMABIALA;Ève\r\n';
    expect(parseCsv(csv)).toEqual([
      ["Nom", "Prénoms"],
      ["NGOMA", 'Paul; dit "Polo"'],
      ["MABIALA", "Ève"],
    ]);
  });

  it("virgule ou tabulation détectées sur la ligne d'en-têtes", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("en-têtes", () => {
  it("reconnus sans tenir compte des accents, de la casse ni des précisions", () => {
    expect(headerKey("PRENOMS")).toBe("firstNames");
    expect(headerKey("Date de naissance (JJ/MM/AAAA)")).toBe("birthDate");
    expect(headerKey("telephone du responsable")).toBe("guardianPhone");
    expect(headerKey("Colonne inconnue")).toBeNull();
  });

  it("signale les colonnes obligatoires absentes", () => {
    const { missingColumns } = tableToRows([["Nom", "Prénoms"]]);
    expect(missingColumns).toEqual([
      "Sexe (F ou M)",
      "Nom du responsable",
      "Téléphone du responsable",
    ]);
  });
});

describe("cellules", () => {
  it("dates : JJ/MM/AAAA, AAAA-MM-JJ, date Excel ; refuse le 30 février", () => {
    expect(parseDate("12/03/2014")).toBe("2014-03-12");
    expect(parseDate("1-3-2014")).toBe("2014-03-01");
    expect(parseDate("2014-03-12")).toBe("2014-03-12");
    expect(parseDate(new Date("2014-03-12T00:00:00Z"))).toBe("2014-03-12");
    expect(parseDate("")).toBe("");
    expect(parseDate("30/02/2014")).toBeNull();
    expect(parseDate("mars 2014")).toBeNull();
  });

  it("téléphones : le 0 effacé par Excel est remis", () => {
    expect(parsePhone(61234567)).toBe("+242061234567");
    expect(parsePhone("61234567")).toBe("+242061234567");
    expect(parsePhone("06 123 45 67")).toBe("+242061234567");
    expect(parsePhone("123")).toBeNull();
  });

  it("sexe : F, M, Fille, Garçon…", () => {
    expect(["F", "fille", "Féminin", "M", "g", "Garçon", "x"].map(parseSex)).toEqual([
      "F",
      "F",
      "F",
      "M",
      "M",
      "M",
      null,
    ]);
  });
});

describe("validateRows", () => {
  const context: ImportContext = {
    levels: new Map([
      ["6e", { id: "L6" }],
      ["5e", { id: "L5" }],
    ]),
    classes: new Map([["6e a", { id: "C6A", levelId: "L6" }]]),
    existing: new Set([duplicateKey("DEJA", "Là", "2014-01-01")]),
  };
  const ok: RawRow = {
    lastName: "ngoma",
    firstNames: "paul",
    sex: "M",
    birthDate: "12/03/2014",
    guardianName: "Awa Ngoma",
    guardianPhone: 65551122,
    level: "6E",
    className: "6e A",
  };

  it("une ligne correcte est mise en forme et reliée au niveau et à la classe", () => {
    const { valid, errors } = validateRows([ok], context);
    expect(errors).toEqual([]);
    expect(valid[0]).toMatchObject({
      line: 2,
      lastName: "NGOMA",
      firstNames: "Paul",
      birthDate: "2014-03-12",
      guardianPhone: "+242065551122",
      levelId: "L6",
      classId: "C6A",
    });
  });

  it("rapporte chaque erreur avec sa ligne et sa colonne", () => {
    const { valid, errors } = validateRows(
      [
        ok,
        { ...ok, firstNames: "Bob", sex: "?", birthDate: "31/02/2014", guardianPhone: "12" },
        { ...ok, firstNames: "Eve", level: "CM9", className: "" },
        { ...ok, firstNames: "Zoé", level: "5e" },
      ],
      context,
    );
    expect(valid).toHaveLength(1);
    expect(errors.map((e) => [e.line, e.column])).toEqual([
      [3, "Sexe (F ou M)"],
      [3, "Date de naissance (JJ/MM/AAAA)"],
      [3, "Téléphone du responsable"],
      [4, "Niveau"],
      [5, "Classe"],
    ]);
    expect(errors[3].message).toBe("Niveau « CM9 » inconnu de l'école.");
  });

  it("refuse un élève déjà dans l'école ou présent deux fois dans le fichier", () => {
    const { errors } = validateRows(
      [
        { ...ok, lastName: "Déjà", firstNames: "là", birthDate: "01/01/2014" },
        ok,
        { ...ok, lastName: "NGOMA ", firstNames: " Paul" },
      ],
      context,
    );
    expect(errors.map((e) => [e.line, e.message])).toEqual([
      [2, "Cet élève est déjà dans l'école."],
      [4, "Élève en double dans le fichier (voir la ligne 3)."],
    ]);
  });
});
