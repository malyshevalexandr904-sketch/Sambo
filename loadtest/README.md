# Нагрузочный тест живых данных

Phase 8b, план §5: 10 000 зрителей табло (каналы `public:mat` 12 ковров) и поток судейских событий с 12 ковров. Отчёт с цифрами и выводами — [docs/LOAD_TEST.md](../docs/LOAD_TEST.md).

## Что внутри

| Файл | Назначение |
|---|---|
| `live.k6.js` | Сценарий k6: зрители (много соединений Socket.IO на один VU, протокол Engine.IO вручную поверх `k6/experimental/websockets`) и 12 «планшетов» (оценки через REST по расписанию). Метрики: `live_latency` — «команда → сообщение зрителю», `live_messages`, `live_gaps` (пропуски номеров сообщений), `command_duration`, `tablet_send_lag`, `ws_*` |
| `sample.mjs` | CPU и память api, PostgreSQL, Redis и k6 каждые 2 с (Linux, `/proc`), CSV |
| `run.sh` | Прогоны: свежий стенд и перезапуск api перед каждым, api — на ядре 0, остальное — на ядре 1 |
| `apps/api/test/load/stand.load.ts` | Стенд: турнир на 12 ковров через API (как в интеграционных тестах), на каждом ковре — идущая схватка, свой судья; `pnpm --filter api run load:stand` |

Как меряется задержка без синхронизации часов: событие `k` ковра `m` отправляется в момент `T0 + m·PERIOD/12 + k·PERIOD` (планшет ждёт этот момент), сумма баллов на табло после него — `S0 + k + 1`; зритель по сумме баллов знает момент отправки. Опоздание отправки планшета — отдельная метрика (`tablet_send_lag`), оно входит в задержку.

## Запуск (локальная разработка, Linux, 2 ядра и больше)

1. Запущены PostgreSQL и Redis (`docker compose up -d postgres redis` или свои), собран api: `pnpm --filter @sde/api build`.
2. Отдельная база для стенда (её схема пересоздаётся при каждой подготовке стенда):

   ```bash
   psql postgresql://sde:sde_dev_owner@localhost:5432/sde -c "create database sde_load owner sde"
   ```

3. k6 версии 1.x — <https://grafana.com/docs/k6/latest/set-up/install-k6/> (или бинарный файл с GitHub Releases).
4. Прогоны (имя и переменные k6 через пробел; `NOTIFY_OFF=1` — с выключенным триггером `sync_log_notify`). Прогоны отчёта:

   ```bash
   K6=$(which k6) OUT=/tmp/sambo-load loadtest/run.sh \
     "r1-10k-2ev VIEWERS=10000 PERIOD_MS=6000 CONNECT_S=90 MEASURE_S=120" \
     "r2-10k-6ev VIEWERS=10000 PERIOD_MS=2000 CONNECT_S=90 MEASURE_S=120" \
     "r3-10k-12ev VIEWERS=10000 PERIOD_MS=1000 CONNECT_S=90 MEASURE_S=120" \
     "r4-5k-12ev VIEWERS=5000 PERIOD_MS=1000 CONNECT_S=60 MEASURE_S=120" \
     "n1-on VIEWERS=0 PERIOD_MS=1000 CONNECT_S=5 MEASURE_S=60" \
     "n1-off NOTIFY_OFF=1 VIEWERS=0 PERIOD_MS=1000 CONNECT_S=5 MEASURE_S=60" \
     "n2-on VIEWERS=0 PERIOD_MS=300 CONNECT_S=5 MEASURE_S=60" \
     "n2-off NOTIFY_OFF=1 VIEWERS=0 PERIOD_MS=300 CONNECT_S=5 MEASURE_S=60"
   ```

   Результаты — `OUT/k6-<имя>.txt|json` (итоги k6) и `OUT/res-<имя>.csv` (CPU и память).

Переменные `live.k6.js`: `VIEWERS` (зрители), `SOCKETS_PER_VU` (в `live.k6.js` по умолчанию 100, `run.sh` задаёт 200), `PERIOD_MS` — интервал событий одного ковра (12 ковров × 1 событие за `PERIOD_MS`), `CONNECT_S` — окно подключения зрителей до начала событий, `MEASURE_S` — длительность потока событий, `SAMPLE_EVERY` — задержку меряет каждый N-й зритель (`run.sh` — 10).

api стенда запускается с `TRUST_PROXY=true`: каждое соединение k6 представляется своим адресом (`X-Forwarded-For`), иначе сработал бы лимит 1000 соединений с одного адреса. На боевом сервере `run.sh` не запускать — он пересоздаёт базу `sde_load` и останавливает свой api.
