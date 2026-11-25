#!/bin/sh
# cron    : sauvegarde chaque nuit à BACKUP_TIME (heure de Brazzaville, 02:30 par défaut)
# backup  : sauvegarde immédiate          restore [instantané] --confirmer : restauration
# snapshots : liste des sauvegardes disponibles
set -eu
case "${1:-cron}" in
  cron)
    time="${BACKUP_TIME:-02:30}"
    hour="${time%%:*}"; minute="${time##*:}"; hour="${hour#0}"; minute="${minute#0}"
    echo "${minute:-0} ${hour:-0} * * * /usr/local/bin/backup/backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
    echo "[sauvegarde] planifiée chaque jour à ${time} (${TZ:-UTC})"
    exec crond -f -l 8
    ;;
  backup) exec backup.sh ;;
  restore) shift; exec restore.sh "$@" ;;
  snapshots) exec restic snapshots --host "${BACKUP_HOST:-gestion-scolaire}" ;;
  *) exec "$@" ;;
esac
