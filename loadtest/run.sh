#!/usr/bin/env bash
# Прогоны нагрузочного теста живых данных (Phase 8b; README.md рядом): перед каждым — свежий стенд и перезапуск
# api; api — на ядре 0, PostgreSQL, Redis и k6 — на ядре 1 (taskset), чтобы генератор нагрузки не отнимал
# процессор у api. Окружение — локальная разработка (.env в корне репозитория), отдельная база sde_load и
# Redis-база 14; api слушает порт 4001.
#
#   K6=/path/to/k6 OUT=/tmp/load loadtest/run.sh "r1 VIEWERS=10000 PERIOD_MS=6000" "r2 VIEWERS=0 PERIOD_MS=1000 MEASURE_S=60"
#
# Каждый аргумент — имя прогона и переменные k6 (live.k6.js). NOTIFY_OFF=1 в аргументе — прогон с выключенным
# триггером sync_log_notify (сравнение commit с NOTIFY и без).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
K6="${K6:-k6}"
OUT="${OUT:-/tmp/sambo-load}"
ADMIN_URL="${LOAD_ADMIN_URL:-postgresql://sde:sde_dev_owner@localhost:5432/sde_load}"
APP_URL="${LOAD_APP_URL:-postgresql://sde_app:sde_dev_app@localhost:5432/sde_load}"
REDIS="${LOAD_REDIS_URL:-redis://localhost:6379/14}"
mkdir -p "$OUT"
API_PID=""

stop_api() { [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null && sleep 2 || true; }
trap stop_api EXIT

stand() {
  stop_api
  (cd "$ROOT/apps/api" && TEST_DATABASE_URL="$APP_URL" TEST_DATABASE_ADMIN_URL="$ADMIN_URL" TEST_REDIS_URL="$REDIS" \
    LOAD_STAND_OUT="$OUT/stand.json" taskset -c 1 pnpm run load:stand > "$OUT/stand.log" 2>&1)
  (cd "$ROOT/apps/api" && exec taskset -c 0 env DATABASE_URL="$APP_URL" DATABASE_ADMIN_URL="$ADMIN_URL" \
    REDIS_URL="$REDIS" API_PORT=4001 TRUST_PROXY=true RATE_LIMIT_ENABLED=false LOG_LEVEL=warn \
    node --env-file=../../.env dist/main.js > "$OUT/api.log" 2>&1) &
  API_PID=$!
  for _ in $(seq 1 30); do curl -sf localhost:4001/health > /dev/null && break; sleep 1; done
  sleep 3
}

run() {
  local name="$1"; shift
  stand
  case " $* " in *" NOTIFY_OFF=1 "*) psql "$ADMIN_URL" -qc 'ALTER TABLE sync_log DISABLE TRIGGER sync_log_notify' ;; esac
  taskset -c 1 node "$ROOT/loadtest/sample.mjs" "$API_PID" > "$OUT/res-$name.csv" &
  local sampler=$!
  sleep 1
  env SOCKETS_PER_VU=200 SAMPLE_EVERY=10 "$@" STAND="$OUT/stand.json" API=http://127.0.0.1:4001 \
    taskset -c 1 "$K6" run --quiet --summary-export "$OUT/k6-$name.json" "$ROOT/loadtest/live.k6.js" > "$OUT/k6-$name.txt" 2>&1 || true
  kill "$sampler"
  psql "$ADMIN_URL" -qc 'ALTER TABLE sync_log ENABLE TRIGGER sync_log_notify'
  echo "== $name $*"
  grep -E 'command_duration|command_ok|live_latency|live_messages|live_expected|live_gaps|ws_connected|ws_dropped|ws_connect_failed' "$OUT/k6-$name.txt" || true
}

for spec in "$@"; do
  # shellcheck disable=SC2086
  run $spec
done
