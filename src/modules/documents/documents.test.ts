import { beforeAll, describe, expect, it } from "vitest";
import type { Receipt } from "@/modules/finance/payments";
import { escapeHtml, money } from "./html";
import { receiptHtml } from "./receipt-template";
import { receiptToken, receiptVerifyUrl, verifyReceiptToken } from "./verification";

const ID = "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90";

beforeAll(() => {
  process.env.AUTH_SECRET = "secret-de-test-assez-long-pour-signer";
  process.env.APP_URL = "https://ecole.example/";
});

describe("escapeHtml / money", () => {
  it("neutralise le HTML saisi par les utilisateurs", () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;",
    );
    expect(escapeHtml(null)).toBe("");
  });

  it("montants en FCFA", () => {
    expect(money(150_000)).toBe("150 000 FCFA");
  });
});

describe("liens de vérification des reçus", () => {
  it("un jeton signé est reconnu ; l'URL publique le contient", () => {
    expect(verifyReceiptToken(receiptToken(ID))).toBe(ID);
    expect(receiptVerifyUrl(ID)).toBe(`https://ecole.example/verifier/${receiptToken(ID)}`);
  });

  it("refuse un jeton modifié, une signature d'un autre reçu, un identifiant invalide", () => {
    const other = "11111111-1111-4111-8111-111111111111";
    const [, sig] = receiptToken(ID).split(".");
    expect(verifyReceiptToken(`${other}.${sig}`)).toBeNull();
    expect(verifyReceiptToken(`${ID}.${sig.slice(0, -1)}x`)).toBeNull();
    expect(verifyReceiptToken(`${ID}`)).toBeNull();
    expect(verifyReceiptToken(`pas-un-uuid.${sig}`)).toBeNull();
  });

  it("refuse de signer sans secret configuré", () => {
    const saved = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    expect(() => receiptToken(ID)).toThrow(/AUTH_SECRET/);
    process.env.AUTH_SECRET = saved;
  });
});

describe("gabarit du reçu", () => {
  const receipt: Receipt = {
    paymentId: ID,
    receiptNumber: "SJB-2026-00001",
    paidAt: new Date("2026-11-21T13:05:00Z"),
    amount: 30_000,
    method: "mobile_money",
    reference: "MP<1>",
    note: null,
    cashierName: "Jean Comptable",
    school: { name: "École <Saint-Jean>", address: "Brazzaville", phone: null, logoKey: null },
    student: {
      matricule: "SJB-26-00001",
      name: "NGOMA Paul",
      level: "6e",
      className: "6e A",
      year: "2026-2027",
    },
    allocations: [
      { label: "Frais d'inscription", amount: 25_000 },
      { label: "Scolarité — tranche 1/2", amount: 5_000 },
    ],
    remainingAfter: 95_000,
    reversed: false,
  };

  it("reprend l'école, l'élève, le détail, le reste à payer et l'heure de Brazzaville, textes échappés", () => {
    const html = receiptHtml(receipt, {
      format: "ticket",
      qrSvg: "<svg></svg>",
      logoDataUri: null,
    });
    expect(html).toContain("Reçu n° SJB-2026-00001");
    expect(html).toContain("École &lt;Saint-Jean&gt;");
    expect(html).toContain("Référence : MP&lt;1&gt;");
    expect(html).toContain("21/11/2026 14:05");
    expect(html).toContain("Scolarité — tranche 1/2");
    expect(html).toContain("95 000 FCFA");
    expect(html).toContain("width: 74mm");
    expect(html).not.toContain("PAIEMENT ANNULÉ");
  });

  it("un reçu annulé porte la mention", () => {
    const html = receiptHtml(
      { ...receipt, reversed: true },
      { format: "A5", qrSvg: "", logoDataUri: null },
    );
    expect(html).toContain("PAIEMENT ANNULÉ");
    expect(html).toContain("size: A5");
  });
});

describe("gabarits liste, cartes, certificats", async () => {
  const { certificateHtml, classListHtml, studentCardsHtml } = await import("./school-templates");
  const school = {
    name: "École <A>",
    address: null,
    phone: "06",
    logo: null,
    stamp: null,
    signature: null,
  };
  const roster = {
    classId: ID,
    className: "6e A",
    levelName: "6e",
    yearLabel: "2026-2027",
    headTeacherName: "M. Okemba",
    students: [
      {
        studentId: "1",
        matricule: "SJB-26-00001",
        lastName: "ADA",
        firstNames: "Test",
        sex: "F" as const,
        birthDate: "2014-03-12",
        photoKey: null,
      },
      {
        studentId: "2",
        matricule: "SJB-26-00002",
        lastName: "<BOB>",
        firstNames: "Test",
        sex: "M" as const,
        birthDate: null,
        photoKey: null,
      },
    ],
  };

  it("liste de classe : effectif par sexe, numérotation, textes échappés", () => {
    const html = classListHtml(school, roster, "2026-11-21");
    expect(html).toContain("Liste de la classe 6e A — 2026-2027");
    expect(html).toContain("Effectif : 2 (1 garçon(s), 1 fille(s))");
    expect(html).toContain("&lt;BOB&gt;");
    expect(html).toContain("12 mars 2014");
    expect(html).toContain("Professeur principal : M. Okemba");
  });

  it("cartes : une par élève, photo si disponible", () => {
    const html = studentCardsHtml(school, roster, new Map([["1", "data:image/png;base64,AAA"]]));
    expect(html.match(/class="card"/g)).toHaveLength(2);
    expect(html).toContain("data:image/png;base64,AAA");
    expect(html).toContain("Carte scolaire 2026-2027");
  });

  it("certificats de scolarité et de radiation", () => {
    const data = {
      status: "left" as const,
      student: {
        matricule: "SJB-26-00001",
        lastName: "ADA",
        firstNames: "Test",
        sex: "F" as const,
        birthDate: "2014-03-12",
        birthPlace: "Brazzaville",
      },
      yearLabel: "2026-2027",
      levelName: "6e",
      className: "6e A",
      entryDate: "2026-10-01",
      exitDate: "2027-02-10",
      exitReason: "transfer" as const,
    };
    const schooling = certificateHtml(school, data, "schooling", "2026-11-21");
    expect(schooling).toContain("Certificat de scolarité");
    expect(schooling).toContain("née le 12 mars 2014 à Brazzaville");
    expect(schooling).toContain("en classe de <strong>6e A</strong>");
    expect(schooling).toContain("est régulièrement inscrite");
    expect(schooling).toContain("depuis le 1er octobre 2026");
    const radiation = certificateHtml(school, data, "radiation", "2027-02-11");
    expect(radiation).toContain("a quitté l'établissement le 10 février 2027");
    expect(radiation).toContain("transfert vers un autre établissement");
  });
});
