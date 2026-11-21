// Remet un mot de passe provisoire à un compte (décision D5, H9), pour les cas que le directeur ne
// peut pas traiter : compte partagé entre plusieurs écoles. Usage :
//   pnpm password:reset --identifier "06 123 45 67"      (ou un email)
// Le mot de passe est demandé au clavier, masqué. La personne devra le changer à la connexion.
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { hash } from "@node-rs/argon2";
import pg from "pg";
import { askHidden } from "./lib/ask-hidden.mts";
import { parseIdentifier } from "../src/server/auth/phone.ts";

if (existsSync(".env")) process.loadEnvFile(".env");

const { values } = parseArgs({ options: { identifier: { type: "string" } } });
const identifier = parseIdentifier(values.identifier ?? "");
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!identifier || !adminUrl) {
  console.error('Usage : pnpm password:reset --identifier "06 123 45 67" (ou un email)');
  process.exit(1);
}

const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
try {
  const column = identifier.kind === "email" ? "email" : "phone";
  const { rows } = await client.query<{ id: string; name: string; is_superadmin: boolean }>(
    `select id, name, is_superadmin from users where ${column} = $1`,
    [identifier.value],
  );
  const user = rows[0];
  if (!user) {
    console.error("Aucun compte avec cet identifiant. Rien n'a été modifié.");
    process.exit(1);
  }
  if (user.is_superadmin) {
    console.error(
      "Compte de la plateforme : utilisez « pnpm superadmin:create ». Rien n'a été modifié.",
    );
    process.exit(1);
  }
  console.log(`Compte trouvé : ${user.name}`);
  const password =
    process.env.TEMP_PASSWORD ??
    (await askHidden("Mot de passe provisoire (8 caractères au moins) : "));
  if (password.length < 8) {
    console.error("Le mot de passe doit contenir au moins 8 caractères. Rien n'a été modifié.");
    process.exit(1);
  }
  const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  await client.query("begin");
  await client.query(
    `update users set password_hash = $2, must_change_password = true, failed_login_count = 0,
       locked_until = null, updated_at = now() where id = $1`,
    [user.id, passwordHash],
  );
  await client.query("delete from sessions where user_id = $1", [user.id]);
  // Action de plateforme : journal sans école (comme la création d'une école).
  await client.query(
    `insert into audit_logs (school_id, actor_user_id, action, entity_type, entity_id)
     values (null, null, 'platform.password_reset', 'user', $1)`,
    [user.id],
  );
  await client.query("commit");
  console.log(
    `Mot de passe provisoire enregistré pour ${user.name}. À changer à la prochaine connexion.`,
  );
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
