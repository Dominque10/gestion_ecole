# CLAUDE.md — Logiciel de gestion scolaire (Congo-Brazzaville)

> Ce fichier est lu par Claude Code à chaque session. Le tenir à jour (surtout « État actuel »).
> Référence complète : le cahier des charges V1 (Claude Doc « Cahier des charges – Logiciel de gestion scolaire (Congo-Brazzaville) – Version 1 »).
> Décisions et points ouverts du cadrage : `docs/cadrage.md`.
> Hypothèses faites par défaut, à faire valider par le porteur : `docs/hypotheses.md`
> (toute nouvelle hypothèse y est ajoutée ; les rappeler au porteur à la fin de chaque phase).

## 1. Le projet en bref

Plateforme web (PWA) de gestion scolaire multi-établissement pour les écoles privées
(primaire, collège, lycée) de Brazzaville et Pointe-Noire.
Elle gère : élèves, frais de scolarité et paiements (dont Airtel Money / MTN MoMo),
notes et bulletins, absences, espace parents, tableau de bord de la direction.

Contraintes du terrain à garder en tête en permanence :
- Utilisateurs sur smartphone Android d'entrée de gamme, connexion 3G instable.
- Parents peu à l'aise avec le numérique : interface simple, en français, sans jargon.
- Données de mineurs et flux d'argent : sécurité et traçabilité non négociables.

## 2. État actuel (À METTRE À JOUR)

- Version en cours : **V1**
- Phase en cours : **Phase 4 – Parents et pilote** (M6 Espace parents + paiement mobile + notifications, M7 Tableau de bord) — plan `docs/plan-phase-4.md` validé (D20), sous-étapes 4a → 4g
- Phase 3 – Pédagogie (M4 + M5) : **terminée, jalon validé le 2026-11-23 (D19)** ; cas de référence construit accepté provisoirement, à confronter aux bulletins d'une vraie école au pilote
- Plan : `docs/plan-phase-3.md` (validé, décision D11) — sous-étapes 3a → 3g
  - Règles de calcul par défaut tranchées par le porteur (décision D10, B3) : voir le plan.
  - ✅ 3a – Règles de calcul de l'école (`src/modules/grading/`, page `/parametres/calcul`), matière facultative
    dans la grille des coefficients ; hypothèses H69 à H74 validées (D12)
  - ✅ 3b – Évaluations et saisie des notes (tables `assessments`, `grades` ; pages `/notes`) ;
    hypothèses H75 à H81 validées (D12)
  - ✅ 3c – Hors connexion : application installable, service worker, saisie sans réseau
    (`/notes/hors-ligne`), envoi automatique, conflits à trancher ; hypothèses H82 à H85 validées (D12)
  - ✅ 3d – Moyennes, rangs, mentions, moyenne annuelle (`averages.ts`), clôture des périodes par classe
    (`period_closures`, décision D13), page `/notes/resultats` ; hypothèses H86 à H90 validées (D14).
    **Cas de référence réels du porteur toujours attendus** (critère du jalon) : un cas construit les remplace.
  - ✅ 3e – Appel (`/appel`, aussi hors connexion), SMS d'absence (décision D15, faux prestataire), justification
    (`/absences`) ; hypothèses H91 à H96 validées (D16). Appel de 60 élèves vérifié en E2E (bien sous la minute).
  - ✅ 3f – Conseil de classe (`council.ts`, table `report_cards`) : appréciations par matière et générale,
    mention, décision de fin d'année, totaux d'absences ; validation après clôture ; hypothèses H97 à H101 validées (D17)
  - ✅ 3g – Bulletins PDF (`bulletins.ts`, gabarit `bulletin-template.ts`) : projet, publication avec photographie,
    bulletin annuel ; 50 bulletins en < 1 s (critère : 30 s) ; hypothèses H102 à H106 validées (D18)
- Module en cours : **M6 + M7** (rien de codé)
- Dernier jalon validé : **Phase 3** (M4 + M5), validée le 2026-11-23 (D19). Avant : **Phase 2** (M2 + M3), validée le 2026-11-21 (décision D9) : import de
  1 000 élèves en ~20 s, clôture de caisse = somme des reçus ; hypothèses H38 à H68 validées (D8).
  Plan réalisé : `docs/plan-phase-2.md` (2a → 2g). Phase 1 validée le 2026-11-21 (D5, H1 à H37).
- **Pas d'école pilote pour l'instant (D1)** : les règles qui dépendaient des écoles sont des hypothèses
  par défaut, paramétrables, à revoir dès qu'une école sera contactée. Paiement et SMS : faux prestataire
  de test derrière l'interface interne. Toujours signaler quand un choix est une hypothèse.
- Fait en phase 0 : dépôt Git initialisé, CLAUDE.md, BACKLOG.md, `docs/cadrage.md` ;
  décisions A1 à A8 prises (voir `docs/cadrage.md` §C).
- Plan de la Phase 1 : `docs/plan-phase-1.md` (validé).
  - ✅ Étape 1 – Socle technique (Next.js 16.4, Vitest, Playwright, Prettier, CI, Docker Compose)
  - ✅ Étape 2 – Base de données et isolation (RLS) : 4 tables plateforme, garde-fou générique au vert
  - ✅ Étape 3 – Comptes, connexion, rôles (module maison D2, tableau des droits, accès Support)
  - ✅ Étape 4 – M1 Paramétrage (6 sous-étapes 4a→4f, décisions D3 et D4)
    - ✅ 4a – Création d'école par le super-admin, comptes du personnel, mot de passe provisoire
    - ✅ 4b – Fiche école + stockage de fichiers (`src/server/storage/`, disque local, `STORAGE_DIR`)
    - ✅ 4c – Années scolaires et périodes (en préparation → active → archivée, garde-fous en base)
    - ✅ 4d – Niveaux, matières, grille des coefficients (niveau + série, D4), classes, affectations
    - ✅ 4e – Créneaux simples et grille tarifaire (frais par niveau, tranches en FCFA entiers)
    - ✅ 4f – Copie de structure d'une année à l'autre + assistant de démarrage
- Next.js 16.4 : lire `node_modules/next/dist/docs/` avant d'utiliser une API (voir `AGENTS.md`).
  `middleware` s'appelle `proxy`, API de requête asynchrones, `cacheComponents` activé.

## 3. Règles de périmètre — à respecter strictement

1. **Ne développer que le périmètre V1** (liste au §4). Rien d'autre.
2. Toute idée, amélioration ou fonction hors V1 → l'ajouter dans `BACKLOG.md`, **ne pas la coder**.
3. Suivre l'ordre des modules M1 → M7. Ne pas commencer un module tant que le précédent
   ne passe pas son critère d'acceptation (tests au vert).
   **Exception (décision A3)** : M2 et M3 sont développés ensemble en phase 2.
4. Préparer l'avenir **uniquement dans le modèle de données**, jamais avec des écrans,
   routes ou fonctions anticipés.
5. En cas de doute sur le périmètre ou une règle métier : **demander**, ne pas inventer.

## 4. Périmètre V1 et ordre de développement

| Phase | Contenu | Jalon de sortie |
|---|---|---|
| 0 – Cadrage | Correction du cahier des charges, décisions de cadrage (`docs/cadrage.md`) | Cahier des charges validé par le porteur ✅ |
| 1 – Fondations | Auth, rôles, multi-établissement (RLS), CI, tests ; **M1 Paramétrage** | Tests d'isolation entre écoles au vert |
| 2 – Élèves et caisse | **M2 Inscriptions/fiches élèves**, **M3 Frais, paiements, reçus, impayés** | Clôture de caisse = somme des reçus |
| 3 – Pédagogie | **M4 Notes et bulletins**, **M5 Absences** | Moyennes = cas de référence préparés par le porteur |
| 4 – Parents et pilote | **M6 Espace parents + paiement mobile + notifications**, **M7 Tableau de bord** | Bilan pilote positif (dès qu'une école est disponible) |

Hors V1 (ne pas coder) : emploi du temps, cahier de textes, paie/RH, comptabilité,
LMD/universités, cantine, transport, bibliothèque, application mobile native.

## 5. Stack technique

- **TypeScript** partout (mode `strict`).
- **Next.js** (App Router) : interface + API (Route Handlers, Server Actions). API REST versionnée sous `/api/v1`.
- **PostgreSQL 16** + **Drizzle ORM** (migrations versionnées, jamais de modification manuelle du schéma en prod).
- **Zod** pour toute validation (formulaires, API, worker) — schémas partagés.
- **Authentification : module maison** (décision D2, `src/server/auth/`) : Argon2id, sessions en base ; parents : téléphone + OTP SMS (M6).
- **Tailwind CSS + shadcn/ui**.
- **PWA** : Serwist (service worker) + Dexie (IndexedDB) pour le hors-ligne.
- **Worker Node + pg-boss** pour les tâches de fond (SMS, webhooks paiement, PDF).
- **PDF** : HTML → PDF avec Playwright, dans le worker.
- Tests : **Vitest** (unitaires/intégration), **Playwright** (E2E). CI : GitHub Actions.
- Déploiement : Docker Compose (app, worker, PostgreSQL, sauvegardes).

## 6. Règles d'architecture — obligatoires

### Multi-établissement
- Toute table métier a une colonne `school_id` (sauf `schools`, `users`).
- **Row-Level Security PostgreSQL activée sur toutes ces tables.**
- Chaque transaction commence par `SET LOCAL app.current_school_id = '<id>'`.
- Ne jamais filtrer par école « à la main » comme seule protection : la RLS est le garde-fou.
- Chaque nouvelle table métier = politique RLS + test prouvant qu'une école ne voit pas les données d'une autre.
- **Mise en œuvre (étape 2) :**
  - Toute donnée d'école passe par `withSchool({ schoolId, userId }, tx => …)` (`src/server/db/client.ts`).
    Les actions de plateforme du super-admin passent par `withPlatform` (aucun accès aux données métier).
  - L'application se connecte avec le rôle `app_user` (ni superutilisateur, ni BYPASSRLS, propriétaire
    d'aucune table) ; les migrations avec `DATABASE_ADMIN_URL`.
  - Les politiques RLS s'écrivent dans une migration SQL personnalisée (`pnpm db:generate --custom --name=…`),
    en utilisant `app.current_school_id()`.
  - Le test `tests/integration/rls.test.ts` échoue si une table a `school_id` sans RLS forcée, ou n'a pas
    `school_id` sans figurer dans `TABLES_WITHOUT_SCHOOL_ID`. Toute exception y est justifiée par un commentaire.
  - Tests d'intégration sur une base séparée `<base>_test`, E2E sur `<base>_e2e`, jamais sur la base de développement.
  - Seule table avec `school_id` exemptée de RLS : `sessions` (liste `TABLES_EXEMPT_FROM_RLS`, justifiée).
  - Année archivée = lecture seule, garantie par la base : toute future table avec `academic_year_id`
    reçoit le déclencheur `app.forbid_write_in_archived_year()` (voir migration `0006_academic_years_rls`).

### Argent
- Montants en **entiers FCFA (XAF)**, jamais de `float`/`decimal` côté JS.
- Paiements **immuables** : jamais de `UPDATE`/`DELETE` ; une annulation = écriture inverse
  (`annule_id`), motif obligatoire, validée par le directeur.
- Toute opération financière dans une **transaction**.
- Webhooks de paiement **idempotents** (clé unique = référence de transaction opérateur) et **signature vérifiée**.
- Numérotation des reçus continue, sans trou, par école.

- **Mise en œuvre (2d)** : `payments` et `payment_allocations` en ajout seul (droits retirés + déclencheur) ;
  annulation = ligne `reversal` de montant opposé (`reverses_id`), après décision du directeur sur une
  `payment_cancellations`. Reçu `PREFIXE-AAAA-NNNNN` : compteur `academic_years.last_receipt_number`
  verrouillé dans la transaction du paiement. Reste dû d'une échéance = montant − remise − répartitions.

### Droits
- Contrôle des droits **côté serveur sur chaque action**, jamais seulement dans l'UI.
- **Mise en œuvre (étape 3) :**
  - Tableau des droits unique : `src/server/auth/permissions.ts` (`can`, `authorize`), testé ligne par ligne.
    Toute nouvelle action y est ajoutée ET dans le tableau de référence de `permissions.test.ts`.
  - Pages et actions serveur : `requireAction(action)` (`src/server/auth/session.ts`) ; la lecture de session
    se fait sous un `<Suspense>` (Next 16 + cacheComponents).
  - Hypothèses : verrouillage 15 min après 5 échecs ; session de 12 h. Rôles relus à chaque requête.
  - Message de connexion identique pour compte inconnu / mauvais mot de passe / autre école.
  - Mot de passe oublié (D5) : le directeur remet un mot de passe provisoire si le compte n'est dans
    aucune autre école (`app.user_in_other_school`) ; sinon `pnpm password:reset --identifier ...`.
  - Premier super-admin : `pnpm superadmin:create --email ... --name "..."` (mot de passe demandé au clavier, masqué ; relancer la commande change le mot de passe).
  - Comptes créés par le super-admin ou le directeur : mot de passe provisoire, à changer à la première
    connexion (`users.must_change_password`, page `/mot-de-passe`). Un compte existant (autre école) garde
    son mot de passe (hypothèse). L'école garde toujours au moins un directeur.
  - Code du domaine : `src/modules/<module>/` ; refus métier = `SettingsError` (texte i18n `settings.errors.*`).
- Rôles : super-admin, directeur, secrétaire/surveillant, comptable/caissier, enseignant, parent.
  Un utilisateur peut cumuler plusieurs rôles (`memberships.roles[]`).
- Un parent ne voit que ses enfants ; un enseignant que ses classes/matières.
- **Données médicales** (décision A4) : table séparée `student_medical`, RLS réservée à la direction
  (lecture et écriture). Le secrétariat modifie la fiche élève sans jamais voir ces données.
  Mise en œuvre : politique RLS avec `app.current_user_has_role('director')` (migration `0013`).
- Élèves : un enseignant ne voit que les élèves de ses classes (`teacherStudentsFilter`, appliqué via
  `readContext` dans toute lecture d'élève). Matricule : compteur `schools.last_matricule_number`, verrouillé à chaque création.
- **Parent multi-écoles** (décision A2) : un seul compte parent, une `membership` « parent » par école.
  Une unique fonction SQL dédiée (testée) liste ses enfants toutes écoles confondues, en ne renvoyant
  que nom, classe et école. Choisir un enfant bascule la session sur l'école de l'enfant ; ensuite tout
  passe par la RLS, avec une politique qui limite le parent à ses propres enfants.
- **Super-admin / Support** (décision A7, remplace A5) : aucun accès permanent aux données d'une école.
  Accès en **lecture seule**, uniquement après **autorisation du directeur**, pour 24 h par défaut
  (`membership` avec rôle `support`, date d'expiration, directeur qui l'a accordée). Chaque ouverture
  et chaque consultation tracées dans `audit_logs`. Agir à la place d'un utilisateur : V2, ne pas coder.

### Notes et bulletins
- **Mise en œuvre (3a)** : règles de calcul dans `schools.grading_rules` (jsonb, null = défaut), toujours lues via
  `readGradingRules` / `loadGradingRules` (`src/modules/grading/`), validées par `GradingRulesSchema`.
  Matière facultative : `level_subjects.optional`.
- **Mise en œuvre (3b)** : `src/modules/grading/assessments.ts`. Une évaluation pointe vers une ligne de
  `class_subjects` (clé étrangère) ; un enseignant n'y accède que si `class_subjects.teacher_id` est le sien,
  le directeur partout (action `assessments:manage` + `grades:write`). Note : `numeric(5,2)` sur le barème de
  l'évaluation, statut `scored` / `absent` / `excused` ; déclencheur `app.check_grade_within_scale` (GS007).
  Saisie : `parseGradeInput` (pur, partagé avec la grille client) ; `saveGrades` reçoit pour chaque case la
  valeur d'origine et ne remplace jamais une note changée entre-temps (conflit rendu). L'identifiant d'une
  évaluation peut venir du client (création idempotente, prépare 3c).
- **Mise en œuvre (3d)** : calculs purs dans `src/modules/grading/averages.ts` (tests : `averages.test.ts`, dont
  un cas de référence construit) ; lecture et droits dans `results.ts` (résultats : directeur + professeur
  principal). Règles D13 ajoutées aux réglages (`generalAverageBase`, `missingPart`, `emptySubject`).
  Clôture par classe : `period_closures` (une ligne par période + classe, jamais supprimée) ; déclencheurs
  `app.forbid_*_in_closed_period` (GS008) ; après réouverture, chaque changement de note ou d'évaluation
  est écrit dans `audit_logs` (`grade.change_after_close`, `assessment.update_after_close`).
- **Mise en œuvre (3f)** : `src/modules/grading/council.ts` ; `report_cards` = une fiche par élève et période, plus une
  annuelle (`kind`). Appréciations de matière dans `subject_comments` (jsonb, une clé par matière, mise à jour
  atomique `jsonb_set`). Validation (`reportcards:council`) seulement après clôture ; mention vide = proposée.
  Totaux d'absences : `src/modules/attendance/totals.ts` (en créneaux).
- **Mise en œuvre (3g)** : `src/modules/grading/bulletins.ts` construit les bulletins (`build`) ; `publishBulletins`
  (`reportcards:publish`, conseil validé) écrit `report_cards.snapshot` + `published_at` (contrainte en base) ;
  `getBulletins` rend les photographies si tout est publié, sinon un projet. Rouvrir le conseil retire la
  publication. PDF : document `bulletins` (worker), gabarit `src/modules/documents/bulletin-template.ts`.

### Appel et SMS
- **Mise en œuvre (3e)** : `src/modules/attendance/` ; `attendance` garde une ligne par élève, jour et créneau
  (présents compris : on sait que l'appel est fait). Même règle de conflit que les notes. Hors connexion : tables
  Dexie `rollClasses`, `rollCalls`, `marks` (version 2), envoyées par `syncPending` (étape 3).
- SMS : interface `src/server/sms/` (`SMS_PROVIDER`, faux prestataire par défaut) ; file pg-boss `notifications`
  (politique « short », clé `inscription:jour`, départ 30 min après l'appel) ; tâche `processAbsenceNotice` dans le
  worker ; `notifications` unique par élève, type et jour (un SMS par jour).

### Tâches de fond et documents
- **Mise en œuvre (2f)** : file pg-boss (schéma `pgboss`, installée par `pnpm db:setup` via `setupJobQueue`,
  droits d'usage seulement pour `app_user`). Worker : `pnpm worker` (rôle `app_user`, soumis à la RLS).
- Documents : l'application vérifie les droits et dépose la tâche (`requestDocument`) ; le worker relit
  les rôles en base, produit le HTML (`src/modules/documents/*-template.ts`, textes échappés) puis le PDF
  (Chromium). Le PDF reste 1 h dans le résultat de la tâche, récupérable par le seul demandeur.
- QR code des reçus : lien signé avec `AUTH_SECRET` → page publique `/verifier/<jeton>`, fonction SQL
  `app.verify_receipt` (aucune donnée d'élève).

### Hors-ligne
- Saisie des notes et de l'appel possible hors ligne (file locale IndexedDB, synchro au retour du réseau).
- UUID générés **côté client** pour les saisies hors ligne (pas de doublons à la synchro).
- Conflits signalés à l'utilisateur, **jamais écrasés en silence**.
- **Mise en œuvre (3c)** :
  - Base du téléphone : Dexie (`src/lib/offline/db.ts`), tout rangé par propriétaire `<école>:<compte>`.
    Copies du serveur (`courses`, `sheets`) ; saisies en attente (`assessments` créées sur le téléphone,
    `cells` avec valeur d'origine `expected`). Logique pure et testée : `store.ts`, `sync.ts` (fake-indexeddb).
  - Envoi : `syncPending` avec les actions `src/app/notes/sync-actions.ts` (jamais de redirection ; session
    expirée = code `session`). Toute saisie en ligne passe aussi par cette file (`GradeGrid`).
  - Service worker : `src/sw/sw.ts` (Serwist), construit par `scripts/build-sw.mts` à la fin de `pnpm build`,
    servi par la route `/sw.js`. Il ne garde que la page statique `/notes/hors-ligne` et les fichiers
    `/_next/static` ; aucune page de données. Sans réseau, toute page renvoie vers `/notes/hors-ligne`.
    L'adaptateur `@serwist/turbopack` n'est pas utilisé (incompatible avec `cacheComponents`).
  - Pas de `Map.groupBy` ni d'API récente côté client : téléphones Android anciens.

### Traçabilité
- `audit_logs` pour : paiements, annulations, modifications de notes après verrouillage, changements de droits.

### Divers
- Dates en UTC en base, affichées en `Africa/Brazzaville`.
- Textes de l'interface externalisés (i18n), langue par défaut : français.
- Pages légères : viser < 300 Ko pour la première page de l'espace parent ; compresser les images côté client.

## 7. Règles métier du système scolaire congolais

- Cycles : préscolaire ; primaire (CP1, CP2, CE1, CE2, CM1, CM2 → CEPE) ;
  collège (6e à 3e → BEPC) ; lycée (2nde, 1re, Tle, séries A, C, D… → Bac).
- Notes sur 20 (collège/lycée) ; barème paramétrable au primaire.
- Année en trimestres (3 par défaut), semestres possibles.
- Types d'évaluation pondérés par période (interrogations, devoirs, compositions).
- Coefficients par matière, par niveau et par série.
- Bulletin : moyenne par matière, moyenne générale pondérée, rang, moyenne de classe,
  plus forte/plus faible moyenne, appréciations, mention, décision du conseil de classe.
- **Tout ce qui est règle de calcul doit être paramétrable par école** et couvert par des tests
  avec des cas réels fournis par les écoles pilotes.
- Points encore ouverts (arrondis, rang ex æquo, matières facultatives) : **demander avant d'implémenter**.

## 8. Modèle de données (tables principales)

`schools`, `users`, `memberships`, `academic_years`, `periods`, `levels`, `classes`, `subjects`,
`class_subjects`, `level_subjects`, `time_slots`, `staff`, `students`, `student_medical`, `guardians`,
`student_guardians`, `enrollments`, `fee_items`, `invoices` (échéances), `payments`,
`payment_allocations`, `assessments`, `grades`, `report_cards`, `attendance`,
`notifications`, `audit_logs`, `student_documents`, `cash_closures`, `payment_cancellations`,
`period_closures` (31 tables, décisions D6, D7, D13).

- Matricule (décision A6) : `CODE-AA-NNNNN` (ex. `SJB-26-00042`), préfixe stocké dans `schools`,
  numéro d'ordre continu par école, attribué une fois, jamais modifié ni réutilisé.
- `enrollments` porte un « mode de validation » (manuel / paiement) — décision A3.
- `level_subjects` (décision D4) : grille des coefficients par année, niveau, série et matière ; les
  classes d'un même niveau + série partagent la grille. `class_subjects` porte l'enseignant affecté.

- `time_slots` (décisions A1, A8) : créneaux simples définis par chaque école (libellé, heure de début,
  heure de fin), saisis dans un petit écran du M1, utilisés par l'appel en M5.
  **Pas un emploi du temps** (ni classe-matière, ni jour, ni salle — hors V1).
- `attendance` : `time_slot_id` + `class_subject_id` facultatif (appel par cours).
- `staff` (décision A1) : table minimale (nom, fonction, `user_id` facultatif), **aucun écran en V1** ;
  prépare la paie/RH de la V2.

`enrollments` (inscription d'un élève dans une classe pour une année) est le **pivot** :
notes, absences, échéances et bulletins s'y rattachent.

## 9. Conventions de code

- Code et noms de variables/tables en **anglais** ; interface et messages utilisateur en **français**.
- Structure par domaine : `src/modules/<module>/` (schéma, actions serveur, composants, tests).
- Pas de logique métier dans les composants React : la mettre dans des fonctions serveur testables.
- Une fonction de calcul (moyennes, échéances, allocations de paiement) = des tests unitaires.
- Commits courts et explicites, en français ou en anglais, un sujet par commit.
- Ne jamais committer de secrets ; utiliser `.env` (dans `.gitignore`) et un `.env.example`.

## 10. Commandes (à adapter quand le projet est initialisé)

```bash
pnpm install          # dépendances
pnpm dev              # serveur de développement (sans service worker)
pnpm build            # build de production + service worker (hors connexion : tester avec pnpm start)
pnpm worker           # worker des tâches de fond (documents PDF) — à lancer avec pnpm dev
node --import tsx scripts/sample-documents.mts <dossier>  # exemples de PDF pour vérifier le rendu
pnpm test             # tests unitaires et d'intégration
pnpm test:e2e         # tests Playwright
pnpm lint             # types générés Next + ESLint + typecheck
pnpm format           # Prettier (les fichiers .md sont exclus)
docker compose up -d  # PostgreSQL 16 local (port 5434)
pnpm db:generate      # générer une migration Drizzle
pnpm db:migrate       # appliquer les migrations
```

## 11. Façon de travailler attendue de Claude Code

- Avant de coder un module : relire le §3, le §4 et la section du module dans le cahier des charges,
  puis proposer un plan court (fichiers, tables, tests) et attendre validation.
- Livrer chaque module **avec ses tests** et vérifier que `pnpm lint` et `pnpm test` passent.
- Signaler toute hypothèse faite sur une règle métier, et l'ajouter dans `docs/hypotheses.md`.
- À la fin d'un module : proposer la mise à jour de la section « État actuel » de ce fichier.
