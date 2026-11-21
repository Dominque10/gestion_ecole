# Hypothèses à valider

> Choix faits **par défaut**, faute d'école pilote (décision D1) ou de réponse du porteur du projet.
> Chacune est modifiable. À passer en revue avec le porteur à la fin de la Phase 1, puis dès qu'une
> école est contactée. Quand une hypothèse est tranchée : noter la décision dans `docs/cadrage.md` (§C)
> et cocher la ligne ici.
>
> Statut : ⏳ à valider · ✅ validée · ✏️ modifiée (voir la décision)
>
> **2026-11-21 : H1 à H37 validées par le porteur du projet (décision D5).**

## Comptes et connexion (Phase 1, étape 3 et 4a)

| # | Hypothèse | Où dans le code | Statut |
|---|---|---|---|
| H1 | Compte bloqué **15 minutes** après 5 mots de passe faux | `src/server/auth/core.ts` | ✅ |
| H2 | Une session dure **12 heures** (ordinateurs partagés au secrétariat) | `src/server/auth/core.ts` | ✅ |
| H3 | Numéros congolais à 9 chiffres après +242 ; autres indicatifs acceptés | `src/server/auth/phone.ts` | ✅ |
| H4 | Code école : 2 à 20 lettres minuscules ou chiffres, sans espace ni accent | `src/modules/settings/schemas.ts` | ✅ |
| H5 | Préfixe des matricules : 2 à 5 lettres, sans chiffre | `src/modules/settings/schemas.ts` | ✅ |
| H6 | Mot de passe provisoire (8 caractères min.), à changer à la première connexion | `src/modules/settings/accounts.ts` | ✅ |
| H7 | Une personne qui a déjà un compte (autre école) le garde, avec son mot de passe | `src/modules/settings/accounts.ts` | ✅ |
| H8 | L'école garde toujours au moins un directeur ; un directeur ne peut pas se retirer lui-même | `src/modules/settings/staff.ts` | ✅ |
| H9 | **Mot de passe oublié** : le directeur remet un mot de passe provisoire à un membre du personnel si ce compte n'appartient à aucune autre école ; sinon, le super-admin le fait (script). Parents : connexion par SMS au M6 | `src/modules/settings/staff.ts`, `scripts/reset-password.mts` | ✏️ D5 |

## Fiche de l'école (4b)

| # | Hypothèse | Où dans le code | Statut |
|---|---|---|---|
| H10 | Images (logo, cachet, signature) : 500 Ko max après réduction à 800 px dans le navigateur | `src/server/storage/images.ts`, `src/lib/compress-image.ts` | ✅ |
| H11 | Les images reçoivent un fond blanc (un cachet transparent devient sur fond blanc) | `src/lib/compress-image.ts` | ✅ |
| H12 | Cachet et signature visibles seulement de la direction (risque de falsification) ; logo pour tout le personnel | `src/modules/settings/school-profile.ts` | ✅ |
| H13 | Le code école et le préfixe des matricules ne se modifient pas depuis la fiche | `src/modules/settings/school-profile.ts` | ✅ |
| H14 | Stockage des fichiers sur disque en local ; stockage en ligne (compatible S3) à brancher au déploiement | `src/server/storage/index.ts` | ✅ |

## Années scolaires et périodes (4c)

| # | Hypothèse | Où dans le code | Statut |
|---|---|---|---|
| H15 | Dates proposées : rentrée le **1er octobre**, fin le **30 juin** (toujours modifiables) | `src/modules/settings/periods-logic.ts` | ✅ |
| H16 | **L'archivage d'une année est définitif**, avec confirmation. En cas d'erreur : correction exceptionnelle par le super-admin, tracée dans le journal (outil à construire le jour où le cas se présente, voir BACKLOG) | migration `0006`, `src/modules/settings/years.ts` | ✏️ D5 |
| H17 | Changer de découpage, ou des dates d'année qui ne contiennent plus les périodes : les périodes sont recalculées (message affiché) | `src/modules/settings/years.ts` | ✅ |
| H18 | Seule une année encore en préparation peut être supprimée | migration `0006` | ✅ |
| H19 | Découpage par défaut en mois entiers (oct.-déc., janv.-mars, avr.-juin) ; trous permis entre périodes (vacances) | `src/modules/settings/periods-logic.ts` | ✅ |

## Structure pédagogique (4d)

| # | Hypothèse | Où dans le code | Statut |
|---|---|---|---|
| H20 | Niveaux par défaut : Petite/Moyenne/Grande section ; CP1 à CM2 ; 6e à 3e ; 2nde, 1re, Tle | `src/modules/settings/defaults.ts` | ✅ |
| H21 | Listes de matières courantes par cycle (ex. collège : Français, Mathématiques, Anglais, Histoire-Géographie, ECM, SVT, Physique-Chimie, EPS ; lycée : + Philosophie), coefficient 1 à ajuster | `src/modules/settings/defaults.ts` | ✅ |
| H22 | Niveaux et matières valent pour toute la vie de l'école ; classes et grille des coefficients sont propres à chaque année | schéma `settings.ts` | ✅ |
| H23 | Coefficients entiers de 1 à 20 | schéma `settings.ts` | ✅ |
| H24 | La série ne s'utilise qu'au lycée (2nde comprise) ; saisie libre, A, C, D proposées | `src/modules/settings/coefficients.ts` | ✅ |
| H25 | Un seul enseignant par matière et par classe | schéma `settings.ts` (`class_subjects`) | ✅ |
| H26 | Retirer le rôle Enseignant (ou retirer la personne) libère ses affectations et son rôle de professeur principal dans les années non archivées | `src/modules/settings/staff.ts` | ✅ |
| H27 | Changer le niveau ou la série d'une classe : ses matières suivent la nouvelle grille ; les enseignants des matières retirées sont perdus | `src/modules/settings/classes.ts` | ✅ |

## Créneaux et frais (4e)

| # | Hypothèse | Où dans le code | Statut |
|---|---|---|---|
| H28 | Créneaux valables pour toute l'école et toutes les années ; chevauchements permis (demi-journées et heures peuvent coexister) | `src/modules/settings/time-slots.ts` | ✅ |
| H29 | Frais fixés **par niveau** (pas par classe ni par série) et par année | schéma `settings.ts` (`fee_items`) | ✅ |
| H30 | Tranches proposées égales, **arrondies à 100 FCFA**, le reste sur la dernière ; échéances aux débuts de période | `src/modules/settings/fees-logic.ts` | ✅ |
| H31 | 1 à 12 tranches par frais ; montant d'une tranche ou d'un frais plafonné à 100 millions FCFA (garde-fou) | `src/modules/settings/fees-logic.ts`, `src/lib/money.ts` | ✅ |
| H32 | **Un seul frais d'inscription par niveau et par année** (il servira à valider l'inscription au paiement, A3) | `src/modules/settings/fees.ts` | ✅ |
| H33 | Échéance libre (peut tomber avant la rentrée, ex. inscription en septembre) ; les échéances d'un frais se suivent | `src/modules/settings/fees-logic.ts` | ✅ |
| H34 | Modifier la grille ne changera pas les échéances déjà émises aux élèves (règle à appliquer au M3) | — (M3) | ✅ |

## Copie d'année et assistant (4f)

| # | Hypothèse | Où dans le code | Statut |
|---|---|---|---|
| H35 | La copie de structure ne se fait que vers une année **en préparation et vide** (ni classes, ni coefficients, ni frais) : pas de fusion | `src/modules/settings/structure-copy.ts` | ✅ |
| H36 | Copie : professeurs principaux et enseignants repris seulement s'ils ont encore le rôle Enseignant ; échéances décalées du nombre d'années entre les rentrées | `src/modules/settings/structure-copy.ts` | ✅ |
| H37 | Assistant : fiche « faite » dès qu'une adresse ou un téléphone est saisi ; personnel « fait » dès qu'une personne s'ajoute au directeur | `src/modules/settings/setup-status.ts` | ✅ |

## Phase 2 — Élèves et caisse (plan validé, décision D6)

| # | Hypothèse | Où dans le code | Statut |
|---|---|---|---|
| H38 | Matricule : « AA » = année de début de l'année scolaire de travail (en cours, sinon en préparation) au moment de la création de la fiche ; numéro d'ordre jamais réutilisé | 2a | ⏳ |
| H39 | Affectation d'un paiement : échéance la plus ancienne d'abord ; à date égale, obligatoire avant facultatif | 2d | ⏳ |
| H40 | Départ d'un élève : échéances à venir non payées annulées (jamais supprimées) ; le déjà payé reste acquis | 2b / 2c | ⏳ |
| H41 | Annulation d'un paiement : tant que le directeur n'a pas validé, le paiement compte normalement | 2d | ⏳ |
| H42 | Après sa clôture, un caissier ne peut plus encaisser ce jour-là (réouverture par le directeur, tracée) | 2e | ⏳ |
| H43 | Une fiche élève n'est jamais supprimée (le départ se gère par l'inscription) | 2a | ⏳ |
| H44 | Pièces jointes : photos uniquement (pas de PDF), réduites dans le téléphone (1 600 px max) | 2a | ⏳ |

## Points du cadrage déjà notés comme hypothèses (décision D1)

Voir `docs/cadrage.md` §B : modèle de bulletin (B2), règles de calcul (B3), prestataire de paiement (B4),
prestataire SMS (B5), blocage du bulletin en cas d'impayé (B7).
