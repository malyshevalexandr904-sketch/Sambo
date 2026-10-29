#!/usr/bin/env bash
# Тестовые спортсмены для пробного турнира (packages/db/scripts/test-athletes.ts): 40 вымышленных юношей и девушек
# 2012 г. р. в организации пользователя, с разрядами и согласиями. Нет у пользователя клуба — создаётся «Тестовый клуб»,
# пользователь в нём руководитель и тренер; удаление убирает и его.
#   bash /opt/sambo/deploy/server/test-athletes.sh add <email>           — предпросмотр, база не меняется;
#   bash /opt/sambo/deploy/server/test-athletes.sh add <email> --apply   — резервная копия и добавление;
#   bash /opt/sambo/deploy/server/test-athletes.sh enter <email> "<часть названия турнира>" [--apply]
#                                                 — заявка всех тестовых спортсменов на турнир с плановым весом;
#   bash /opt/sambo/deploy/server/test-athletes.sh remove [--apply]      — удаление всех тестовых спортсменов и тестового клуба.
# Если организаций у пользователя несколько — добавьте --org <часть названия>. Скрипт берётся из образа migrate:
# после обновления кода сначала update.sh.
set -Eeuo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE=(docker compose --project-directory "$DIR" -f "$DIR/compose.yml")

[ -f "$DIR/.env" ] || {
  echo "Нет $DIR/.env — это не сервер SAMBO (сначала install.sh)" >&2
  exit 1
}
case " $* " in
  *' --apply '*)
    printf '\n\033[1;34m==> Резервная копия\033[0m\n'
    bash "$DIR/backup.sh"
    ;;
esac
printf '\n\033[1;34m==> Тестовые спортсмены\033[0m\n'
if [ "${1:-}" = enter ]; then
  shift
  # Заявка идёт через сервисы API (apps/api/scripts/test-athletes-enter.ts); плановый вес — из списка спортсменов.
  "${COMPOSE[@]}" run --rm --no-deps -T migrate sh -c \
    './node_modules/.bin/tsx scripts/test-athletes.ts plan | (cd /repo/apps/api && node -r @swc-node/register scripts/test-athletes-enter.ts "$@")' \
    sh "$@"
else
  "${COMPOSE[@]}" run --rm --no-deps -T migrate ./node_modules/.bin/tsx scripts/test-athletes.ts "$@"
fi
