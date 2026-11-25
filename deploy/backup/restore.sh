#!/bin/sh
# Restauration complète (base + fichiers) depuis une sauvegarde. REMPLACE les données actuelles.
#   restore.sh [instantané|latest] --confirmer
# Avant : arrêter l'application et le worker (docker compose ... stop app worker).
# Après : pnpm storage:check dans le conteneur app, puis redémarrer (le service migrate applique
# les migrations plus récentes que la sauvegarde). Voir docs/exploitation.md.
set -eu
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY manquant}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD manquant (clé de chiffrement des sauvegardes)}"
: "${PGPASSWORD:?PGPASSWORD manquant}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD manquant}"
export PGHOST="${PGHOST:-db}" PGUSER="${PGUSER:-postgres}"
DB="${PGDATABASE:-gestion_scolaire}"
HOST_TAG="${BACKUP_HOST:-gestion-scolaire}"

snapshot="latest"
confirmed=no
for arg in "$@"; do
  case "$arg" in
    --confirmer) confirmed=yes ;;
    *) snapshot="$arg" ;;
  esac
done
log() { echo "[restauration] $*"; }

if [ "$confirmed" != yes ]; then
  log "ATTENTION : la base « $DB » et les fichiers actuels seront REMPLACÉS par la sauvegarde « $snapshot »."
  log "Relancer avec --confirmer pour continuer. Sauvegardes disponibles :"
  restic snapshots --host "$HOST_TAG"
  exit 1
fi

active=$(psql -d postgres -Atc "select count(*) from pg_stat_activity where usename = 'app_user'")
if [ "$active" != "0" ]; then
  log "REFUS : l'application ou le worker est encore connecté ($active connexion(s))."
  log "Arrêter d'abord : docker compose ... stop app worker"
  exit 1
fi

RESTORE=/restore
rm -rf "$RESTORE" && mkdir -p "$RESTORE"
log "récupération de la sauvegarde « $snapshot »…"
if [ "$snapshot" = latest ]; then
  restic restore latest --host "$HOST_TAG" --target "$RESTORE"
else
  restic restore "$snapshot" --target "$RESTORE"
fi
test -f "$RESTORE/work/gestion_scolaire.dump" || { log "sauvegarde sans copie de la base"; exit 1; }

log "base « $DB » recréée…"
psql -v ON_ERROR_STOP=1 -d postgres -q <<SQL
DROP DATABASE IF EXISTS "$DB" WITH (FORCE);
CREATE DATABASE "$DB";
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END \$\$;
ALTER ROLE app_user LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '$(printf %s "$APP_DB_PASSWORD" | sed "s/'/''/g")';
GRANT CONNECT ON DATABASE "$DB" TO app_user;
SQL
pg_restore --exit-on-error --no-password -d "$DB" "$RESTORE/work/gestion_scolaire.dump"

log "fichiers remplacés…"
mkdir -p /data/storage
find /data/storage -mindepth 1 -delete
if [ -d "$RESTORE/data/storage" ]; then cp -a "$RESTORE/data/storage/." /data/storage/; fi
# Les fichiers appartiennent au compte de l'application (« node », uid 1000), lisibles par lui seul.
chown -R 1000:1000 /data/storage
chmod 700 /data/storage
files=$(find /data/storage -type f | wc -l)
rm -rf "$RESTORE"

log "terminée : base restaurée, ${files} fichier(s)."
log "Empreinte des données (à comparer si besoin) :"
psql -d "$DB" -At -f /usr/local/bin/backup/fingerprint.sql
log "Ensuite : vérifier les fichiers (storage-check), puis redémarrer app et worker."
