#!/usr/bin/env bash
# Удаление учебных (вымышленных) турниров, учётных записей, организаций и спортсменов, которые install.sh загрузил
# при установке: bash /opt/sambo/deploy/server/remove-demo-data.sh — только отчёт, база не меняется;
# с --apply — резервная копия (backup.sh), удаление, перезапуск api и worker. Что считается учебным и что остаётся —
# в начале remove-demo-data.sql. Повторный запуск безопасен: удалять уже нечего.
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
  step "Резервная копия перед удалением"
  bash "$DIR/backup.sh"
  step "Удаление учебных данных"
else
  step "Предпросмотр: что будет удалено (база не меняется)"
fi
"${COMPOSE[@]}" exec -T postgres psql -X -U sde -d sde -v apply="$apply" -f - <"$DIR/remove-demo-data.sql" 2>&1 |
  sed -E 's/^(psql:[^ ]+ )?(NOTICE|ERROR):  //'

if $apply; then
  # install.sh не загрузит учебные данные снова, даже если запустить его повторно.
  grep -q '^DEMO_DATA_REMOVED=' "$ENV_FILE" || echo "DEMO_DATA_REMOVED=$(date '+%Y-%m-%d')" >>"$ENV_FILE"
  step "Перезапуск api и worker"
  "${COMPOSE[@]}" restart api worker
  step "Готово"
  echo "Если что-то пошло не так, база восстанавливается из резервной копии выше (docs/DEPLOYMENT.md, «Восстановление базы»)."
else
  echo
  echo "Чтобы удалить: bash $0 --apply"
fi
