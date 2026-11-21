# Cadrage — décisions et points ouverts (Phase 0)

> Chaque point doit être tranché avant le code du module concerné.
> Une fois décidé : noter la décision, la date et qui l'a prise, puis répercuter dans CLAUDE.md
> et le cahier des charges si besoin.

## A. Incohérences relevées dans le cahier des charges

| # | Point | Bloque | Décision |
|---|---|---|---|
| A1 | §2 dit que le modèle prévoit les entités **Personnel** et **Créneau**, absentes du §8 et du CLAUDE.md. Le §8 annonce « vingt entités » mais en liste 23. | Phase 1 (schéma) | **Décidé** (voir C) |
| A2 | **Parent lié à des enfants de plusieurs écoles** (M2) vs RLS par école de session : comment l'espace parent regroupe-t-il les enfants sans contourner la RLS ? | Phase 1 (auth/RLS), M6 | **Décidé** (voir C) |
| A3 | **M2 dépend de M3** : « inscription validée = frais d'inscription payés » suppose que les paiements existent. Validation manuelle provisoire dans M2, ou M2 et M3 livrés ensemble ? | M2 | **Décidé** (voir C) |
| A4 | **Données médicales** réservées à la direction, alors que le secrétariat modifie les fiches élèves : il faut un droit au niveau du champ. | M2 | **Décidé** (voir C) |
| A5 | **Rôle « Support » du super-admin** non défini (lecture seule ? agir à la place d'un directeur ?). Doit être tracé dans `audit_logs`. | Phase 1 (rôles) | **Décidé** (voir C) |
| A6 | **Format du matricule** élève non précisé (préfixe école, année, séquence…). | M2 | **Décidé** (voir C) |
| A7 | **Rôle Support : écart entre le Claude Doc et la décision A5.** Le Claude Doc (§3) dit : lecture seule, autorisation du directeur, 24 h par défaut, agir à la place d'un utilisateur reporté en V2. La décision A5 dit : pas d'autorisation du directeur, motif obligatoire, 1 h, lecture/écriture du paramétrage et des élèves. Si la version du Claude Doc est retenue, il faut aussi une table pour stocker les autorisations (non prévue parmi les 26). | Phase 1 (rôles) | **Décidé** (voir C) |
| A8 | **`time_slots` : écart entre le Claude Doc et la décision A1.** Le Claude Doc (§8) la définit comme « classe-matière, jour, heure de début, heure de fin, salle », c'est-à-dire un emploi du temps (hors V1). Le §2 dit « sans écran en V1 » alors que M5 en a besoin : qui crée les créneaux ? L'appel par demi-journée ne correspond à aucune classe-matière. | M5 (et schéma Phase 1) | **Décidé** (voir C) |

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
| 2026-11-21 | **A3** — M2 et M3 développés ensemble en phase 2. D'abord une validation manuelle de l'inscription par le secrétariat ou la direction ; une fois M3 en place, validation automatique au paiement des frais d'inscription. La validation manuelle devient alors une exception réservée au directeur, tracée dans `audit_logs`. Colonne « mode de validation » dans `enrollments`. | Porteur du projet |
| 2026-11-21 | **A4** — Données médicales dans une table séparée `student_medical` (allergies, traitements, contact d'urgence) avec sa propre politique RLS : lecture et écriture réservées à la direction. Le secrétariat modifie la fiche élève sans jamais voir ces données. | Porteur du projet |
| 2026-11-21 | **A6** — Matricule `CODE-AA-NNNNN` (ex. `SJB-26-00042`) : préfixe paramétrable par école (`schools`), deux chiffres de l'année de première inscription, numéro d'ordre continu par école. Attribué une fois, jamais modifié ni réutilisé. Format du Claude Doc retenu (année sur 2 chiffres). | Porteur du projet |
| 2026-11-21 | **A7 (remplace A5)** — Support en **lecture seule**, uniquement **après autorisation du directeur**, durée limitée (**24 h par défaut**). Chaque ouverture et chaque consultation tracées dans `audit_logs`. Agir à la place d'un utilisateur : reporté en V2. Stockage : une `membership` avec le rôle `support`, une date d'expiration et l'identité du directeur qui l'a accordée (pas de nouvelle table, 26 tables). | Porteur du projet |
| 2026-11-21 | **A8 (confirme A1)** — `time_slots` = créneaux simples définis par l'école (libellé, heure de début, heure de fin ; ex. « Matin 7h30-12h »), saisis dans un petit écran du M1. **Pas d'emploi du temps** (ni classe-matière, ni jour, ni salle). Pour l'appel par cours, `attendance` reçoit une colonne facultative `class_subject_id`. | Porteur du projet |
