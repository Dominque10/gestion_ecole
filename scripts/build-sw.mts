// Construit le service worker (src/sw/sw.ts) après `next build`. Usage : lancé par `pnpm build`.
// Les fichiers gardés d'avance sont ceux de la page « Notes hors connexion » (lus dans sa page
// pré-rendue) : la page s'ouvre ainsi sans réseau dès la première installation.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const OFFLINE_HTML = ".next/server/app/notes/hors-ligne.html";
const OUT = ".next/sw.js";

if (!existsSync(OFFLINE_HTML)) {
  console.error(
    `Page hors connexion non pré-rendue (${OFFLINE_HTML}) : elle doit rester statique.`,
  );
  process.exit(1);
}
const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();
const html = readFileSync(OFFLINE_HTML, "utf8");
const assets = [
  ...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?#]+)"/g)].map((m) => m[1])),
];

const precache = [
  // Noms uniques à chaque version : pas besoin de révision.
  ...assets.map((url) => ({ url, revision: null })),
  { url: "/notes/hors-ligne", revision: buildId },
  { url: "/manifest.webmanifest", revision: buildId },
  { url: "/icons/icon-192.png", revision: buildId },
];

const result = await build({
  entryPoints: ["src/sw/sw.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  write: false,
  define: {
    __PRECACHE__: JSON.stringify(precache),
    "process.env.NODE_ENV": '"production"',
  },
});
writeFileSync(OUT, result.outputFiles[0].contents);
console.log(`Service worker : ${precache.length} fichiers gardés d'avance → ${OUT}`);
