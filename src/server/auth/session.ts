import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { validateSession, type SessionInfo } from "./core";
import { authorize, type Action } from "./permissions";
import { recordSupportRead } from "./support";

export const SESSION_COOKIE = "gs_session";

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Session de la requête en cours (lue une seule fois par requête). À appeler sous un <Suspense>. */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const token = await readSessionToken();
  // La validité dépend de l'heure courante : rendu à la requête, jamais pré-rendu.
  await connection();
  return validateSession(token);
});

/** Exige une session ; sinon renvoie vers la page de connexion. */
export async function requireSession(): Promise<SessionInfo> {
  const session = await getSession();
  if (!session) redirect("/connexion");
  return session;
}

/**
 * Exige une session ET le droit d'effectuer l'action (contrôle côté serveur).
 * En accès Support, la consultation est enregistrée dans le journal d'audit.
 */
export async function requireAction(action: Action, resource = action): Promise<SessionInfo> {
  const session = await requireSession();
  authorize(session.principal, action);
  await recordSupportRead(session.principal, resource);
  return session;
}
