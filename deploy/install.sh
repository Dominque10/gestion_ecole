#!/usr/bin/env bash
# Installation sur un serveur vide (mise en service, Sf). Voir docs/exploitation.md, chapitre 1.
# À lancer en root, depuis le dossier du dépôt cloné :
#   sudo bash deploy/install.sh
# Options :
#   --skip-system       ne touche pas au système (Docker, pare-feu, swap déjà en place ; utilisé par la CI)
#   --non-interactive   aucune question : les réponses viennent des variables d'environnement
#                       (APP_DOMAIN, ACME_EMAIL, DEMO_SITE, BACKUP_REPOSITORY, SUPERADMIN_EMAIL…)
# Le script peut être relancé : il garde le fichier .env.production existant et ses secrets.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=.env.production
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE")
if [ -n "${COMPOSE_EXTRA_FILE:-}" ]; then
  COMPOSE=(docker compose -f docker-compose.prod.yml -f "$COMPOSE_EXTRA_FILE" --env-file "$ENV_FILE")
fi
SKIP_SYSTEM=no
INTERACTIVE=yes
for arg in "$@"; do
  case "$arg" in
    --skip-system) SKIP_SYSTEM=yes ;;
    --non-interactive) INTERACTIVE=no ;;
    *) echo "Option inconnue : $arg" >&2; exit 1 ;;
  esac
done

step() { echo; echo "=== $* ==="; }
fail() { echo "ERREUR : $*" >&2; exit 1; }
started=$(date +%s)

# Pose une question (valeur par défaut entre crochets) ; en mode non interactif, lit la variable.
ask() {
  local var="$1" question="$2" default="${3:-}" answer
  if [ "$INTERACTIVE" = no ]; then
    answer="${!var:-$default}"
  else
    read -r -p "$question${default:+ [$default]} : " answer
    answer="${answer:-$default}"
  fi
  printf -v "$var" '%s' "$answer"
}
ask_secret() {
  local var="$1" question="$2" answer
  if [ "$INTERACTIVE" = no ]; then
    answer="${!var:-}"
  else
    read -r -s -p "$question : " answer
    echo
  fi
  printf -v "$var" '%s' "$answer"
}

# --- 1. Système : Docker, pare-feu, mémoire ---
if [ "$SKIP_SYSTEM" = no ]; then
  [ "$(id -u)" -eq 0 ] || fail "lancer en root : sudo bash deploy/install.sh"
  step "1/6 Système"
  if ! command -v docker > /dev/null; then
    echo "Installation de Docker (dépôt officiel)…"
    curl -fsSL https://get.docker.com | sh
  fi
  docker compose version > /dev/null || fail "Docker Compose absent"
  if command -v ufw > /dev/null; then
    ufw allow OpenSSH > /dev/null
    ufw allow 80/tcp > /dev/null
    ufw allow 443/tcp > /dev/null
    ufw --force enable > /dev/null
    echo "Pare-feu : seuls SSH, HTTP et HTTPS sont ouverts."
  fi
  # La construction de l'application demande de la mémoire : swap de 2 Go sous 4 Go de RAM.
  ram_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  if [ "$ram_mb" -lt 3800 ] && [ -z "$(swapon --show)" ]; then
    echo "Mémoire : ${ram_mb} Mo, ajout d'un fichier d'échange de 2 Go."
    fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile > /dev/null && swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
else
  step "1/6 Système (ignoré : --skip-system)"
fi

# --- 2. Réglages et secrets ---
step "2/6 Réglages ($ENV_FILE)"
NEW_BACKUP_KEY=""
if [ -f "$ENV_FILE" ]; then
  echo "$ENV_FILE existe déjà : il est conservé (secrets inchangés)."
else
  command -v openssl > /dev/null || fail "openssl absent (apt install openssl)"
  ask APP_DOMAIN "Nom de domaine du site (ex. ecole.exemple.cg)"
  [ -n "$APP_DOMAIN" ] || fail "nom de domaine obligatoire"
  ask ACME_EMAIL "Adresse e-mail des alertes (certificat HTTPS)"
  [ -n "$ACME_EMAIL" ] || fail "adresse e-mail obligatoire"
  ask DEMO_SITE "Site de démonstration public, école fictive remise à neuf chaque nuit (true/false)" "false"
  [[ "$DEMO_SITE" =~ ^(true|false)$ ]] || fail "répondre true ou false"
  if [ "$DEMO_SITE" = true ]; then
    DEMO_MODE=true
  else
    ask DEMO_MODE "Mode démonstration, faux paiements et faux SMS (true/false)" "true"
  fi
  ask BACKUP_REPOSITORY "Dépôt des sauvegardes B2 (s3:https://…/<bucket>/gestion-scolaire)"
  [ -n "$BACKUP_REPOSITORY" ] || fail "dépôt des sauvegardes obligatoire"
  ask BACKUP_ACCESS_KEY_ID "Clé d'application B2 : keyID" ""
  ask_secret BACKUP_SECRET_ACCESS_KEY "Clé d'application B2 : applicationKey (masquée)"
  ask BACKUP_PING_URL "Adresse Healthchecks.io (vide pour plus tard)" ""
  # Mots de passe en hexadécimal : utilisables tels quels dans les adresses de connexion.
  POSTGRES_PASSWORD=$(openssl rand -hex 24)
  APP_DB_PASSWORD=$(openssl rand -hex 24)
  AUTH_SECRET=$(openssl rand -base64 32)
  PAYMENT_WEBHOOK_SECRET=$(openssl rand -hex 32)
  # Clé des sauvegardes : 32 caractères en groupes de 4, facile à recopier sur papier.
  NEW_BACKUP_KEY=$(openssl rand -hex 16 | sed 's/.\{4\}/&-/g; s/-$//')
  BACKUP_PASSWORD="${BACKUP_PASSWORD:-$NEW_BACKUP_KEY}"
  NEW_BACKUP_KEY="$BACKUP_PASSWORD"
  umask 077
  cat > "$ENV_FILE" <<EOF
# Créé par deploy/install.sh le $(date -u +%Y-%m-%d). Voir .env.production.example pour chaque réglage.
APP_DOMAIN=$APP_DOMAIN
ACME_EMAIL=$ACME_EMAIL
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
APP_DB_PASSWORD=$APP_DB_PASSWORD
AUTH_SECRET=$AUTH_SECRET
DEMO_MODE=$DEMO_MODE
DEMO_SITE=$DEMO_SITE
$( [ "$DEMO_SITE" = true ] && echo "COMPOSE_PROFILES=demo" )
PAYMENT_PROVIDER=fake
PAYMENT_WEBHOOK_SECRET=$PAYMENT_WEBHOOK_SECRET
SMS_PROVIDER=fake
WHATSAPP_PROVIDER=fake
BACKUP_REPOSITORY=$BACKUP_REPOSITORY
BACKUP_ACCESS_KEY_ID=$BACKUP_ACCESS_KEY_ID
BACKUP_SECRET_ACCESS_KEY=$BACKUP_SECRET_ACCESS_KEY
BACKUP_PASSWORD=$BACKUP_PASSWORD
BACKUP_TIME=02:30
BACKUP_PING_URL=$BACKUP_PING_URL
APP_VERSION=$(date -u +%Y%m%d)
EOF
  chmod 600 "$ENV_FILE"
  echo "$ENV_FILE créé (lecture par root seul)."
fi
APP_DOMAIN=$(grep '^APP_DOMAIN=' "$ENV_FILE" | cut -d= -f2-)

# --- 3. Construction et démarrage ---
step "3/6 Construction des images et démarrage (10 à 20 minutes la première fois)"
"${COMPOSE[@]}" build
"${COMPOSE[@]}" up -d

# --- 4. Vérification de l'état du service ---
step "4/6 Vérification du service"
healthy=no
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T app node -e \
    "fetch('http://localhost:3000/api/v1/health').then(r=>r.json()).then(j=>process.exit(j.status==='ok'?0:1)).catch(()=>process.exit(1))" \
    2> /dev/null; then
    healthy=yes
    break
  fi
  sleep 5
done
if [ "$healthy" != yes ]; then
  "${COMPOSE[@]}" ps
  "${COMPOSE[@]}" exec -T app node -e \
    "fetch('http://localhost:3000/api/v1/health').then(r=>r.text()).then(console.log)" || true
  fail "le service n'est pas en bon état (voir « ${COMPOSE[*]} logs »)"
fi
echo "Base, file d'attente, worker, fichiers et disque : ok."

# --- 5. Compte super-administrateur ---
step "5/6 Compte super-administrateur de la plateforme"
ask SUPERADMIN_EMAIL "Adresse e-mail du super-administrateur"
ask SUPERADMIN_NAME "Nom et prénom du super-administrateur" "Administrateur"
if [ -n "$SUPERADMIN_EMAIL" ]; then
  if [ "$INTERACTIVE" = yes ]; then
    "${COMPOSE[@]}" run --rm app node scripts/create-superadmin.mts \
      --email "$SUPERADMIN_EMAIL" --name "$SUPERADMIN_NAME"
  else
    "${COMPOSE[@]}" run --rm -T -e SUPERADMIN_PASSWORD="${SUPERADMIN_PASSWORD:?SUPERADMIN_PASSWORD manquant}" \
      app node scripts/create-superadmin.mts --email "$SUPERADMIN_EMAIL" --name "$SUPERADMIN_NAME"
  fi
else
  echo "Ignoré (aucune adresse). Plus tard : ${COMPOSE[*]} run --rm app node scripts/create-superadmin.mts --email … --name …"
fi

# --- 6. Première sauvegarde (vérifie l'accès au dépôt B2 et la clé) ---
step "6/6 Première sauvegarde"
# Dépôt contenant déjà des sauvegardes (nouveau serveur avant une restauration) : surtout ne pas en
# ajouter une de cette base vide, qui deviendrait « la plus récente » (docs/exploitation.md, 3.2).
existing=$("${COMPOSE[@]}" run --rm -T backup sh -c \
  'restic snapshots --host "${BACKUP_HOST:-gestion-scolaire}" --json 2> /dev/null || echo "[]"' | tail -n 1)
if [[ "$existing" == *'"short_id"'* ]]; then
  echo "Le dépôt contient déjà des sauvegardes : pas de première sauvegarde."
  echo "Pour restaurer la dernière : docs/exploitation.md, chapitre 3.2."
  "${COMPOSE[@]}" run --rm -T backup snapshots
else
  "${COMPOSE[@]}" run --rm -T backup backup
fi

elapsed=$(( $(date +%s) - started ))
echo
echo "=== Installation terminée en $(( elapsed / 60 )) min $(( elapsed % 60 )) s ==="
echo "Site : https://$APP_DOMAIN"
if grep -q '^DEMO_SITE=true' "$ENV_FILE"; then
  echo "Site de démonstration : l'école fictive se crée en une minute environ (« ${COMPOSE[*]} logs demo »)."
  echo "Comptes affichés sur la page de connexion ; remise à neuf chaque nuit à 03:30."
fi
if [ -n "$NEW_BACKUP_KEY" ]; then
  cat <<EOF

  ┌───────────────────────────────────────────────────────────────────┐
  │ CLÉ DE CHIFFREMENT DES SAUVEGARDES (à recopier maintenant)        │
  │                                                                   │
  │   $NEW_BACKUP_KEY                         │
  │                                                                   │
  │ 1. La ranger dans votre gestionnaire de mots de passe.            │
  │ 2. La recopier sur papier, sous enveloppe, dans un lieu sûr.      │
  │ Sans elle, AUCUNE restauration n'est possible (décision D33).     │
  └───────────────────────────────────────────────────────────────────┘
EOF
fi
echo
echo "Ensuite : supervision (UptimeRobot, Healthchecks.io), voir docs/exploitation.md, chapitre 6."
