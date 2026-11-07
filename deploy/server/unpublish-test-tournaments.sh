#!/usr/bin/env bash
# Снятие с публикации всех тестовых турниров (правки 07.11.2026, п. 5):
# bash /opt/sambo/deploy/server/unpublish-test-tournaments.sh — только список турниров, база не меняется;
# с --apply — резервная копия (backup.sh), мягкое удаление всех турниров, перезапуск api и worker.
# Подробности — в начале unpublish-test-tournaments.sql. Повторный запуск безопасен: снимать уже нечего.
set -Eeuo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE=(docker compose --project-directory "$DIR" -f "$DIR/compose.yml")
ENV_FILE="$DIR/.env"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
trap 'printf "\n\033[1;31mОшибка в строке %s. База не изменена.\033[0m\n" "$LINENO" >&2' ERR

case "${1:-}" in
  '') apply=false ;;
  --apply) apply=true ;;
  *)
    echo "Использование: bash $0 [--apply]" >&2
    exit 2
    ;;
esac
[ -f "$ENV_FILE" ] || {
  echo "Нет $ENV_FILE — это не сервер SAMBO (сначала install.sh)" >&2
  exit 1
}

if $apply; then
  step "Резервная копия перед снятием турниров"
  bash "$DIR/backup.sh"
  step "Снятие турниров с публикации"
else
  step "Предпросмотр: какие турниры будут сняты (база не меняется)"
fi
"${COMPOSE[@]}" exec -T postgres psql -X -U sde -d sde -v apply="$apply" -f - <"$DIR/unpublish-test-tournaments.sql" 2>&1 |
  sed -E 's/^(psql:[^ ]+ )?(NOTICE|ERROR):  //'

if $apply; then
  step "Перезапуск api и worker"
  "${COMPOSE[@]}" restart api worker
  step "Готово"
  echo "Если что-то пошло не так, база восстанавливается из резервной копии выше (docs/DEPLOYMENT.md, «Восстановление базы»)."
else
  echo
  echo "Чтобы снять турниры: bash $0 --apply"
fi
