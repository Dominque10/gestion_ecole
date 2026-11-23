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
| H91 | L'appel se fait pour aujourd'hui ou un jour passé de l'année (jamais dans le futur) ; un appel déjà fait peut être corrigé (sans écraser la saisie d'un autre) | 3e | ✅ |
| H92 | Sans réseau, l'appel se fait pour le jour même, dans la page hors connexion, pour les classes ouvertes au moins une fois avec du réseau dans « Appel » | 3e | ✅ |
| H93 | Un enseignant fait l'appel des classes où il enseigne ou dont il est professeur principal (appel par cours : ses matières) ; direction et secrétariat : toutes les classes | 3e | ✅ |
| H94 | Un élève remis « présent » perd la justification de ce créneau ; l'appel n'est pas verrouillé par la clôture des notes | 3e | ✅ |
| H95 | Justification par élève et par journée (toutes ses absences et retards non justifiés du jour), motif obligatoire, photo facultative rangée avec les pièces de l'élève | 3e | ✅ |
| H96 | Texte du SMS : école, élève, classe, date et créneaux manqués, demande de justifier au secrétariat ; pas de responsable principal avec téléphone : pas de SMS | 3e | ✅ |
| H97 | Appréciations de 300 caractères au plus ; le directeur peut écrire celles de toutes les matières ; une appréciation vidée est retirée | 3f | ✅ |
| H98 | Mentions possibles au conseil : celles de l'école, plus « Avertissement » et « Blâme », ou aucune ; sans choix du directeur, la mention proposée selon les seuils est retenue à la validation | 3f | ✅ |
| H99 | Décisions de fin d'année : « Admis(e) en classe supérieure », « Redouble », « Exclu(e) » ; prises seulement au conseil de fin d'année, une par élève, obligatoires pour valider | 3f | ✅ |
| H100 | Absences du bulletin comptées en créneaux manqués (pas en jours), avec la part non justifiée ; retards comptés à part | 3f | ✅ |
| H101 | Le conseil se valide après la clôture de la période pour la classe (pour l'année : la dernière période) ; une fois validé tout est figé ; le directeur peut le rouvrir (tracé) | 3f | ✅ |
| H102 | Format du bulletin (en attendant le modèle d'une école, B2) : A4, une page par élève ; matières avec coefficient, moyenne, points, moyenne de la classe, plus forte et plus faible, appréciation ; moyenne générale, rang sur l'effectif, chiffres de la classe, absences, mention, appréciation générale, cachet, signature et visa des parents | 3g | ✅ |
| H103 | Les bulletins se publient par classe et par période (tous ensemble), par le directeur, une fois le conseil validé | 3g | ✅ |
| H104 | Rouvrir le conseil retire la publication (tracé) ; la photographie reste jusqu'à la nouvelle publication ; l'espace parents (M6) ne montrera que les bulletins publiés | 3g | ✅ |
| H105 | Avant publication, le directeur et le professeur principal peuvent télécharger un projet, marqué « Projet — bulletin non publié » | 3g | ✅ |
| H106 | Bulletin annuel : moyenne générale et rang de chaque période, moyenne annuelle, rang, mention, décision et absences de l'année (sans le détail par matière) | 3g | ✅ |

## Points du cadrage déjà notés comme hypothèses (décision D1)

Voir `docs/cadrage.md` §B : modèle de bulletin (B2), règles de calcul (B3), prestataire de paiement (B4),
prestataire SMS (B5), blocage du bulletin en cas d'impayé (B7).

## Parents et pilote (Phase 4)

Plan validé : décision D20 (`docs/plan-phase-4.md`). Hypothèses complémentaires :

| # | Hypothèse | Où | Statut |
|---|---|---|---|
| H107 | Code SMS de 6 chiffres valable 10 minutes, un envoi par minute au plus ; 5 codes faux = blocage 15 minutes ; session parent de 30 jours (éviter un SMS à chaque visite) | 4a | ✅ |
| H108 | Le compte parent se reconnaît au **téléphone principal** d'une fiche de responsable (pas au second numéro) ; le compte prend le nom de la première fiche | 4a | ✅ |
| H109 | Enfants affichés : inscriptions en cours (préinscriptions comprises) des années non archivées ; un enfant parti n'apparaît plus | 4a | ✅ |
| H110 | Un membre du personnel qui est aussi parent garde ses rôles et gagne le rôle parent ; un compte « parent seulement » ne voit que ses enfants, et lit le référentiel de l'école (classes, matières, périodes, créneaux, grille des frais) | 4a | ✅ |
| H111 | Frais vus par le parent : échéances ouvertes (les annulées sont masquées), reste à payer et part en retard, et ses reçus (un reçu annulé reste visible, marqué « annulé ») | 4b | ✅ |
| H112 | Blocage (B7) : seules les échéances **obligatoires** échues comptent ; tant qu'il en reste une impayée, tous les bulletins publiés de l'enfant sont cachés au parent, avec un message l'invitant à contacter le secrétariat | 4b | ✅ |
| H113 | Absences vues par le parent : totaux de l'année et les 15 dernières absences ou retards ; pas de justification en ligne (le justificatif s'apporte au secrétariat) | 4b | ✅ |
| H114 | Paiement en ligne d'échéances entières (les échéances en retard cochées d'office) ; une seule demande en attente par enfant pendant 10 minutes | 4c | ✅ |
| H115 | Sans confirmation, le prestataire est interrogé 10 minutes après la demande puis toutes les 10 minutes ; au bout d'une heure, la demande expire ; une confirmation arrivée plus tard est quand même enregistrée (l'argent a été pris) | 4c | ✅ |
| H116 | L'argent reçu n'est jamais refusé : il va d'abord aux échéances choisies, puis aux autres ; un surplus (échéance réglée au guichet entre-temps) est noté « trop-perçu à rembourser » sur le paiement et dans le journal, l'école rembourse | 4c | ✅ |
| H117 | Paiement en ligne enregistré au nom du compte « Paiement en ligne » de l'école (qui ne peut pas se connecter), en mobile money, avec la référence de l'opérateur ; il n'entre dans la clôture de caisse d'aucun caissier ; reçu PDF disponible pour le parent | 4c | ✅ |
| H118 | Réconciliation chaque jour (la veille) par le worker : une confirmation perdue est rattrapée ; une transaction inconnue est signalée dans le journal du serveur (écran de suivi pour la direction au M7) | 4c | ✅ |
| H119 | Messages automatiques au responsable principal : absence (D15), reçu de paiement (dès l'encaissement, au guichet ou en ligne), bulletin publié (à la publication) ; un seul message par objet | 4d | ✅ |
| H120 | Coûts indicatifs du faux prestataire : SMS 25 FCFA, WhatsApp 15 FCFA ; les codes de connexion partent toujours par SMS et ne sont pas journalisés (ils contiennent un secret) | 4d | ✅ |
| H121 | Modèles de 320 caractères au plus (2 SMS), avec seulement les champs prévus pour chaque message ; un modèle enregistré devenu invalide est remplacé par celui par défaut | 4d | ✅ |
| H122 | Plafond mensuel facultatif (FCFA) : au-delà, le message n'est pas envoyé, il est noté « non envoyé (plafond) » et pas réessayé ; le mois est celui de Brazzaville | 4d | ✅ |
| H123 | Si l'école choisit WhatsApp, tous ses messages partent par WhatsApp, sans repli automatique sur SMS (à revoir avec le vrai prestataire, B5) | 4d | ✅ |
| H124 | Annonces publiées par le directeur ou le secrétariat (choix du porteur, D25), pour l'année active ; titre de 80 caractères au plus, texte de 300 au plus | 4e | ✅ |
| H125 | Case « Envoyer aussi par SMS ou WhatsApp » cochée par défaut (choix du porteur, D25) ; un seul message par famille (responsable principal), même avec plusieurs enfants concernés ; le message reprend titre et texte ; le plafond mensuel s'applique | 4e | ✅ |
| H126 | Un parent voit les annonces de l'année qui concernent l'un de ses enfants (toute l'école, son niveau ou sa classe) ; la page de l'enfant montre les 3 plus récentes | 4e | ✅ |
| H127 | Une annonce publiée ne se modifie ni ne se supprime : une correction se fait par une nouvelle annonce | 4e | ✅ |
| H128 | Tableau de bord : le directeur voit tout ; le comptable ne voit que les finances et les paiements en ligne ; les autres rôles n'y ont pas accès. Chiffres de l'année active, au jour de Brazzaville | 4f | ✅ |
| H129 | « Nouveaux élèves » = inscrits sans inscription dans une année précédente de l'école ; « inscriptions du mois » = validées depuis le 1er du mois ; départs comptés par motif | 4f | ✅ |
| H130 | Encaissements : les annulations sont déduites le jour où elles sont faites. Taux de recouvrement = payé sur les échéances dont la date limite est passée ÷ montant de ces échéances (remises déduites, échéances annulées exclues), comme la liste des impayés | 4f | ✅ |
| H131 | Résultats calculés en direct à partir des notes (pas seulement des bulletins publiés), sur la période en cours par défaut ; seuls les élèves classés comptent ; par matière, part des élèves ayant au moins la moitié du barème dans la matière, matières en difficulté d'abord | 4f | ✅ |
| H132 | Absentéisme = créneaux d'appel « absent » ÷ créneaux d'appel enregistrés (les retards sont affichés à part) ; les 5 classes les plus touchées du mois. Paiements en ligne : un paiement en attente depuis plus d'une heure est signalé. Les transactions inconnues de la réconciliation ne sont rattachées à aucune école : elles restent dans le journal du serveur pour l'équipe de la plateforme (pas d'écran école) | 4f | ✅ |
