#!/usr/bin/env bash
# Обновление сервера до последней версии main: bash /opt/sambo/deploy/server/update.sh
# Скачивает изменения, пересобирает образы, применяет миграции и перезапускает сервисы. Данные сохраняются.
# Перед обновлением — резервная копия базы (backup.sh).
set -Eeuo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$DIR/../.." && pwd)"
COMPOSE=(docker compose --project-directory "$DIR" -f "$DIR/compose.yml")

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
trap 'printf "\n\033[1;31mОшибка в строке %s. Сайт продолжает работать на прежней версии, если сборка не дошла до перезапуска.\033[0m\n" "$LINENO" >&2' ERR

[ -f "$DIR/.env" ] || {
  echo "Нет $DIR/.env — сначала установка: bash $DIR/install.sh <домен>" >&2
  exit 1
}

step "Резервная копия перед обновлением"
bash "$DIR/backup.sh"

if [ "${1:-}" != "--no-pull" ]; then
  step "Новая версия из GitHub"
  git -C "$REPO" pull --ff-only
  git -C "$REPO" log -1 --format='    %h %s (%cd)' --date=format:'%d.%m.%Y %H:%M'
fi

step "Сборка"
"${COMPOSE[@]}" pull --ignore-buildable --quiet || echo "    (обновить готовые образы не удалось — работаем с уже скачанными)"
"${COMPOSE[@]}" build migrate api worker
"${COMPOSE[@]}" build web

step "Миграции и перезапуск"
"${COMPOSE[@]}" up -d --remove-orphans
docker image prune -f >/dev/null

step "Готово"
"${COMPOSE[@]}" ps --format 'table {{.Service}}\t{{.Status}}'
