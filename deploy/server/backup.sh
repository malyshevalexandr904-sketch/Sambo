#!/usr/bin/env bash
# Резервная копия базы и файлов: bash /opt/sambo/deploy/server/backup.sh (каждую ночь — /etc/cron.d/sambo-backup).
# Копии лежат на этом же сервере: от поломки диска они не спасают — включите и резервное копирование у хостинга.
# Восстановление — docs/DEPLOYMENT.md, «Сервер».
set -Eeuo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE=(docker compose --project-directory "$DIR" -f "$DIR/compose.yml")
BACKUP_DIR="${BACKUP_DIR:-/var/backups/sambo}"
KEEP_DAYS="${KEEP_DAYS:-14}"
ts="$(date +%Y%m%d-%H%M)"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# База: формат pg_dump custom (pg_restore), владелец схемы — со всеми таблицами и правами.
"${COMPOSE[@]}" exec -T postgres pg_dump -U sde -d sde -Fc >"$BACKUP_DIR/db-$ts.dump.part"
mv "$BACKUP_DIR/db-$ts.dump.part" "$BACKUP_DIR/db-$ts.dump"

# Файлы (документы, логотипы, протоколы) — содержимое хранилища MinIO.
"${COMPOSE[@]}" exec -T minio tar -C /bitnami/minio/data -czf - . >"$BACKUP_DIR/files-$ts.tar.gz.part"
mv "$BACKUP_DIR/files-$ts.tar.gz.part" "$BACKUP_DIR/files-$ts.tar.gz"

find "$BACKUP_DIR" -maxdepth 1 \( -name 'db-*.dump' -o -name 'files-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -name '*.part' -mmin +120 -delete
echo "$(date '+%Y-%m-%d %H:%M') резервная копия: $BACKUP_DIR/db-$ts.dump, files-$ts.tar.gz ($(du -sh "$BACKUP_DIR" | cut -f1) всего)"
