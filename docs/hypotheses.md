# Hypothèses à valider

> Choix faits **par défaut**, faute d'école pilote (décision D1) ou de réponse du porteur du projet.
> Chacune est modifiable. À passer en revue avec le porteur à la fin de la Phase 1, puis dès qu'une
> école est contactée. Quand une hypothèse est tranchée : noter la décision dans `docs/cadrage.md` (§C)
> et cocher la ligne ici.
>
> Statut : ⏳ à valider · ✅ validée · ✏️ modifiée (voir la décision)
>
> **2026-11-21 : H1 à H37 validées par le porteur du projet (décision D5).**
> **2026-11-21 : H38 à H68 validées par le porteur du projet (décision D8).**

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
| H38 | Matricule : « AA » = année de début de l'année scolaire de travail (en cours, sinon en préparation) au moment de la création de la fiche ; numéro d'ordre jamais réutilisé | 2a | ✅ |
| H39 | Affectation d'un paiement : échéance la plus ancienne d'abord ; à date égale, obligatoire avant facultatif | 2d | ✅ |
| H40 | Départ d'un élève : échéances à venir non payées annulées (jamais supprimées) ; le déjà payé reste acquis | 2b / 2c | ✅ |
| H41 | Annulation d'un paiement : tant que le directeur n'a pas validé, le paiement compte normalement | 2d | ✅ |
| H42 | Après sa clôture, un caissier ne peut plus encaisser ce jour-là (réouverture par le directeur, tracée) | 2e | ✅ |
| H43 | Une fiche élève n'est jamais supprimée (le départ se gère par l'inscription) | 2a | ✅ |
| H44 | Pièces jointes : photos uniquement (pas de PDF), réduites dans le téléphone (1 600 px max) | 2a | ✅ |
| H45 | La classe s'affecte après la validation de l'inscription ; une préinscription peut changer de niveau | 2b | ✅ |
| H46 | Réinscription groupée : crée des **préinscriptions** (validées ensuite comme les autres, au paiement des frais d'inscription) ; niveau suivant proposé (CM2 → 6e, 3e → 2nde), redoublement possible ; après la Tle, « ne revient pas » par défaut | 2b | ✅ |
| H47 | Un enseignant voit les élèves des classes où il enseigne ou dont il est professeur principal, pour les années non archivées | 2b | ✅ |
| H48 | Le départ d'un élève n'est pas réversible dans l'application (une erreur se corrige par une nouvelle inscription) | 2b | ✅ |
| H49 | Échéances créées dès la **préinscription** (le paiement des frais d'inscription validera l'inscription) ; recalculées si le niveau change avant validation | 2c | ✅ |
| H50 | Frais obligatoires créés automatiquement ; frais facultatifs ajoutés élève par élève | 2c | ✅ |
| H51 | Fratrie : frères et sœurs = un responsable en commun ; s'applique aux enfants inscrits **après** le premier la même année ; non recalculée si l'aîné part ensuite ; arrondi au franc inférieur | 2c | ✅ |
| H52 | Bourse = % sur les échéances de scolarité **encore ouvertes** ; remise exceptionnelle = montant sur une échéance ; les réductions se cumulent sur le montant d'origine, sans jamais le dépasser ; directeur seul, motif obligatoire | 2c | ✅ |
| H53 | L'enseignant ne voit pas les comptes (échéances, paiements) de ses élèves | 2c | ✅ |
| H54 | Référence obligatoire pour mobile money, virement et chèque ; une même référence n'est enregistrée qu'une fois par école | 2d | ✅ |
| H55 | Une annulation de paiement rouvre les échéances concernées ; une inscription déjà validée par ce paiement **reste validée** | 2d | ✅ |
| H56 | Un élève parti peut encore régler ce qu'il doit (échéances non annulées) | 2d | ✅ |
| H57 | Au départ, une échéance déjà payée en partie n'est pas annulée : son reste demeure dû | 2d | ✅ |
| H58 | Clôture : l'écart porte sur les **espèces** (comptées − attendues) ; mobile money, virement et chèque se vérifient sur les relevés. On peut clôturer un jour passé oublié, jamais un jour futur | 2e | ✅ |
| H59 | Impayés : échéance dont la date limite est dépassée et le reste dû positif ; ancienneté comptée depuis la plus ancienne en retard (jusqu'à 30, 31-60, 61-90, plus de 90 jours) | 2e | ✅ |
| H60 | Le comptable voit ses propres clôtures ; le directeur voit et rouvre toutes les clôtures | 2e | ✅ |
| H61 | Les PDF ne sont pas conservés sur le serveur : produits à la demande, récupérables 1 h par la seule personne qui les a demandés | 2f | ✅ |
| H62 | La page publique de vérification d'un reçu (QR code) affiche école, numéro, date, montant et validité, **jamais l'élève** | 2f | ✅ |
| H63 | Liste de classe : direction, secrétariat, comptabilité, et l'enseignant pour ses classes ; cartes scolaires et certificats : direction et secrétariat | 2f | ✅ |
| H64 | Cartes scolaires au format carte bancaire (85,6 × 54 mm), 8 par page A4, avec photo ; certificats avec cachet et signature de l'école, textes accordés au sexe de l'élève | 2f | ✅ |
| H65 | Import **tout ou rien** : la moindre erreur bloque tout l'import ; vérification préalable sans rien enregistrer | 2g | ✅ |
| H66 | Doublon = mêmes nom, prénoms et date de naissance (déjà dans l'école ou deux fois dans le fichier) : refusé | 2g | ✅ |
| H67 | Élèves importés : nouveau matricule ; préinscrits au niveau indiqué (échéances créées) ; option directeur « déjà validées » avec classe affectée | 2g | ✅ |
| H68 | Fichier : 1 Mo et 3 000 élèves au plus ; CSV en UTF-8 ou Windows-1252 ; 0 initial des téléphones rétabli | 2g | ✅ |

## Pédagogie (Phase 3)

Règles tranchées par le porteur : décision D10 (`docs/plan-phase-3.md`). Hypothèses complémentaires :

| # | Hypothèse | Où | Statut |
|---|---|---|---|
| H69 | Collège et lycée toujours notés **sur 20** ; primaire et préscolaire sur 20 par défaut, réglable **sur 10** par l'école | 3a | ✅ |
| H70 | Trois types d'évaluation fixes : **interrogation, devoir, composition** ; interrogations et devoirs forment ensemble la « moyenne des devoirs » | 3a, 3b | ✅ |
| H71 | Mentions automatiques par défaut : **Félicitations ≥ 16, Encouragements ≥ 14, Tableau d'honneur ≥ 12** ; avertissement et blâme ne sont jamais automatiques (conseil de classe) | 3a | ✅ |
| H72 | Barème sur 10 : seuils des mentions divisés par 2 ; matière facultative = points au-dessus de la moitié du barème (5 sur 10) | 3a | ✅ |
| H73 | Un changement de règles vaut pour les calculs suivants ; un bulletin déjà publié garde ses moyennes ; chaque changement est noté dans le journal | 3a | ✅ |
| H74 | Une matière est déclarée facultative dans la grille des coefficients (par niveau + série), et la copie d'année reprend ce choix | 3a | ✅ |
| H75 | La date d'une évaluation doit tomber dans l'année scolaire ; la période est choisie par l'enseignant (par défaut : celle du jour), sans obligation que la date soit dans cette période | 3b | ✅ |
| H76 | Barème d'une évaluation : entier de 1 à 100, proposé sur 20 (sur 10 au primaire si l'école l'a choisi) ; notes avec deux décimales au plus (12,25) | 3b | ✅ |
| H77 | Le directeur crée des évaluations et saisit les notes de toutes les matières ; un professeur principal ne note que les matières qu'il enseigne lui-même | 3b | ✅ |
| H78 | Les évaluations se créent seulement dans l'année active ; l'enseignant modifie ou supprime les siennes jusqu'au verrouillage de la période (3d) ; supprimer une évaluation qui a des notes est noté dans le journal | 3b | ✅ |
| H79 | Seuls les élèves inscrits dans la classe sont notés ; un élève parti ou changé de classe garde ses notes, visibles mais plus modifiables | 3b | ✅ |
| H80 | Une matière qui a des évaluations ne peut pas être retirée de la grille des coefficients (supprimer d'abord les évaluations) | 3b | ✅ |
| H81 | Saisies simultanées : une note changée par quelqu'un d'autre pendant la saisie n'est pas remplacée ; l'utilisateur voit la valeur actuelle et enregistre à nouveau s'il veut garder la sienne | 3b | ✅ |
| H82 | Sans réseau, la saisie se fait dans la page « Notes hors connexion » (ouverte d'elle-même quand une page ne charge pas) ; seules les matières ouvertes au moins une fois avec du réseau sur ce téléphone y sont disponibles (élèves, évaluations et notes du moment) | 3c | ✅ |
| H83 | Les copies sont rangées par compte sur le téléphone ; à la déconnexion, les copies (noms d'élèves, notes) sont effacées, mais pas les saisies encore en attente d'envoi | 3c | ✅ |
| H84 | Envoi automatique à l'ouverture d'une page, au retour du réseau, puis toutes les 30 s tant qu'il reste des saisies ; une note en conflit n'est jamais envoyée d'elle-même : l'enseignant choisit « garder ma note » ou « garder la note actuelle » | 3c | ✅ |
| H85 | Une évaluation créée sur le téléphone puis refusée à l'envoi (ex. année changée, matière retirée) reste sur le téléphone avec le motif, ses notes aussi ; l'enseignant peut la supprimer du téléphone | 3c | ✅ |
| H86 | Les résultats d'une classe (moyennes, rangs) sont visibles par le directeur et par le professeur principal ; les autres enseignants voient seulement les notes de leurs matières | 3d | ✅ |
| H87 | Rangs et chiffres de la classe portent sur les élèves inscrits dans la classe au moment du calcul ; un élève parti n'y figure plus (ses notes restent enregistrées) | 3d | ✅ |
| H88 | Moyenne annuelle calculée à partir des moyennes générales arrondies des périodes ; une période sans moyenne pour l'élève est laissée de côté | 3d | ✅ |
| H89 | « Partie manquante = 0 » ne joue que si la classe entière n'a pas eu l'épreuve ; un élève absent à la composition passée par la classe a sa moyenne sur ce qu'il a fait (règle des absences) | 3d | ✅ |
| H90 | Clôturer une classe déjà close ne change rien ; la réouverture demande un motif (3 à 300 caractères) ; l'historique des clôtures n'est jamais supprimé ; une matière facultative est classée en fin de liste, les autres par coefficient décroissant | 3d | ✅ |

## Points du cadrage déjà notés comme hypothèses (décision D1)

Voir `docs/cadrage.md` §B : modèle de bulletin (B2), règles de calcul (B3), prestataire de paiement (B4),
prestataire SMS (B5), blocage du bulletin en cas d'impayé (B7).
