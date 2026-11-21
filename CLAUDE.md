# CLAUDE.md — Logiciel de gestion scolaire (Congo-Brazzaville)

> Ce fichier est lu par Claude Code à chaque session. Le tenir à jour (surtout « État actuel »).
> Référence complète : le cahier des charges V1 (Claude Doc « Cahier des charges – Logiciel de gestion scolaire (Congo-Brazzaville) – Version 1 »).
> Décisions et points ouverts du cadrage : `docs/cadrage.md`.

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
- Phase en cours : **Phase 0 – Cadrage** (voir §4)
- Module en cours : **aucun** (prochain : fondations puis M1)
- Dernier jalon validé : —
- Fait en phase 0 : dépôt Git initialisé, CLAUDE.md, BACKLOG.md, `docs/cadrage.md` ;
  décisions A1 à A6 prises (voir `docs/cadrage.md` §C). Écarts A7 et A8 avec le Claude Doc à trancher.
  Aucun code applicatif pour l'instant.

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
| 0 – Cadrage | Validation avec écoles pilotes, choix agrégateur paiement + SMS, maquettes | Cahier des charges validé |
| 1 – Fondations | Auth, rôles, multi-établissement (RLS), CI, tests ; **M1 Paramétrage** | Tests d'isolation entre écoles au vert |
| 2 – Élèves et caisse | **M2 Inscriptions/fiches élèves**, **M3 Frais, paiements, reçus, impayés** | Clôture de caisse = somme des reçus |
| 3 – Pédagogie | **M4 Notes et bulletins**, **M5 Absences** | Moyennes = calcul de référence d'une école |
| 4 – Parents et pilote | **M6 Espace parents + paiement mobile + notifications**, **M7 Tableau de bord** | Bilan pilote positif |

Hors V1 (ne pas coder) : emploi du temps, cahier de textes, paie/RH, comptabilité,
LMD/universités, cantine, transport, bibliothèque, application mobile native.

## 5. Stack technique

- **TypeScript** partout (mode `strict`).
- **Next.js** (App Router) : interface + API (Route Handlers, Server Actions). API REST versionnée sous `/api/v1`.
- **PostgreSQL 16** + **Drizzle ORM** (migrations versionnées, jamais de modification manuelle du schéma en prod).
- **Zod** pour toute validation (formulaires, API, worker) — schémas partagés.
- **Better Auth** (ou Auth.js), sessions en base ; parents : téléphone + OTP SMS.
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

### Argent
- Montants en **entiers FCFA (XAF)**, jamais de `float`/`decimal` côté JS.
- Paiements **immuables** : jamais de `UPDATE`/`DELETE` ; une annulation = écriture inverse
  (`annule_id`), motif obligatoire, validée par le directeur.
- Toute opération financière dans une **transaction**.
- Webhooks de paiement **idempotents** (clé unique = référence de transaction opérateur) et **signature vérifiée**.
- Numérotation des reçus continue, sans trou, par école.

### Droits
- Contrôle des droits **côté serveur sur chaque action**, jamais seulement dans l'UI.
- Rôles : super-admin, directeur, secrétaire/surveillant, comptable/caissier, enseignant, parent.
  Un utilisateur peut cumuler plusieurs rôles (`memberships.roles[]`).
- Un parent ne voit que ses enfants ; un enseignant que ses classes/matières.
- **Données médicales** (décision A4) : table séparée `student_medical`, RLS réservée à la direction
  (lecture et écriture). Le secrétariat modifie la fiche élève sans jamais voir ces données.
- **Parent multi-écoles** (décision A2) : un seul compte parent, une `membership` « parent » par école.
  Une unique fonction SQL dédiée (testée) liste ses enfants toutes écoles confondues, en ne renvoyant
  que nom, classe et école. Choisir un enfant bascule la session sur l'école de l'enfant ; ensuite tout
  passe par la RLS, avec une politique qui limite le parent à ses propres enfants.
- **Super-admin** (décision A5) : aucun accès permanent aux données d'une école. Accès uniquement via
  une session de support (école, motif obligatoire, expiration 1 h), limitée au paramétrage et aux
  fiches élèves ; jamais paiements, notes ni bulletins. Ouverture et actions tracées dans `audit_logs`.

### Hors-ligne
- Saisie des notes et de l'appel possible hors ligne (file locale IndexedDB, synchro au retour du réseau).
- UUID générés **côté client** pour les saisies hors ligne (pas de doublons à la synchro).
- Conflits signalés à l'utilisateur, **jamais écrasés en silence**.

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
`class_subjects`, `time_slots`, `staff`, `students`, `student_medical`, `guardians`,
`student_guardians`, `enrollments`, `fee_items`, `invoices` (échéances), `payments`,
`payment_allocations`, `assessments`, `grades`, `report_cards`, `attendance`,
`notifications`, `audit_logs` (26 tables).

- Matricule (décision A6) : `CODE-AA-NNNNN` (ex. `SJB-26-00042`), préfixe stocké dans `schools`,
  numéro d'ordre continu par école, attribué une fois, jamais modifié ni réutilisé.
- `enrollments` porte un « mode de validation » (manuel / paiement) — décision A3.

- `time_slots` (décision A1) : créneaux nommés définis par chaque école (demi-journées ou heures),
  utilisés par l'appel en M5. **Pas un emploi du temps** (hors V1).
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
pnpm dev              # serveur de développement
pnpm worker           # worker des tâches de fond
pnpm test             # tests unitaires et d'intégration
pnpm test:e2e         # tests Playwright
pnpm lint             # ESLint + typecheck
pnpm db:generate      # générer une migration Drizzle
pnpm db:migrate       # appliquer les migrations
```

## 11. Façon de travailler attendue de Claude Code

- Avant de coder un module : relire le §3, le §4 et la section du module dans le cahier des charges,
  puis proposer un plan court (fichiers, tables, tests) et attendre validation.
- Livrer chaque module **avec ses tests** et vérifier que `pnpm lint` et `pnpm test` passent.
- Signaler toute hypothèse faite sur une règle métier.
- À la fin d'un module : proposer la mise à jour de la section « État actuel » de ce fichier.
