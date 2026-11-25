#!/usr/bin/env bash
# Mise à jour vers la dernière version (mise en service, Sf). Voir docs/exploitation.md, chapitre 2.
#   sudo bash deploy/update.sh            dernière version de la branche main
#   sudo bash deploy/update.sh <commit>   une version précise (ou un retour en arrière du code)
# Étapes : sauvegarde immédiate, récupération du code, construction, redémarrage (le service migrate
# applique les migrations), vérification de l'état du service.
set -euo pipefail

# Le code (et ce script) est remplacé pendant la mise à jour : on tourne depuis une copie.
if [ -z "${GS_UPDATE_COPY:-}" ]; then
  copy=$(mktemp)
  cp "$0" "$copy"
  GS_UPDATE_COPY=1 GS_UPDATE_DIR="$(cd "$(dirname "$0")/.." && pwd)" exec bash "$copy" "$@"
fi
cd "$GS_UPDATE_DIR"
ENV_FILE=.env.production
[ -f "$ENV_FILE" ] || { echo "ERREUR : $ENV_FILE absent (installer d'abord : deploy/install.sh)" >&2; exit 1; }
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE")
if [ -n "${COMPOSE_EXTRA_FILE:-}" ]; then
  COMPOSE=(docker compose -f docker-compose.prod.yml -f "$COMPOSE_EXTRA_FILE" --env-file "$ENV_FILE")
fi
target="${1:-origin/main}"
step() { echo; echo "=== $* ==="; }

step "1/5 Sauvegarde avant mise à jour"
"${COMPOSE[@]}" run --rm -T backup backup

step "2/5 Récupération du code ($target)"
before=$(git rev-parse --short HEAD)
git fetch --quiet origin
git checkout --quiet --detach "$target"
after=$(git rev-parse --short HEAD)
echo "Version : $before → $after"
sed -i "s/^APP_VERSION=.*/APP_VERSION=$after/" "$ENV_FILE"

step "3/5 Construction des images"
"${COMPOSE[@]}" build

step "4/5 Redémarrage (migrations appliquées par le service migrate)"
"${COMPOSE[@]}" up -d

step "5/5 Vérification du service"
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T app node -e \
    "fetch('http://localhost:3000/api/v1/health').then(r=>r.json()).then(j=>process.exit(j.status==='ok'?0:1)).catch(()=>process.exit(1))" \
    2> /dev/null; then
    docker image prune -f > /dev/null
    echo "Mise à jour terminée : version $after, service en bon état."
    exit 0
  fi
  sleep 5
done
"${COMPOSE[@]}" ps
echo "ERREUR : le service n'est pas en bon état après la mise à jour." >&2
echo "Revenir à la version précédente : sudo bash deploy/update.sh $before" >&2
echo "(si une migration a abîmé les données : restauration, docs/exploitation.md, chapitre 3)" >&2
exit 1
