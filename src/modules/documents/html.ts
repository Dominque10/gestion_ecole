// Briques communes des documents imprimables (HTML converti en PDF par le worker).

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Échappe un texte pour l'insérer dans du HTML (noms, motifs : saisis par des utilisateurs). */
export function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Format de page : A4 (listes, certificats), A5 (reçu), ticket 80 mm (imprimante de caisse). */
export type PageFormat = "A4" | "A5" | "ticket";

const PAGE_CSS: Record<PageFormat, string> = {
  A4: "@page { size: A4; margin: 15mm; }",
  A5: "@page { size: A5; margin: 10mm; }",
  ticket: "@page { size: 80mm auto; margin: 3mm; } body { width: 74mm; font-size: 11px; }",
};

/** Document HTML complet, autonome (aucune ressource externe : le worker n'a pas d'accès réseau). */
export function htmlDocument(
  title: string,
  format: PageFormat,
  body: string,
  extraCss = "",
): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
${PAGE_CSS[format]}
* { box-sizing: border-box; }
body { font-family: "DejaVu Sans", Arial, sans-serif; color: #111; margin: 0; font-size: 12px; }
h1 { font-size: 16px; margin: 6px 0; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 3px 4px; vertical-align: top; }
.right { text-align: right; }
.center { text-align: center; }
.muted { color: #555; }
.rule { border-top: 1px dashed #777; margin: 6px 0; }
.big { font-size: 15px; font-weight: bold; }
.cancelled { color: #b00; font-size: 18px; font-weight: bold; text-align: center; border: 2px solid #b00; padding: 4px; }
${extraCss}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/** Montant en francs CFA, espaces fines remplacées par des espaces simples (« 150 000 FCFA »). */
export function money(amount: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(amount).replace(/\s/g, " ")} FCFA`;
}
