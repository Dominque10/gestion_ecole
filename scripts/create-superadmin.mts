// Crée (ou met à jour) un compte super-admin. Usage :
//   pnpm superadmin:create --email moi@exemple.cg --name "Mon nom"
// Le mot de passe est demandé au clavier, sans s'afficher (ni à l'écran, ni dans l'historique).
// En automatisation, il peut aussi venir de la variable d'environnement SUPERADMIN_PASSWORD.
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { hash } from "@node-rs/argon2";
import pg from "pg";
import { askHidden } from "./lib/ask-hidden.mts";

if (existsSync(".env")) process.loadEnvFile(".env");

const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" } } });
const email = values.email?.trim().toLowerCase();
const name = values.name?.trim();
const adminUrl = process.env.DATABASE_ADMIN_URL;

if (!email || !name || !adminUrl) {
  console.error('Usage : pnpm superadmin:create --email ... --name "..."');
  process.exit(1);
}

let password = process.env.SUPERADMIN_PASSWORD ?? "";
if (!password) {
  password = await askHidden("Mot de passe (12 caractères au moins) : ");
  const confirmation = await askHidden("Retapez le mot de passe : ");
  if (password !== confirmation) {
    console.error("Les deux saisies sont différentes. Rien n'a été modifié.");
    process.exit(1);
  }
}
if (password.length < 12) {
  console.error("Le mot de passe doit contenir au moins 12 caractères. Rien n'a été modifié.");
  process.exit(1);
}

const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
try {
  await client.query(
    `insert into users (name, email, is_superadmin, password_hash)
     values ($1, $2, true, $3)
     on conflict (email) do update
       set name = excluded.name, is_superadmin = true, password_hash = excluded.password_hash,
           failed_login_count = 0, locked_until = null, updated_at = now()`,
    [name, email, passwordHash],
  );
  console.log(`Super-admin prêt : ${email} (connexion sans code école).`);
} finally {
  await client.end();
}
