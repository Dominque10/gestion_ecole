# Image des sauvegardes (mise en service, Sd) : pg_dump de la même version que la base (16) et restic
# (chiffrement AES-256, déduplication, rétention), planifiés par crond.
FROM postgres:16-alpine
RUN apk add --no-cache restic tzdata
COPY backup.sh restore.sh entrypoint.sh fingerprint.sql /usr/local/bin/backup/
# Dossier des fichiers au nom du compte de l'application (« node », uid 1000) : si ce conteneur monte
# le volume en premier, Docker le crée avec ces droits et l'application peut toujours y écrire.
RUN chmod +x /usr/local/bin/backup/*.sh \
    && mkdir -p /data/storage && chown 1000:1000 /data/storage && chmod 700 /data/storage
ENV PATH=/usr/local/bin/backup:$PATH
ENTRYPOINT ["entrypoint.sh"]
CMD ["cron"]
