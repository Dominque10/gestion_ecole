/// <reference lib="webworker" />
// Service worker (3c), construit par `scripts/build-sw.mts` après `next build` (Serwist).
// - garde la page « Notes hors connexion » et ses fichiers, pour l'ouvrir sans réseau ;
// - quand une page ne peut pas se charger (pas de réseau), renvoie vers cette page ;
// - ne garde AUCUNE page de données (élèves, notes) : celles-ci restent dans IndexedDB.
import { CacheFirst, ExpirationPlugin, Serwist, type PrecacheEntry } from "serwist";

/** Liste des fichiers à garder, injectée à la construction. */
declare const __PRECACHE__: (PrecacheEntry | string)[];

const OFFLINE_PAGE = "/notes/hors-ligne";

const serwist: Serwist = new Serwist({
  precacheEntries: __PRECACHE__,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    {
      // Fichiers de l'application (noms uniques à chaque version) : gardés une fois chargés.
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({
        cacheName: "static",
        plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 30 * 24 * 60 * 60 })],
      }),
    },
    {
      // Pages : toujours le réseau ; sans réseau, la page hors connexion.
      matcher: ({ request }) => request.mode === "navigate",
      handler: async ({ request }): Promise<Response> => {
        try {
          return await fetch(request);
        } catch {
          if (new URL(request.url).pathname === OFFLINE_PAGE) {
            return (await serwist.matchPrecache(OFFLINE_PAGE)) ?? Response.error();
          }
          return Response.redirect(OFFLINE_PAGE, 302);
        }
      },
    },
  ],
});

serwist.addEventListeners();
