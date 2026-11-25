// Appelé une fois au démarrage du serveur Next.js, avant la première requête.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Pendant « next build », les réglages de production ne sont pas encore là (image Docker).
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { enforceProductionEnv } = await import("./server/env");
  enforceProductionEnv("app");
}
