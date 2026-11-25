#!/bin/sh
# Sauvegarde de la base et des fichiers, chiffrée, copiée hors du serveur (décision D33).
# Rétention : 7 quotidiennes, 4 hebdomadaires, 12 mensuelles. État de la dernière sauvegarde dans
# /status/last.json (lu par la supervision, Se).
set -euo pipefail
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY manquant}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD manquant (clé de chiffrement des sauvegardes)}"
: "${PGPASSWORD:?PGPASSWORD manquant}"
export PGHOST="${PGHOST:-db}" PGUSER="${PGUSER:-postgres}" PGDATABASE="${PGDATABASE:-gestion_scolaire}"
HOST_TAG="${BACKUP_HOST:-gestion-scolaire}"
WORK=/work
STATUS=/status/last.json
mkdir -p "$WORK" /status

log() { echo "[sauvegarde] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }
step=""
finish() {
  code=$?
  rm -f "$WORK/gestion_scolaire.dump"
  if [ "$code" -ne 0 ]; then
    log "ÉCHEC à l'étape : $step"
    printf '{"status":"failed","at":"%s","step":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$step" > "$STATUS"
  fi
}
trap finish EXIT

started=$(date +%s)
step="dépôt de sauvegarde"
if ! restic cat config > /dev/null 2>&1; then
  log "premier passage : création du dépôt chiffré"
  restic init
fi

step="copie de la base (pg_dump)"
pg_dump --format=custom --no-password --file "$WORK/gestion_scolaire.dump"

step="envoi chiffré (restic backup)"
restic backup --host "$HOST_TAG" --tag nightly --json "$WORK/gestion_scolaire.dump" /data/storage \
  | tail -n 1 > "$WORK/summary.json"
snapshot=$(sed -n 's/.*"snapshot_id":"\([0-9a-f]*\)".*/\1/p' "$WORK/summary.json")
rm -f "$WORK/summary.json"

step="rétention (restic forget)"
restic forget --host "$HOST_TAG" --tag nightly \
  --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune

# Le dimanche : relecture d'une partie des données pour détecter une corruption du dépôt.
if [ "$(date +%u)" = "7" ]; then
  step="contrôle du dépôt (restic check)"
  restic check --read-data-subset=5%
fi

printf '{"status":"ok","at":"%s","snapshot":"%s","seconds":%s}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$snapshot" "$(( $(date +%s) - started ))" > "$STATUS"
log "terminée : instantané ${snapshot} en $(( $(date +%s) - started )) s"
