# Plan — Phase 2 : Élèves et caisse (M2 + M3, décision A3)

> Statut : **validé le 2026-11-21** (décision D6), 2 tables supplémentaires comprises.
> Jalon de sortie (cahier des charges §5) : importer 1 000 élèves depuis un fichier en moins de 2 minutes,
> avec rapport d'erreurs ligne par ligne ; la somme des reçus d'une journée égale toujours la clôture de caisse.

## Ce qui reste hors de cette phase

Le paiement en ligne par le parent (Airtel Money / MTN MoMo) et tout envoi de SMS ou WhatsApp (reçus,
relances) arrivent avec le **M6** (phase 4, CLAUDE.md §4). La Phase 2 prépare seulement le modèle de
données pour eux (référence opérateur unique, statut d'envoi). Le blocage du bulletin pour impayé (B7)
se branchera au M4 ; il reste désactivé par défaut.

## Sous-étapes (un commit chacune, tests à chaque fois)

| # | Contenu | Tables |
|---|---|---|
| 2a | **Fiche élève** : matricule `CODE-AA-NNNNN` attribué automatiquement (compteur par école, sans trou), identité, photo, école d'origine ; infos médicales visibles de la direction seule (A4) ; responsables légaux (plusieurs, téléphone principal), un parent lié à plusieurs enfants ; pièces jointes en photo ; recherche par nom, matricule ou téléphone du parent | `students`, `student_medical`, `guardians`, `student_guardians`, `student_documents` *(nouvelle)* |
| 2b | **Inscription** : préinscription → inscription validée → affectation en classe ; validation manuelle (secrétariat ou direction) ; effectif maximal contrôlé ; réinscription groupée d'une année sur l'autre ; départs (transfert, abandon, exclusion) | `enrollments` |
| 2c | **Échéances** : générées à l'inscription depuis la grille tarifaire, avec réductions (fratrie, bourse, remise exceptionnelle validée par le directeur) ; jamais modifiées par un changement de grille (H34) | `invoices` |
| 2d | **Encaissement** : espèces, mobile money saisi au guichet, virement, chèque ; affectation automatique à l'échéance la plus ancienne ; reçu numéroté en continu ; annulation par écriture inverse (demandée par le comptable, validée par le directeur, motif obligatoire) ; **validation automatique de l'inscription quand les frais d'inscription sont payés (A3)** | `payments`, `payment_allocations` |
| 2e | **Clôture de caisse** journalière par caissier (total par mode, montant compté, écart) ; **liste des impayés** par classe et par ancienneté | `cash_closures` *(nouvelle)* |
| 2f | **Documents** : worker de fond (pg-boss) et PDF par Playwright ; reçu PDF et ticket 80 mm avec QR code de vérification ; listes de classe, cartes scolaires, certificats de scolarité et de radiation | — |
| 2g | **Import Excel/CSV** : modèle fourni, rapport d'erreurs ligne par ligne, 1 000 élèves en moins de 2 minutes (test de performance) | — |

## Garanties (CLAUDE.md §6)

- Montants en FCFA entiers ; paiements jamais modifiés ni supprimés (la base l'interdit, comme pour
  `audit_logs`) ; toute opération d'argent dans une transaction ; tout paiement et toute annulation tracés.
- Numéro de reçu continu, sans trou, par école (compteur verrouillé dans la transaction du paiement).
- RLS sur chaque nouvelle table ; données médicales lisibles et modifiables par la direction seule (A4).
- Nouvelles actions ajoutées au tableau des droits : `students:*`, `payments:*` existent déjà ; ajout de
  `enrollments:validate`, `cash:close`, `invoices:discount`.

## Modèle de données : 2 tables à ajouter (27 → 29)

- `student_documents` : pièces jointes (acte de naissance, bulletins antérieurs) — clé de fichier, type, date.
- `cash_closures` : une clôture par caissier et par jour — totaux par mode, montant compté, écart, heure.

## Règles d'argent tranchées par le porteur (2026-11-21)

1. **Fratrie** : chaque école règle un pourcentage de réduction appliqué automatiquement à la scolarité à
   partir du 2e enfant inscrit dans l'école (0 % = aucune réduction).
2. **Trop-perçu** : refusé. Le caissier ne peut pas encaisser plus que le reste dû de l'année.
3. **Inscription en cours d'année** : toutes les tranches de l'année sont dues ; le directeur peut accorder une remise.
4. **Numéro de reçu** : repart à 1 chaque année scolaire, l'année dans le numéro (ex. `SJB-2026-00001`).

## Hypothèses par défaut (ajoutées à `docs/hypotheses.md` si le plan est validé)

- Matricule : l'année « AA » est celle de la première inscription dans l'école (A6).
- Affectation d'un paiement : échéance la plus ancienne d'abord ; à date égale, obligatoire avant facultatif.
- Départ d'un élève : les échéances à venir non payées sont annulées (statut, jamais supprimées) ; ce qui
  est déjà payé reste acquis.
- Annulation d'un paiement : tant que le directeur n'a pas validé, le paiement compte normalement.
- Clôture : une fois faite, plus aucun encaissement ce jour-là pour ce caissier (réouverture par le directeur, tracée).
