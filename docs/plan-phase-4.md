# Plan — Phase 4 : Parents et pilote (M6 Espace parents + paiement mobile + notifications, M7 Tableau de bord)

> Statut : **validé le 2026-11-23** (décision D20), questions tranchées ci-dessous.
> Jalon de sortie (cahier des charges §4 et §11) : **bilan pilote positif**, dès qu'une école est disponible
> (décision D1 : pas d'école pilote pour l'instant). Critères d'acceptation des modules :
> - M6 : un parent peu à l'aise avec le numérique consulte le bulletin de son enfant **sans aide** ;
> - M7 : le tableau de bord s'affiche en **moins de 3 secondes pour une école de 2 000 élèves**.

## Ce qui existe déjà et sert la Phase 4

- Application installable et service worker (3c) ; pages légères, mobile d'abord.
- Rôle `parent` et `memberships` prévus dès la Phase 1 ; décision **A2** (compte parent unique, une fonction
  SQL dédiée liste ses enfants toutes écoles confondues, puis tout passe par la RLS).
- Interface SMS interne et faux prestataire (3e) ; file pg-boss et worker ; SMS d'absence (D15).
- Bulletins publiés avec photographie (3g) : c'est ce que verra le parent.
- Caisse, reçus PDF, échéances et impayés (Phase 2) ; référence opérateur unique par paiement (idempotence).

## Ce qui reste hors de cette phase

- **Vrais prestataires** de paiement (B4) et de SMS/WhatsApp (B5) : branchés seulement quand un compte marchand
  existe. Jusque-là, faux prestataires derrière les interfaces internes (D1), testés de bout en bout.
- Hébergement définitif (B6), nom de domaine (B1), prix (B8) : décisions de mise en ligne, pas de code.
- Application mobile native, remontées vers le ministère : hors V1.

## Sous-étapes (un commit chacune, tests à chaque fois)

| # | Contenu | Données |
|---|---|---|
| 4a | **Connexion des parents** : téléphone + code SMS à 6 chiffres (valable 10 min, 5 essais, puis blocage 15 min), sans mot de passe ; compte créé à la première connexion si le numéro est celui d'un responsable d'élève (voir question 1) ; **sélecteur d'enfant** toutes écoles confondues (fonction SQL A2) ; choisir un enfant bascule la session sur son école ; **politique RLS « parent »** : il ne voit que ses enfants (élèves, inscriptions, échéances, paiements, notes, bulletins publiés, absences) ; tests d'isolation (jamais l'enfant d'un autre parent, rien d'une école sans enfant) | codes SMS : colonnes dans `users` (code haché, expiration, essais) ; `guardians.user_id` |
| 4b | **Espace parents (consultation)** : accueil de l'enfant en une page (< 300 Ko) ; situation financière (échéances, payé, reste dû) et reçus PDF ; notes (voir question 3) ; bulletins publiés en PDF ; absences et retards ; textes très simples, grands boutons, aucune donnée médicale | lecture seule |
| 4c | **Paiement en ligne** (Airtel Money, MTN MoMo) : le parent choisit les échéances et son numéro ; intention de paiement avec clé unique ; appel du prestataire (faux pour l'instant) ; confirmation sur le téléphone ; **webhook signé et idempotent** ; le worker enregistre le paiement une seule fois, l'affecte aux échéances, valide l'inscription si besoin (A3) et envoie le reçu ; sans réponse après 10 min, interrogation du statut ; **réconciliation quotidienne** | `payment_intents` (nouvelle table, question 2) ; paiement « en ligne » dans `payments` |
| 4d | **Notifications** : canal choisi par l'école (SMS ou WhatsApp) ; **modèles en français modifiables** (absence, reçu de paiement, bulletin publié, annonce) ; chaque envoi journalisé avec son **coût** ; plafond mensuel par école (option) ; faux prestataire WhatsApp ; le SMS d'absence (D15) passe par ces modèles | colonnes dans `notifications` (canal, coût, modèle) ; modèles dans `schools` |
| 4e | **Annonces de l'école** à tous les parents, à un niveau ou à une classe ; visibles dans l'espace parents et envoyées par le canal de l'école | `announcements` (nouvelle table, question 2) |
| 4f | **Tableau de bord de la direction (M7)** : effectifs par niveau et par classe, nouvelles inscriptions, départs ; encaissements du jour, du mois, de l'année ; taux de recouvrement et impayés ; résultats par classe et par matière, taux de réussite par période (question 5) ; taux d'absentéisme ; **< 3 s pour 2 000 élèves** (vérifié sur des données de test) | requêtes agrégées, index au besoin |
| 4g | **Exports Excel et PDF** de toutes les listes (élèves, classes, impayés, encaissements, absences, résultats) ; option **blocage du bulletin en cas d'impayé** (B7, désactivée par défaut, question 4) | — |

Ordre proposé : 4a → 4b (le parent voit quelque chose) → 4c (il paie) → 4d → 4e, puis M7 (4f, 4g).
M7 ne dépend pas de M6 : il peut passer avant si tu préfères montrer d'abord le tableau de bord à des directeurs.

## Garanties (CLAUDE.md §6)

- RLS sur toute nouvelle table ; politique « parent » testée table par table ; la fonction A2 ne renvoie que
  nom, classe et école.
- Argent : intentions et paiements en ligne dans des transactions ; webhook **idempotent** (clé = référence de
  l'opérateur) et **signature vérifiée** ; paiements toujours immuables ; réconciliation tracée.
- Codes SMS hachés, jamais écrits dans les journaux ; même message d'erreur pour un numéro inconnu ou un code faux.
- Nouvelles actions dans le tableau des droits : `parent:view`, `payments:pay-online` (existe), `notifications:templates`,
  `announcements:send`, `dashboard:school` (existe), `exports:download`.

## Questions à trancher avant le code

1. **Création des comptes parents** : automatique à la première connexion si le numéro est celui d'un responsable
   enregistré par l'école (recommandé : rien à faire pour l'école), ou invitation envoyée par l'école ?
2. **Modèle de données** : le paiement en ligne a besoin d'intentions de paiement (`payment_intents`) et les annonces
   d'une table `announcements` : **33 tables** au lieu de 31. Alternative pour les annonces : les ranger dans
   `notifications` (moins clair, pas de lecture dans l'espace parents).
3. **Notes visibles par le parent** : seulement par les bulletins publiés (recommandé : pas de note isolée mal
   comprise), au fil de l'eau après chaque saisie, ou après la clôture de la période ?
4. **Blocage du bulletin en cas d'impayé (B7)** : option désactivée par défaut que chaque école peut activer
   (le bulletin reste visible par la direction), ou pas d'option du tout ?
5. **Taux de réussite** du tableau de bord : part des élèves ayant au moins la moitié du barème (10/20) de moyenne
   générale ?
6. **Paiement en ligne** : le parent peut-il payer une partie d'une échéance (montant libre au-dessus d'un minimum),
   ou seulement des échéances entières ? Le paiement en ligne est-il enregistré au nom d'un « compte caisse en ligne »
   de l'école (recommandé) ?
7. **Prestataires** : on garde les faux prestataires pendant toute la phase (recommandé) ; dès qu'un compte marchand
   existe (pawaPay, CinetPay ou API directes) et un prestataire SMS, on les branche sans toucher au reste.

## Réponses du porteur (2026-11-23, décision D20)

1. Comptes parents **créés automatiquement** à la première connexion (numéro d'un responsable enregistré).
2. **33 tables** : `payment_intents` et `announcements` ajoutées.
3. Le parent voit les notes **seulement par les bulletins publiés**.
4. Blocage du bulletin en cas d'impayé : **option désactivée par défaut** (B7).
5. Taux de réussite : moyenne générale d'au moins la moitié du barème (recommandation, sans objection).
6. Paiement en ligne d'**échéances entières**, enregistré au nom d'un « compte caisse en ligne » de l'école
   (recommandation, sans objection).
7. **Faux prestataires** de paiement et de SMS/WhatsApp pendant toute la phase (recommandation, sans objection).

## Jalon sans école pilote

Le jalon officiel demande une école pilote. En attendant, je propose un **jalon technique** : parcours parent complet
(connexion par code, consultation, paiement avec le faux prestataire, webhook rejoué sans doublon, reçu), tableau
de bord sous 3 s sur 2 000 élèves de test, exports. Le test « parent sans aide » se fera avec une vraie personne
dès que possible (un proche, puis les parents de l'école pilote).
