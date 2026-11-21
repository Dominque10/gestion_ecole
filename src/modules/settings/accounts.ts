import { eq } from "drizzle-orm";
import type { Tx } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { hashPassword } from "@/server/auth/password";
import { SettingsError } from "./errors";

type Identifier = { kind: "email" | "phone"; value: string };

/**
 * Retrouve le compte de cette personne (téléphone ou email) ou le crée avec un mot de passe provisoire.
 * Un compte existant est commun à toute la plateforme (ex. un enseignant dans deux écoles) :
 * il garde son nom et son mot de passe actuels. Hypothèse, à revoir avec les écoles.
 * Un compte de la plateforme (super-admin) ne reçoit jamais de rôle dans une école par ce chemin.
 */
export async function findOrCreateAccount(
  tx: Tx,
  person: { name: string; identifier: Identifier; password: string },
): Promise<{ userId: string; existingAccount: boolean }> {
  const column = person.identifier.kind === "email" ? users.email : users.phone;
  const [existing] = await tx
    .select({ id: users.id, isSuperadmin: users.isSuperadmin })
    .from(users)
    .where(eq(column, person.identifier.value));
  if (existing) {
    if (existing.isSuperadmin) throw new SettingsError("platformAccount");
    return { userId: existing.id, existingAccount: true };
  }
  const [created] = await tx
    .insert(users)
    .values({
      name: person.name,
      [person.identifier.kind]: person.identifier.value,
      passwordHash: await hashPassword(person.password),
      mustChangePassword: true,
    })
    .returning({ id: users.id });
  return { userId: created.id, existingAccount: false };
}
