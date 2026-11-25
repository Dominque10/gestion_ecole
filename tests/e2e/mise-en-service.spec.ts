// Mise en service, sous-étape Sb — route de santé, en-têtes de sécurité, bandeau de démonstration.
import { expect, test } from "@playwright/test";

test("la route de santé répond « ok » quand la base, la file et le worker tournent", async ({
  request,
}) => {
  // Le worker signale son passage au démarrage, puis toutes les 30 s.
  await expect
    .poll(async () => (await request.get("/api/v1/health")).status(), { timeout: 30_000 })
    .toBe(200);
  const response = await request.get("/api/v1/health");
  expect(await response.json()).toEqual({
    status: "ok",
    checks: { database: "ok", queue: "ok", worker: "ok" },
  });
  expect(response.headers()["cache-control"]).toContain("no-store");
});

test("chaque page porte les en-têtes de sécurité et le bandeau de démonstration", async ({
  page,
}) => {
  const response = await page.goto("/connexion");
  const headers = response!.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["strict-transport-security"]).toContain("max-age=31536000");
  expect(headers["x-powered-by"]).toBeUndefined();
  await expect(page.getByText("Démonstration : aucun paiement ni message")).toBeVisible();
});
