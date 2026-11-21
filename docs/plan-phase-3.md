# Plan — Phase 3 : Pédagogie (M4 Notes et bulletins + M5 Absences)

> Statut : **validé le 2026-11-21** (décision D11).
> Jalon de sortie (cahier des charges §5) : les moyennes calculées correspondent **au centième près** à des
> cas de référence préparés par le porteur ; **50 bulletins générés en moins de 30 secondes** ;
> **appel d'une classe de 60 élèves en moins d'une minute** sur téléphone.

## Ce qui reste hors de cette phase

- L'**espace parents** (consultation des notes, bulletins, absences) arrive avec le **M6** (phase 4).
  En Phase 3, « publier » un bulletin le rend disponible pour cet espace et prépare la notification.
- Le **vrai prestataire SMS/WhatsApp** est choisi au M6 (B5). Voir la question 7 ci-dessous pour les
  notifications d'absence.
- Emploi du temps, cahier de textes : hors V1 (l'appel s'appuie sur les créneaux simples du M1, A8).

## Sous-étapes (un commit chacune, tests à chaque fois)

| # | Contenu | Tables |
|---|---|---|
| 3a | **Règles de calcul de l'école** : barème (sur 20, ou sur 10 au primaire), poids des types d'évaluation (interrogations, devoirs, compositions), arrondi, rang ex æquo, matières facultatives, mentions (seuils). Écran dans Paramètres, directeur seul | colonnes dans `schools` et `level_subjects` (facultative) |
| 3b | **Évaluations et saisie des notes** : l'enseignant crée une évaluation (type, date, barème, matière, classe, période) pour ses seules classes ; grille de saisie rapide au clavier et au téléphone ; absents et dispensés | `assessments`, `grades` |
| 3c | **Hors connexion** : application installable (Serwist), file locale (Dexie / IndexedDB), identifiants créés sur le téléphone, synchronisation au retour du réseau, **conflits affichés, jamais écrasés** | — |
| 3d | **Calculs** (fonctions pures, testées avec les cas de référence) : moyenne par matière, moyenne générale pondérée par les coefficients, rang, moyenne de classe, plus forte et plus faible moyenne, moyenne annuelle. **Verrouillage** des notes à la clôture de la période ; déverrouillage par le directeur seul, tracé ; toute modification après verrouillage tracée | colonnes de clôture dans `periods` |
| 3e | **Appel (M5)** : par cours ou par demi-journée (créneaux du M1), tous présents par défaut, un toucher par absent ou retardataire (objectif : 60 élèves en moins d'une minute), hors connexion (même mécanisme que 3c) ; justification par le secrétariat (motif, pièce jointe) ; notification du parent pour toute absence non justifiée | `attendance`, `notifications` |
| 3f | **Conseil de classe** : appréciations par matière (enseignant) et générale, mention proposée selon les seuils, décision (passage, redoublement, exclusion…) ; totaux d'absences et de retards | `report_cards` |
| 3g | **Bulletins PDF** au format de l'école (logo, cachet, signature) via le worker existant : toute une classe en un clic (50 en moins de 30 s), bulletin annuel récapitulatif ; **publication après validation du directeur** | — |

L'appel (3e) passe avant le conseil de classe et les bulletins, qui reprennent les totaux d'absences.

## Garanties (CLAUDE.md §6)

- RLS sur les 5 nouvelles tables, test d'isolation entre écoles ; déclencheur « année archivée = lecture seule ».
- Un enseignant ne voit et ne note que ses classes et ses matières (contrôle serveur + RLS existante).
- Toute règle de calcul est un paramètre de l'école, couvert par des tests unitaires.
- Les bulletins publiés gardent une **photographie** des moyennes (une correction ultérieure exige un
  déverrouillage tracé puis une nouvelle publication).
- Nouvelles actions dans le tableau des droits : `assessments:manage`, `grades:unlock`, `periods:close`,
  `report-cards:council`, `report-cards:publish`, `attendance:justify`, `grading:settings`.

## Modèle de données

Aucune table nouvelle : les 5 tables `assessments`, `grades`, `report_cards`, `attendance`,
`notifications` font déjà partie des 30 tables (CLAUDE.md §8). Ajouts de colonnes : règles de calcul
dans `schools`, « facultative » dans `level_subjects`, clôture (date, auteur) dans `periods`.

## Ce que le porteur du projet doit fournir (critère d'acceptation)

Quelques **cas de référence** de bulletins réels ou réalistes, idéalement 2 ou 3 élèves d'une même
classe sur un trimestre : notes de chaque évaluation, coefficients, moyennes et rang attendus tels qu'une
école les calculerait. Sans ces cas, les tests utilisent des exemples construits à partir des règles
choisies ci-dessous (hypothèse).

## Règles tranchées par le porteur (2026-11-21, décision D10)

Valeurs par défaut, chacune modifiable par école (3a).

1. **Arrondi** : calcul exact, moyennes arrondies au centième (12,345 → 12,35) ; le rang se fait sur la moyenne arrondie.
2. **Ex æquo** : même rang, le suivant saute les places prises (1er, 2e ex, 2e ex, 4e).
3. **Matières facultatives** : seuls les points au-dessus de 10 s'ajoutent (× coefficient) ; elles ne font jamais baisser la moyenne.
4. **Moyenne d'une matière** : (moyenne des interrogations et devoirs + composition) / 2.
5. **Absent à une évaluation** : non compté (l'enseignant peut saisir 0 s'il le décide) ; l'absence reste visible.
6. **Moyenne annuelle** : moyenne des trimestres (ou semestres), chacun pèse autant.
7. **Notification d'absence** : chaîne complète dès la Phase 3 (file de tâches, envoi le jour même) vers un faux prestataire SMS de test ; le vrai prestataire est branché au M6.
8. **Appréciations** : chaque enseignant écrit celle de sa matière ; le professeur principal ou le directeur l'appréciation générale ; le directeur valide mention et décision.
