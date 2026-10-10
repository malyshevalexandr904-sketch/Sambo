#!/usr/bin/env bash
# Установка SAMBO на VPS (Ubuntu 22.04/24.04, Debian 12) — docs/DEPLOYMENT.md, раздел «Сервер».
#
#   apt-get update && apt-get install -y git
#   git clone https://github.com/malyshevalexandr904-sketch/Sambo.git /opt/sambo
#   bash /opt/sambo/deploy/server/install.sh <домен> [дополнительные домены…]
#
# Дополнительные домены (и их www) перенаправляют на основной: install.sh digitalsambo.ru digitalsambo.online
#
# Что делает: защита входа (только по ключу, если он добавлен; fail2ban), файл подкачки (для сборки), Docker, секреты этого сервера (.env), сборка образов, миграции,
# учебные данные (один раз, со своим паролем), запуск, ночные резервные копии. В конце печатает адреса и
# пароли и сохраняет их в /root/sambo-access.txt.
# Повторный запуск безопасен: секреты и данные сохраняются, сборка продолжается с кэша.
set -Eeuo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$DIR/.env"
ACCESS_FILE=/root/sambo-access.txt
COMPOSE=(docker compose --project-directory "$DIR" -f "$DIR/compose.yml")

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m!   %s\033[0m\n' "$*"; }
fail() {
  printf '\n\033[1;31mОшибка: %s\033[0m\n' "$*" >&2
  exit 1
}
trap 'fail "команда в строке $LINENO завершилась с ошибкой. Запустите установку ещё раз — она продолжит с того же места."' ERR

env_get() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- || true; }

# ---------------------------------------------------------------- проверки
[ "$(id -u)" -eq 0 ] || fail "запустите от root (или через sudo)."
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}" in
  ubuntu | debian) ;;
  *) fail "поддерживаются Ubuntu и Debian, а на сервере ${PRETTY_NAME:-неизвестная система}. Переустановите ОС в панели хостинга (Ubuntu 24.04)." ;;
esac

normalize() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's#^https?://##; s#/.*$##; s#^www\.##'; }
check_domain() {
  [[ "$1" =~ ^([a-z0-9-]+\.)+[a-z0-9-]{2,}$ ]] ||
    fail "«$1» не похоже на домен. Домен на кириллице укажите в виде xn--… (его показывает reg.ru)."
}

DOMAIN="$(normalize "${1:-}")"
if [ -z "$DOMAIN" ] && [ -f "$ENV_FILE" ]; then DOMAIN="$(env_get DOMAIN)"; fi
if [ -z "$DOMAIN" ]; then
  read -rp "Домен сайта (например, sambo-turnir.ru): " DOMAIN
  DOMAIN="$(normalize "$DOMAIN")"
fi
check_domain "$DOMAIN"

# Дополнительные домены: из аргументов, иначе — как при прошлой установке.
extra=()
for arg in "${@:2}"; do
  d="$(normalize "$arg")"
  check_domain "$d"
  [ "$d" = "$DOMAIN" ] || extra+=("$d")
done
if ((${#extra[@]} > 0)); then
  REDIRECT_SITES=""
  for d in "${extra[@]}"; do REDIRECT_SITES+="${REDIRECT_SITES:+, }$d, www.$d"; done
elif [ -f "$ENV_FILE" ]; then
  REDIRECT_SITES="$(env_get REDIRECT_SITES)"
else
  REDIRECT_SITES=""
fi

# ---------------------------------------------------------------- пакеты и подкачка
step "Системные пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git openssl qrencode cron iproute2 fail2ban >/dev/null

# Вход на сервер: при ключе в authorized_keys — только по ключу; fail2ban блокирует подбор паролей.
step "Защита входа на сервер"
if [ -s /root/.ssh/authorized_keys ] && command -v sshd >/dev/null 2>&1; then
  cat >/etc/ssh/sshd_config.d/10-sambo.conf <<'EOF_SSH'
# SAMBO install.sh: вход только по ключу (/root/.ssh/authorized_keys). Пароль root по-прежнему работает в консоли
# VNC панели хостинга. Вернуть вход по паролю: удалить этот файл и выполнить systemctl reload ssh.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF_SSH
  if sshd -t; then
    systemctl reload ssh 2>/dev/null || systemctl restart ssh 2>/dev/null || true
    note "вход по SSH — только по ключу"
  else
    rm -f /etc/ssh/sshd_config.d/10-sambo.conf
    warn "настройку SSH проверить не удалось — оставил как было."
  fi
else
  warn "ключа для входа нет (/root/.ssh/authorized_keys) — вход по паролю оставлен; задайте сложный пароль: passwd"
fi
if systemctl enable --now fail2ban >/dev/null 2>&1; then
  note "fail2ban включён: подбор пароля блокируется"
else
  warn "fail2ban не запустился — проверьте: systemctl status fail2ban"
fi

free_mb=$(df -Pm / | awk 'NR==2 {print $4}')
((free_mb >= 8000)) || warn "на диске свободно ${free_mb} МБ — для сборки нужно около 10 ГБ."

mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
swap_mb=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
if ((mem_mb + swap_mb < 5500)) && [ ! -f /swapfile ]; then
  size_mb=$((6144 - mem_mb - swap_mb))
  step "Файл подкачки ${size_mb} МБ (памяти ${mem_mb} МБ — сборке нужно больше)"
  if { fallocate -l "${size_mb}M" /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count="$size_mb" status=none; } &&
    chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile; then
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  else
    rm -f /swapfile
    warn "файл подкачки создать не удалось — на сервере с 2 ГБ памяти сборка может прерваться."
  fi
fi

# ---------------------------------------------------------------- Docker
if ! command -v docker >/dev/null 2>&1; then
  step "Установка Docker"
  if curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sh /tmp/get-docker.sh >/tmp/get-docker.log 2>&1; then
    note "Docker установлен с download.docker.com"
  else
    warn "download.docker.com недоступен — ставлю Docker из репозитория ${PRETTY_NAME}"
    apt-get install -y -qq docker.io docker-compose-v2 docker-buildx >/dev/null ||
      apt-get install -y -qq docker.io docker-compose-plugin >/dev/null
  fi
  systemctl enable --now docker >/dev/null 2>&1 || true
fi
docker compose version >/dev/null 2>&1 || fail "не найден docker compose (плагин Compose v2)."

# Зеркало Docker Hub от Google: официальные образы (postgres, redis, node, caddy) — даже если Docker Hub
# недоступен или ограничивает число скачиваний. Остальные образы Docker берёт с Docker Hub как обычно.
if [ ! -f /etc/docker/daemon.json ]; then
  mkdir -p /etc/docker
  printf '{\n  "registry-mirrors": ["https://mirror.gcr.io"]\n}\n' >/etc/docker/daemon.json
  systemctl restart docker
fi

# ---------------------------------------------------------------- порты и DNS
step "Проверка портов 80 и 443"
busy=$(ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null | grep -v docker-proxy || true)
if [ -n "$busy" ]; then
  printf '%s\n' "$busy"
  fail "порты 80/443 заняты другой программой (часто это nginx или apache из шаблона с панелью). Остановите её или переустановите ОС без панели."
fi

step "Проверка DNS для $DOMAIN"
public_ip=$(curl -fsS4 --max-time 8 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
note "IP этого сервера: $public_ip"
dns_ok=1
hosts=("$DOMAIN" "www.$DOMAIN" "s3.$DOMAIN")
if [ -n "$REDIRECT_SITES" ]; then IFS=', ' read -ra more <<<"$REDIRECT_SITES" && hosts+=("${more[@]}"); fi
for host in "${hosts[@]}"; do
  got=$(getent ahostsv4 "$host" | awk 'NR==1 {print $1}' || true)
  if [ "$got" = "$public_ip" ]; then
    note "$host → $got — верно"
  else
    warn "$host → ${got:-записи пока нет}, а должно быть $public_ip"
    dns_ok=0
  fi
done
if ((dns_ok == 0)); then
  warn "Проверьте записи A в reg.ru. Если вы только что их добавили — всё в порядке: установка продолжится,"
  warn "а сертификат HTTPS выпустится сам, как только DNS обновится (обычно от 15 минут до нескольких часов)."
fi

# ---------------------------------------------------------------- секреты
umask 077
if [ ! -f "$ENV_FILE" ]; then
  step "Секреты этого сервера → $ENV_FILE"
  cat >"$ENV_FILE" <<EOF
# Создан install.sh $(date '+%Y-%m-%d %H:%M'). Секреты этого сервера: не публикуйте и не отправляйте в git.
# После правки — bash $DIR/update.sh
DOMAIN=$DOMAIN
# Домены, которые перенаправляют на основной (через запятую, вместе с www)
REDIRECT_SITES=$REDIRECT_SITES
DB_OWNER_PASSWORD=$(openssl rand -hex 24)
DB_APP_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
JWT_KID=k1
AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
TOTP_ENCRYPTION_KEY=$(openssl rand -base64 32)
STORAGE_ACCESS_KEY=sambo$(openssl rand -hex 6)
STORAGE_SECRET_KEY=$(openssl rand -hex 24)
MAILPIT_USER=mail
MAILPIT_PASSWORD=$(openssl rand -hex 8)
SEED_PASSWORD=Sambo-$(openssl rand -hex 3)-$(openssl rand -hex 3)-$(openssl rand -hex 3)
SEED_ADMIN_TOTP_SECRET=$(head -c 20 /dev/urandom | base32 | tr -d '=')

# Настоящая почта вместо Mailpit — раскомментируйте и заполните (пример — Яндекс 360), затем update.sh:
# SMTP_HOST=smtp.yandex.ru
# SMTP_PORT=465
# SMTP_SECURE=true
# SMTP_USER=no-reply@$DOMAIN
# SMTP_PASSWORD=пароль-приложения
# EMAIL_FROM=SAMBO Digital <no-reply@$DOMAIN>
EOF
else
  if [ "$(env_get DOMAIN)" != "$DOMAIN" ]; then
    warn "домен меняется: $(env_get DOMAIN) → $DOMAIN"
    sed -i "s/^DOMAIN=.*/DOMAIN=$DOMAIN/" "$ENV_FILE"
  fi
  if grep -q '^REDIRECT_SITES=' "$ENV_FILE"; then
    sed -i "s/^REDIRECT_SITES=.*/REDIRECT_SITES=$REDIRECT_SITES/" "$ENV_FILE"
  else
    echo "REDIRECT_SITES=$REDIRECT_SITES" >>"$ENV_FILE"
  fi
fi
chmod 600 "$ENV_FILE"
umask 022

# ---------------------------------------------------------------- образы
step "Скачивание образов"
if ! "${COMPOSE[@]}" pull --ignore-buildable --policy missing --quiet; then
  warn "Docker Hub не отвечает — добавляю зеркало dockerhub.timeweb.cloud и пробую ещё раз"
  printf '{\n  "registry-mirrors": ["https://mirror.gcr.io", "https://dockerhub.timeweb.cloud"]\n}\n' >/etc/docker/daemon.json
  systemctl restart docker
  "${COMPOSE[@]}" pull --ignore-buildable --policy missing --quiet
fi

step "Сборка приложения — на небольшом сервере 15–30 минут, это нормально"
note "Если соединение прервётся, зайдите снова и запустите ту же команду: сборка продолжится."
# По очереди: backend, затем web — на сервере с 2 ГБ памяти две сборки сразу не помещаются.
"${COMPOSE[@]}" build migrate api worker
"${COMPOSE[@]}" build web

# ---------------------------------------------------------------- запуск
step "Запуск: база данных, миграции, приложение"
"${COMPOSE[@]}" up -d --remove-orphans

if [ -z "$(env_get DEMO_DATA_LOADED)" ]; then
  step "Учебные данные (турниры и учётные записи из README, пароль — свой для этого сервера)"
  # seed-schedule.ts проводит жеребьёвки через код API внутри своего процесса (supertest, без HTTPS): Secure-cookie
  # там не вернулись бы, поэтому этому разовому процессу — режим разработки. Работающий api это не затрагивает.
  if "${COMPOSE[@]}" run --rm --no-deps migrate sh -c \
    './node_modules/.bin/tsx seed/index.ts && cd /repo/apps/api &&
     NODE_ENV=development COOKIE_SECURE=false node -r @swc-node/register scripts/seed-schedule.ts' \
    >/var/log/sambo-seed.log 2>&1; then
    echo "DEMO_DATA_LOADED=$(date '+%Y-%m-%d')" >>"$ENV_FILE"
  else
    tail -n 30 /var/log/sambo-seed.log
    fail "учебные данные не загрузились (полный журнал — /var/log/sambo-seed.log)."
  fi
fi

step "Ожидание готовности сайта"
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T web node -e "fetch('http://127.0.0.1:3000/ru').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 5
done
[ "${ready:-0}" = 1 ] || fail "сайт не ответил за 5 минут. Журнал: docker compose -f $DIR/compose.yml logs --tail 100 web api"

# ---------------------------------------------------------------- резервные копии
cat >/etc/cron.d/sambo-backup <<EOF
# SAMBO: резервная копия базы и файлов каждую ночь в 03:30 по времени сервера (deploy/server/backup.sh)
30 3 * * * root bash $DIR/backup.sh >>/var/log/sambo-backup.log 2>&1
EOF

# ---------------------------------------------------------------- итог
password="$(env_get SEED_PASSWORD)"
totp="$(env_get SEED_ADMIN_TOTP_SECRET)"
{
  echo "SAMBO — доступ ($(date '+%d.%m.%Y %H:%M'))"
  echo
  echo "Сайт:      https://$DOMAIN/ru/login"
  [ -z "$REDIRECT_SITES" ] || echo "           ($REDIRECT_SITES → https://$DOMAIN)"
  echo "Пароль всех учебных учётных записей: $password"
  echo "  organizer@sambo.local   руководитель турниров"
  echo "  secretary@sambo.local   секретарь"
  echo "  referee1@sambo.local    главный судья"
  echo "  referee2@sambo.local    судья ковра (планшет)"
  echo "  doctor@sambo.local      врач"
  echo "  manager1@sambo.local    руководитель клуба"
  echo "  остальные — в README.md репозитория"
  echo "  admin@sambo.local       администратор платформы: тот же пароль + код из приложения-аутентификатора,"
  echo "                          секрет для приложения: $totp"
  echo
  echo "Почта (письма с сайта): https://$DOMAIN/mail/  логин $(env_get MAILPIT_USER), пароль $(env_get MAILPIT_PASSWORD)"
  echo "Обновление:             bash $DIR/update.sh"
  echo "Резервные копии:        /var/backups/sambo (каждую ночь, 14 дней)"
} >"$ACCESS_FILE"
chmod 600 "$ACCESS_FILE"

step "Готово"
cat "$ACCESS_FILE"
echo
echo "QR-код для приложения-аутентификатора администратора (Яндекс Ключ, Google Authenticator и т. п.):"
qrencode -t ANSIUTF8 "otpauth://totp/SAMBO%20Digital:admin%40sambo.local?secret=$totp&issuer=SAMBO%20Digital"
echo "Всё это сохранено в $ACCESS_FILE (прочитать: cat $ACCESS_FILE)."
if ((dns_ok == 0)); then
  warn "DNS ещё не указывает на сервер: сайт откроется по https://$DOMAIN, когда записи обновятся."
fi
