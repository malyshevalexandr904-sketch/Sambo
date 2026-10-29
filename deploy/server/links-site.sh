#!/usr/bin/env bash
# Страница соцсетей на отдельном домене (deploy/links): bash /opt/sambo/deploy/server/links-site.sh digitalsambo.online
# Домен и его www перестают перенаправлять на основной сайт и показывают страницу соцсетей (HTTPS выпускает Caddy).
# Вернуть перенаправление: bash /opt/sambo/deploy/server/links-site.sh --off digitalsambo.online
# Правит LINKS_SITES и REDIRECT_SITES в .env и перезапускает только Caddy — сайт платформы не останавливается.
set -Eeuo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$DIR/.env"
COMPOSE=(docker compose --project-directory "$DIR" -f "$DIR/compose.yml")

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
fail() {
  printf '\n\033[1;31mОшибка: %s\033[0m\n' "$*" >&2
  exit 1
}

env_get() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- || true; }
env_set() {
  if grep -q "^$1=" "$ENV_FILE"; then
    sed -i "s/^$1=.*/$1=$2/" "$ENV_FILE"
  else
    echo "$1=$2" >>"$ENV_FILE"
  fi
}
normalize() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's#^https?://##; s#/.*$##; s#^www\.##'; }
# Список «a, b, c» без адресов $2 и www.$2.
without() {
  local out="" h
  IFS=', ' read -ra items <<<"$1"
  for h in "${items[@]}"; do
    [ -z "$h" ] || [ "$h" = "$2" ] || [ "$h" = "www.$2" ] || out+="${out:+, }$h"
  done
  printf '%s' "$out"
}

off=0
if [ "${1:-}" = "--off" ]; then
  off=1
  shift
fi
[ "$(id -u)" -eq 0 ] || fail "запустите от root (или через sudo)."
[ -f "$ENV_FILE" ] || fail "нет $ENV_FILE — сначала установка: bash $DIR/install.sh <домен>"
[ -f "$DIR/../links/index.html" ] || fail "нет страницы $DIR/../links/index.html — обновите код: git -C /opt/sambo pull"

d="$(normalize "${1:-}")"
[[ "$d" =~ ^([a-z0-9-]+\.)+[a-z0-9-]{2,}$ ]] || fail "укажите домен, например: bash $0 digitalsambo.online"
[ "$d" != "$(env_get DOMAIN)" ] || fail "$d — основной домен платформы, его нельзя отдать под страницу соцсетей."

links="$(without "$(env_get LINKS_SITES)" "$d")"
redirect="$(without "$(env_get REDIRECT_SITES)" "$d")"
if ((off)); then
  redirect+="${redirect:+, }$d, www.$d"
else
  links+="${links:+, }$d, www.$d"
fi

step "Настройки → $ENV_FILE"
env_set LINKS_SITES "$links"
env_set REDIRECT_SITES "$redirect"
note "Страница соцсетей: ${links:-нет}"
note "Перенаправление на основной сайт: ${redirect:-нет}"

step "Перезапуск Caddy (сайт платформы продолжает работать)"
"${COMPOSE[@]}" up -d caddy

if ((off)); then
  step "Готово: https://$d снова перенаправляет на https://$(env_get DOMAIN)"
  exit 0
fi

step "Проверка https://$d"
# Сертификат Let's Encrypt для нового сайта Caddy получает сам, обычно за несколько секунд.
for _ in $(seq 1 12); do
  if curl -fsS --max-time 10 -o /dev/null "https://$d/"; then
    step "Готово: https://$d — страница соцсетей"
    exit 0
  fi
  sleep 5
done
note "Страница пока не открылась — сертификат может выпускаться ещё пару минут. Откройте https://$d в браузере."
note "Если не откроется и через 10 минут, пришлите вывод команды:"
note "  docker compose -f $DIR/compose.yml logs --tail 50 caddy"
