# Plan — Phase 1 : Fondations + M1 Paramétrage

> Statut : **proposé, à valider** avant tout code (CLAUDE.md §11).
> Jalon de sortie : tests d'isolation entre écoles au vert + critère d'acceptation M1.

## Étape 1 — Socle technique

- Next.js (App Router), TypeScript `strict`, pnpm, ESLint, Prettier, `.gitattributes` (fins de ligne).
- Tailwind CSS + shadcn/ui ; textes de l'interface dans des fichiers de traduction (français).
- `docker-compose.yml` : PostgreSQL 16 en local.
- Vitest (unitaires + intégration sur une vraie base de test), Playwright (E2E).
- CI GitHub Actions : lint, typecheck, tests avec un service PostgreSQL.

## Étape 2 — Base de données et isolation (le cœur de la phase)

- Drizzle ORM + migrations versionnées.
- Deux rôles PostgreSQL :
  - `app_owner` : applique les migrations ;
  - `app_user` : utilisé par l'application, **non propriétaire des tables**, donc soumis à la RLS
    (`FORCE ROW LEVEL SECURITY` sur chaque table métier).
- Une seule fonction d'accès : `withSchool(ctx, fn)` ouvre une transaction et fait
  `SET LOCAL app.current_school_id` et `app.current_user_id`. Aucune requête métier hors de cette fonction.
- **Test d'isolation générique** : parcourt automatiquement *toutes* les tables qui ont `school_id`
  et vérifie qu'une école A ne lit, ne modifie ni ne supprime rien de l'école B.
  Une nouvelle table sans politique RLS fait échouer le test.

## Étape 3 — Comptes, connexion, rôles

- Better Auth, sessions en base, mots de passe Argon2, verrouillage après 5 échecs, sessions expirantes.
- Connexion du personnel : téléphone ou email + mot de passe + **code école** (sous-domaine plus tard).
- `memberships.roles[]` ; super-admin = indicateur au niveau de `users`.
- **Matrice des droits en un seul fichier** (`can(roles, action)`), copiée du §3 du cahier des charges,
  appliquée côté serveur sur chaque action, avec un test par ligne du tableau.
- Accès Support (A7) : le directeur accorde 24 h en lecture seule ; tout est tracé dans `audit_logs`.
- `audit_logs` en ajout seul (ni `UPDATE` ni `DELETE` autorisés par la base).

## Étape 4 — M1 Paramétrage

| Fonction | Tables |
|---|---|
| Super-admin : créer une école (nom, code, préfixe matricule) et son premier directeur | `schools`, `users`, `memberships` |
| Fiche école : logo, adresse, téléphone, cachet, signature | `schools` + stockage de fichiers |
| Année scolaire et périodes (trimestres/semestres), une seule active, archives en lecture seule | `academic_years`, `periods` |
| Cycles, niveaux, séries, classes (effectif max, professeur principal) | `levels`, `classes` |
| Matières, coefficients par niveau/série, affectation enseignant ↔ matière ↔ classe | `subjects`, `class_subjects` |
| Créneaux simples (A8) | `time_slots` |
| Grille tarifaire par niveau et échéancier des tranches | `fee_items` |
| Assistant de démarrage qui enchaîne ces écrans | — |

Tables créées sans écran (modèle de données uniquement) : `staff`.

## Hypothèses à valider

1. **Connexion des parents par code SMS → reportée au M6.** Les parents n'ont pas de compte avant
   M2/M6 ; la Phase 1 ne gère que le personnel. Le faux prestataire SMS arrive avec le M6.
2. **Passage d'année → découpé.** M1 fait la copie de la structure (classes, matières, grille) ;
   la réinscription groupée des élèves se fait au M2, puisqu'elle a besoin des élèves.
3. **Stockage des fichiers** (logo, cachet, signature) : une interface interne, avec un stockage sur
   disque en local et compatible S3 en production.
4. **Valeurs par défaut** proposées à la création d'une école : cycles et niveaux congolais (§4),
   3 trimestres. Modifiables.

## Ce qui n'est pas dans cette phase

Élèves, paiements, notes, absences, espace parents, tableau de bord — et tout le hors-V1.
