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
    expect(html).toContain("size: 80mm auto");
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
