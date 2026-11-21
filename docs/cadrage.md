# Cadrage — décisions et points ouverts (Phase 0)

> Chaque point doit être tranché avant le code du module concerné.
> Une fois décidé : noter la décision, la date et qui l'a prise, puis répercuter dans CLAUDE.md
> et le cahier des charges si besoin.

## A. Incohérences relevées dans le cahier des charges

| # | Point | Bloque | Décision |
|---|---|---|---|
| A1 | §2 dit que le modèle prévoit les entités **Personnel** et **Créneau**, absentes du §8 et du CLAUDE.md. Le §8 annonce « vingt entités » mais en liste 23. | Phase 1 (schéma) | **Décidé** (voir C) |
| A2 | **Parent lié à des enfants de plusieurs écoles** (M2) vs RLS par école de session : comment l'espace parent regroupe-t-il les enfants sans contourner la RLS ? | Phase 1 (auth/RLS), M6 | **Décidé** (voir C) |
| A3 | **M2 dépend de M3** : « inscription validée = frais d'inscription payés » suppose que les paiements existent. Validation manuelle provisoire dans M2, ou M2 et M3 livrés ensemble ? | M2 | _à décider_ |
| A4 | **Données médicales** réservées à la direction, alors que le secrétariat modifie les fiches élèves : il faut un droit au niveau du champ. | M2 | _à décider_ |
| A5 | **Rôle « Support » du super-admin** non défini (lecture seule ? agir à la place d'un directeur ?). Doit être tracé dans `audit_logs`. | Phase 1 (rôles) | **Décidé** (voir C) |
| A6 | **Format du matricule** élève non précisé (préfixe école, année, séquence…). | M2 | _à décider_ |

## B. Points ouverts du cahier des charges (§12)

| # | Point | Bloque | Décision |
|---|---|---|---|
| B1 | Nom du produit et nom de domaine (.cg ou autre) | Mise en ligne | _à décider_ |
| B2 | Modèle de bulletin exact de chaque école pilote | M4 | _à décider_ |
| B3 | Règles de calcul : arrondis, matières facultatives, compositions vs interrogations, rang ex æquo | M4 | _à décider_ |
| B4 | Agrégateur de paiement retenu, frais, délai du compte marchand | M3 / M6 | _à décider_ |
| B5 | Prestataire SMS local et coût ; accès API WhatsApp Business | Phase 1 (OTP), M5, M6 | _à décider_ |
| B6 | Hébergement : à l'étranger ou au Congo (loi données personnelles, latence) | Déploiement | _à décider_ |
| B7 | Blocage du bulletin en cas d'impayé : autorisé et souhaité ? | M3 / M4 | _à décider_ |
| B8 | Prix de l'abonnement (après entretiens avec au moins 10 directeurs) | Commercialisation | _à décider_ |

## C. Décisions prises

| Date | Décision | Par |
|---|---|---|
| 2026-11-21 | Dépôt du projet : `J:\projets\gestion-scolaire` (nom de dossier provisoire en attendant B1) | Porteur du projet |
| 2026-11-21 | **A1** — Ajout de `time_slots` (créneaux nommés définis par chaque école : demi-journées ou heures ; utilisés par l'appel en M5 ; ce n'est pas un emploi du temps) et de `staff` (table minimale : nom, fonction, `user_id` facultatif ; aucun écran en V1, prépare la paie/RH V2). Le modèle compte 25 tables. | Porteur du projet |
| 2026-11-21 | **A2** — Compte parent unique (`users`) avec une `membership` « parent » par école concernée. Une seule fonction SQL dédiée et testée liste ses enfants toutes écoles confondues (nom, classe, école uniquement). Choisir un enfant bascule la session sur l'école de l'enfant, puis tout passe par la RLS. Politique RLS supplémentaire : dans une école, un parent ne voit que ses enfants. Tests : jamais l'enfant d'un autre parent, rien d'une école sans enfant. | Porteur du projet |
| 2026-11-21 | **A5** — Pas d'accès permanent du super-admin aux données d'une école. Session de support explicite : école choisie, motif obligatoire, expiration après 1 h. Droits pendant la session : lecture/écriture du paramétrage et des fiches élèves uniquement (paiements, notes, bulletins interdits). Ouverture et chaque action tracées dans `audit_logs` (acteur = super-admin), journal consultable par le directeur. | Porteur du projet |
