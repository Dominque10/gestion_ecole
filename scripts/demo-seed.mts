// Site de démonstration (mise en service, Sg, décision D38). Usage :
//   pnpm demo:seed              crée l'école de démonstration si elle n'existe pas
//   pnpm demo:seed --reset      efface tout (sauf les super-administrateurs) et la recrée
//   pnpm demo:seed --nightly    service « demo » : crée si besoin, puis remise à neuf chaque nuit
//                               à DEMO_RESET_TIME (03:30, heure de Brazzaville, par défaut)
// Refuse de tourner sans DEMO_SITE=true et DEMO_MODE=true : jamais sur l'installation d'une vraie école.
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

if (existsSync(".env")) process.loadEnvFile(".env");

const { assertDemoSite, DemoRefused, demoSchoolExists, seedDemo, wipeDemo } =
  await import("../src/modules/demo/seed.ts");
const { closeDb } = await import("../src/server/db/client.ts");
const { closeJobQueue } = await import("../src/server/jobs.ts");
const { storageRoot } = await import("../src/server/storage/index.ts");

const { values } = parseArgs({
  options: {
    reset: { type: "boolean", default: false },
    nightly: { type: "boolean", default: false },
  },
});

const log = (line: string) => console.log(`[démo] ${line}`);

/** Fichiers envoyés par les visiteurs (photos, pièces) : effacés avec la base. */
async function wipeFiles() {
  const root = storageRoot();
  if (!existsSync(root)) return;
  for (const entry of await readdir(root)) {
    if (entry.startsWith(".")) continue;
    await rm(path.join(root, entry), { recursive: true, force: true });
  }
}

async function reset() {
  const started = Date.now();
  await wipeDemo();
  await wipeFiles();
  log("Données effacées");
  const summary = await seedDemo({ log });
  log(
    `Démonstration prête en ${Math.round((Date.now() - started) / 1000)} s : année ${summary.yearLabel}, ` +
      `${summary.students} élèves, ${summary.payments} paiements, ${summary.publishedBulletins} bulletins publiés`,
  );
}

async function createIfMissing() {
  if (await demoSchoolExists()) {
    log("L'école de démonstration existe déjà (remise à neuf : --reset)");
    return;
  }
  await reset();
}

/** Millisecondes jusqu'au prochain HH:MM à Brazzaville (UTC+1 toute l'année, sans heure d'été). */
function msUntil(time: string, now = new Date()): number {
  const [hours, minutes] = time.split(":").map(Number);
  const next = new Date(now);
  next.setUTCHours(hours - 1, minutes, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

try {
  assertDemoSite();
  if (values.nightly) {
    const time = process.env.DEMO_RESET_TIME || "03:30";
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
      throw new Error(`DEMO_RESET_TIME invalide : ${time}`);
    await createIfMissing();
    for (;;) {
      const wait = msUntil(time);
      log(`Prochaine remise à neuf dans ${Math.round(wait / 60_000)} min (${time}, Brazzaville)`);
      await new Promise((resolve) => setTimeout(resolve, wait));
      try {
        await reset();
      } catch (error) {
        // Le service continue : nouvel essai la nuit suivante, l'erreur reste dans le journal.
        console.error("[démo] Remise à neuf échouée :", error);
      }
    }
  } else if (values.reset) {
    await reset();
  } else {
    await createIfMissing();
  }
} catch (error) {
  if (error instanceof DemoRefused) {
    console.error(error.message);
  } else {
    console.error("[démo] Échec :", error);
  }
  process.exitCode = 1;
} finally {
  await closeJobQueue();
  await closeDb();
}
