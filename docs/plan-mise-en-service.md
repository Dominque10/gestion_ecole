# Plan — Mise en service de la V1 (hébergement, sauvegardes, supervision, exploitation)

> Statut : **à valider** par le porteur du projet.
> Contexte : la V1 est entièrement codée (M1 à M7, jalon technique de la Phase 4 validé, D29). Pour accueillir une
> école pilote, il faut un serveur réel, sûr, sauvegardé et surveillé, qu'une personne puisse installer et mettre à
> jour en suivant un guide. Cette étape n'ajoute **aucune fonction métier** (CLAUDE.md §3).

Jalon de sortie proposé :
- à partir d'un serveur vide, l'installation complète en suivant le guide prend **moins d'une heure** ;
- une **sauvegarde est restaurée avec succès** sur un serveur neuf (test réel, chronométré) ;
- l'application répond en **HTTPS** sur le nom de domaine, avec la note A ou mieux au test SSL Labs ;
- tous les tests restent au vert, et la CI construit et vérifie les images Docker.

## Ce qui existe déjà

- Application, worker (pg-boss, PDF avec Chromium), migrations, scripts `db:setup`, `superadmin:create`,
  `password:reset`.
- CI GitHub Actions : formatage, lint, tests unitaires, d'intégration et E2E.
- Stockage des fichiers derrière une interface (`src/server/storage/`), disque local pour l'instant.
- Cookies de session `secure` en production ; RLS forcée sur toutes les tables d'école.

## Ce qui manque

| Manque | Risque si on part sans |
|---|---|
| Images Docker de l'app et du worker, Compose de production | installation à la main, non reproductible |
| Proxy HTTPS (certificats automatiques) | mots de passe et codes SMS en clair sur le réseau |
| En-têtes de sécurité (HSTS, CSP, anti-cadre) | attaques par le navigateur (clickjacking, injection) |
| Garde-fou : refus de démarrer en production avec un faux prestataire ou un secret manquant | parents qui « paient » sans que l'argent arrive |
| Route de santé (`/api/v1/health`) et contrôle du worker | panne silencieuse (SMS, PDF, paiements bloqués) |
| Sauvegardes chiffrées, copiées hors du serveur, restauration testée | perte des notes et des paiements d'une école |
| Guide d'exploitation | dépendance à une seule personne |

Contrainte : Docker ne tourne pas sur ce PC (virtualisation désactivée). Les images sont donc **construites et
testées par la CI GitHub** (Docker y est disponible) : un démarrage complet avec Compose, puis un test de bout en
bout contre les conteneurs.

## Sous-étapes

| # | Contenu | Vérification |
|---|---|---|
| Sa | **Images Docker** : app (Next.js en mode `standalone`) et worker (avec Chromium pour les PDF), utilisateur non-root ; `docker-compose.prod.yml` : app, worker, PostgreSQL 16, proxy HTTPS ; migrations lancées par un service à part avant l'app | CI : construction des images, démarrage avec Compose, test E2E contre les conteneurs |
| Sb | **Garde-fous de production** : vérification des variables d'environnement au démarrage (Zod) ; refus des faux prestataires en production sauf mode « démonstration » explicite (bandeau visible) ; en-têtes de sécurité ; route `/api/v1/health` (base, file d'attente, dernier passage du worker) | tests unitaires et d'intégration |
| Sc | **Stockage des fichiers** en production (logos, photos, pièces, PDF) : volume disque sauvegardé, ou stockage compatible S3 (question 3) | tests du stockage |
| Sd | **Sauvegardes** : base (`pg_dump`) et fichiers chaque nuit, chiffrées, conservées 30 jours (7 quotidiennes, 4 hebdomadaires, 12 mensuelles), copiées hors du serveur ; script de **restauration** | restauration complète testée en CI sur une base neuve, comptes et montants identiques |
| Se | **Supervision** : surveillance externe de `/api/v1/health` ; alerte si le worker ne tourne plus, si une sauvegarde échoue, si le disque se remplit ; journaux de l'app et du worker conservés 30 jours | panne simulée → alerte reçue |
| Sf | **Guide d'exploitation** (`docs/exploitation.md`) : installation pas à pas, mise à jour (avec migrations), restauration, création d'une école et de son directeur, renouvellement des secrets, que faire en cas de panne ; script d'installation | installation chronométrée sur un serveur vide (jalon) |
| Sg | **Environnement de démonstration** (facultatif) : même installation avec faux prestataires et données d'exemple, pour montrer l'application aux directeurs avant le pilote | — |

Ordre proposé : Sa → Sb → Sc → Sd → Se → Sf, puis Sg si tu le souhaites.

## Questions à trancher avant le code

1. **Hébergement (B6)** : serveur à l'étranger (VPS en Europe, ex. Hetzner ou OVH, ~10 à 20 €/mois, fiable, latence
   ~150 ms depuis Brazzaville) ou au Congo (latence plus faible, données sur place ; offre et fiabilité à vérifier) ?
   Point à vérifier de ton côté : la loi congolaise sur les données personnelles impose-t-elle un stockage au Congo ?
2. **Nom de domaine (B1)** : nom du produit et domaine (`.cg` ou `.com`) ? Le plan peut avancer sans, avec un
   domaine provisoire.
3. **Fichiers** : volume disque sur le serveur, sauvegardé avec la base (le plus simple pour démarrer), ou stockage
   compatible S3 (plus robuste, coût en plus) ?
4. **Copie des sauvegardes hors du serveur** : vers un stockage objet chez un autre fournisseur (recommandé) ?
5. **Alertes** : par e-mail, par SMS, ou par WhatsApp ? À quelle(s) personne(s) ?
6. **Démonstration** : veux-tu l'environnement de démonstration (Sg) ?

## Ce qui reste hors de cette étape

- Vrais prestataires SMS/WhatsApp et paiement mobile (B4, B5) : ils demandent des comptes et des contrats. L'interface
  est prête ; tant qu'ils manquent, la production refusera de démarrer avec un faux prestataire, sauf en mode
  démonstration.
- Prix de l'abonnement (B8), commercialisation.
- Les tests avec de vraies personnes (parent sans aide, vrais bulletins) : au pilote.
