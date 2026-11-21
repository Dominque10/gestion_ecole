# Cadrage — décisions et points ouverts (Phase 0)

> Chaque point doit être tranché avant le code du module concerné.
> Une fois décidé : noter la décision, la date et qui l'a prise, puis répercuter dans CLAUDE.md
> et le cahier des charges si besoin.

## A. Incohérences relevées dans le cahier des charges

| # | Point | Bloque | Décision |
|---|---|---|---|
| A1 | §2 dit que le modèle prévoit les entités **Personnel** et **Créneau**, absentes du §8 et du CLAUDE.md. Le §8 annonce « vingt entités » mais en liste 23. | Phase 1 (schéma) | _à décider_ |
| A2 | **Parent lié à des enfants de plusieurs écoles** (M2) vs RLS par école de session : comment l'espace parent regroupe-t-il les enfants sans contourner la RLS ? | Phase 1 (auth/RLS), M6 | _à décider_ |
| A3 | **M2 dépend de M3** : « inscription validée = frais d'inscription payés » suppose que les paiements existent. Validation manuelle provisoire dans M2, ou M2 et M3 livrés ensemble ? | M2 | _à décider_ |
| A4 | **Données médicales** réservées à la direction, alors que le secrétariat modifie les fiches élèves : il faut un droit au niveau du champ. | M2 | _à décider_ |
| A5 | **Rôle « Support » du super-admin** non défini (lecture seule ? agir à la place d'un directeur ?). Doit être tracé dans `audit_logs`. | Phase 1 (rôles) | _à décider_ |
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
