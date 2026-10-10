# DEPLOYMENT — SAMBO DIGITAL ECOSYSTEM

Phase 2: локальная среда и CI. С 0.9.1 — сервер с публичным адресом на одном VPS (раздел [«Сервер»](#сервер)); production для пилота — до Phase 12 (IMPLEMENTATION_PLAN, 5).

## Компоненты

| Сервис | Образ | Порт | Проверка |
|---|---|---|---|
| `api` | `infra/docker/Dockerfile.api`, target `api` | 4000 | `/health`, `/ready` (БД, Redis, S3) |
| `worker` | `infra/docker/Dockerfile.api`, target `worker` | 4100 | `/health` |
| `migrate` | `infra/docker/Dockerfile.api`, target `migrate` | — | `prisma migrate deploy`, затем seed (только dev) |
| `web` | `infra/docker/Dockerfile.web` (Next.js standalone) | 3000 | `/ru` |
| PostgreSQL 16, Redis 7, MinIO, Mailpit | `docker-compose.yml` | 5432, 6379, 9000/9001, 8025/1025 | healthcheck |

Образы запускаются от пользователя `node`. `api` и `worker` — без состояния, масштабируются горизонтально.

## Роли PostgreSQL (DATABASE.md, 10)

| Роль | Переменная | Права |
|---|---|---|
| Владелец схемы (`sde`) | `DATABASE_ADMIN_URL` | DDL; только для миграций |
| Приложение (`sde_app`) | `DATABASE_URL` | DML без DDL; нет `UPDATE`/`DELETE`/`TRUNCATE` на `audit_log` и `data_access_log`; нет доступа к партициям напрямую и к `_prisma_migrations` |

Первая миграция создаёт `sde_app` **без LOGIN**, если роли нет. Пароль и `LOGIN` выдаёт эксплуатация:

```sql
ALTER ROLE sde_app LOGIN PASSWORD '<секрет>';
```

Локально это делает `infra/postgres/init.sh` (docker compose). У managed-провайдера роли создаются в его консоли; расширения `citext` и `pg_trgm` должны быть разрешены.

Партиции `audit_log` и `data_access_log` создаются на 16 месяцев вперёд миграцией и продлеваются задачей worker `ensurePartitions` (функция `ensure_monthly_partitions`, `SECURITY DEFINER`). Строки вне созданных месяцев попадают в партицию `DEFAULT`.

## Переменные окружения

Полный список с пояснениями — `.env.example`. Приложение проверяет окружение при старте (`packages/server-kit/src/env.ts`) и не запускается, если чего-то не хватает; в сообщение попадают имена переменных, но не значения.

В `NODE_ENV=production` дополнительно запрещено: `COOKIE_SECURE=false`, `EMAIL_PROVIDER=log`, совпадение `JWT_SECRET` и `AUTH_SECRET`.

| Секрет | Как сгенерировать | Ротация (SECURITY.md, 8) |
|---|---|---|
| `JWT_SECRET` + `JWT_KID` | `openssl rand -base64 48` | Раз в квартал: новый ключ в `JWT_SECRET`/`JWT_KID`, старый — в `JWT_PREVIOUS_SECRET`/`JWT_PREVIOUS_KID` на 15 минут (время жизни access token) |
| `AUTH_SECRET` | `openssl rand -base64 48` | Раз в год. От него производятся ключи CSRF и шифрования параметров писем в outbox: после смены письма из очереди, созданные до смены, не расшифруются — сменяйте при пустой очереди |
| `TOTP_ENCRYPTION_KEY` | `openssl rand -base64 32` | Только с перешифрованием секретов TOTP |

## Миграции

```bash
pnpm db:migrate            # prisma migrate deploy (DATABASE_ADMIN_URL)
pnpm db:seed               # учебные данные, только dev
```

**Phase 4a (`20260927000000_competitions`).** Внешние ключи на турнир и заявку у таблиц Phase 2–3 (`competition_membership.competition_id`, `consent.competition_id`, `document.competition_id`, `document.application_id`) создаются `NOT VALID` и проверяются той же миграцией, только если висячих ссылок нет: до Phase 4 турнир «существовал» через свой персонал, и на стенде с seed Phase 3 есть секретарь учебного турнира, строки которого в `competition` ещё нет. Новые строки ограничение проверяет сразу. После миграции:

1. `pnpm db:seed` — создаёт учебный турнир с тем же идентификатором.
2. Проверьте, что непроверенных ограничений не осталось:

```sql
SELECT conname FROM pg_constraint WHERE NOT convalidated AND conname IN (
  'competition_membership_competition_id_fkey', 'consent_competition_id_fkey',
  'document_competition_id_fkey', 'document_application_id_fkey');
```

3. Для каждого найденного — от владельца схемы (`DATABASE_ADMIN_URL`, у роли приложения нет DDL): `ALTER TABLE document VALIDATE CONSTRAINT document_competition_id_fkey;` и т. д. Если проверка падает — найдите висячие ссылки (`SELECT id, competition_id FROM document WHERE competition_id IS NOT NULL AND competition_id NOT IN (SELECT id FROM competition)`) и исправьте их.

Изменения каталога прав — отдельной миграцией данных (см. CONTRIBUTING.md). Миграция данных идемпотентна и увеличивает `permissions_version` всех пользователей: кэш прав сбрасывается.

## Хранилище

Три bucket: публичные медиа (анонимное чтение, CDN в production), приватные документы (только presigned URL на 60 секунд), генерируемые файлы. Браузер загружает файлы напрямую в хранилище по presigned POST, поэтому:

- `STORAGE_PUBLIC_ENDPOINT` — адрес хранилища, доступный браузеру (подпись ссылок);
- `STORAGE_UPLOAD_ORIGIN` (web) — тот же origin для CSP `connect-src`;
- на bucket приватных документов нужен CORS для origin сайта (метод `POST`); локальный MinIO задаёт его для всего сервера переменной `MINIO_API_CORS_ALLOW_ORIGIN` (CORS отдельного bucket в бесплатном MinIO не поддерживается).

Публичные медиа сначала попадают в приватный bucket (`incoming/{fileId}`) и копируются в публичный только после проверки размера, SHA-256 и сигнатуры.

MinIO используется только для разработки; production — S3 российского облачного провайдера (решение Q-07). С осени 2025 MinIO не публикует образы (репозитории `quay.io/minio` и `minio/*` в Docker Hub закрыты, pull отвечает 401), поэтому `docker-compose.yml` берёт замороженный образ Bitnami `bitnamilegacy/minio` (сервер MinIO и клиент `mc`), закреплённый по digest. Обновлений у него не будет — для разработки этого достаточно; если образ перестанет скачиваться, MinIO заменяется любым S3-совместимым сервером с presigned POST.

## Сеть и прокси

- Next.js проксирует `/api/*` на `API_INTERNAL_URL`: браузер работает с одним origin, cookie и CSRF без CORS. Адрес вшивается при сборке образа web (`--build-arg API_INTERNAL_URL`).
- За reverse proxy установите `TRUST_PROXY=true`, иначе rate limit и аудит увидят IP прокси.
- `/health` и `/ready` в production открываются только во внутренней сети.
- Публичный API (`/api/public/v1`) можно отдавать через CDN: ответы `Cache-Control: public, max-age=60`. Публичные страницы турниров web получает с `API_INTERNAL_URL` во время запроса и кэширует на 60 секунд в процессе.

## Мандатная комиссия на площадке

- Сканер QR использует камеру планшета через `getUserMedia`: браузер даёт камеру только странице по HTTPS (или `localhost`). На площадке открывайте систему по HTTPS; без него код из QR вводится вручную.
- Попытки взвешивания — append-only: миграция `20260928000000_admission_weighin` отзывает у роли приложения `UPDATE`, `DELETE` и `TRUNCATE` на `weigh_in_attempt`. Если миграции выполняет не владелец схемы, проверьте права: `\dp weigh_in_attempt`.
- Если на момент миграции `20260928000000_admission_weighin` турнир уже на мандатной комиссии или позже, миграция создаёт строки прибытия и переводит закрытые категории во взвешивание; допуск такого турнира пересчитайте кнопкой «Пересчитать допуск» на вкладке «Допуск» (`POST /api/v1/competitions/{id}/admission/recompute`).
- Worker обслуживает очередь `notifications` (уведомления и письма с повторами). Письмо, не отправленное за 5 попыток, остаётся в `notification_delivery` со статусом `FAILED` и кодом ошибки. Если постановка письма в очередь сорвалась, повтор задачи события находит ожидающие доставки и ставит их снова.

## Чек-лист проверки стенда

1. `docker compose up --build` — все сервисы `healthy`, `migrate` завершился с кодом 0.
2. Вход `admin@sambo.local` с TOTP → создание организации → приглашение участника → запись в журнале аудита, письмо в Mailpit.
3. `curl localhost:4000/ready` → `{"status":"ok"}`.
4. Seed: `/ru/tournaments` показывает «Кубок Юности» с открытой регистрацией; `organizer@sambo.local` видит заявку «Самбо-Север» в разделе «Заявки» турнира.
5. Seed Phase 4b: `secretary@sambo.local` открывает «Открытое первенство „Самбо-Север“» — вкладки «Допуск», «Прибытие», «Взвешивание»; `doctor@sambo.local` — вкладка «Медицина». Секретарь возвращает заявку «Кубка Юности» на исправление — через несколько секунд у `manager1@sambo.local` появляется уведомление (worker, очередь `notifications`), письмо — в Mailpit.

## Сервер

Один VPS, всё в Docker: `deploy/server/compose.yml`. Подходит для демонстрации и проверки заказчиком; для пилота — managed PostgreSQL и S3 провайдера (Q-07), отдельная почта и резервные копии вне сервера.

| Что | Где |
|---|---|
| Сайт | `https://<домен>`; `www.<домен>` и дополнительные домены (`REDIRECT_SITES`) перенаправляют на него |
| API | `https://<домен>/api/*` — Caddy отправляет напрямую в `api` (один прокси: `TRUST_PROXY=true` доверяет одному хопу) |
| Хранилище | `https://s3.<домен>` → MinIO; Host не меняется — подпись presigned URL включает хост |
| Почта | `https://<домен>/mail/` — Mailpit с паролем, пока не подключён SMTP |
| Наружу | только 80 и 443 (Caddy, сертификаты Let's Encrypt); PostgreSQL, Redis, MinIO — во внутренней сети Docker |

### DNS

Записи **A** на IP сервера: `@`, `www`, `s3` основного домена; `@`, `www` — каждого дополнительного. Сертификаты выпускаются, как только записи начинают указывать на сервер; до этого Caddy повторяет попытки сам.

### Установка

```bash
apt-get update && apt-get install -y git
git clone https://github.com/malyshevalexandr904-sketch/Sambo.git /opt/sambo
bash /opt/sambo/deploy/server/install.sh digitalsambo.ru digitalsambo.online
```

`install.sh` (от root, Ubuntu 22.04/24.04 или Debian 12): защита входа (при ключе в `/root/.ssh/authorized_keys` — только по ключу, `/etc/ssh/sshd_config.d/10-sambo.conf`; fail2ban), файл подкачки до 6 ГБ памяти вместе с подкачкой, Docker (download.docker.com, иначе пакеты дистрибутива; зеркало `mirror.gcr.io`, при недоступности Docker Hub — ещё `dockerhub.timeweb.cloud`), проверка портов 80/443 и DNS, секреты в `deploy/server/.env` (права 600), сборка по очереди (backend, затем web — на 2 ГБ две сборки не помещаются), миграции, учебные данные один раз (`DEMO_DATA_LOADED` в `.env`), cron резервных копий. Итог — в `/root/sambo-access.txt`. Повторный запуск продолжает с того же места; панели вроде ISPmanager занимают 80/443 — сервер ставится на чистую ОС.

Учебные данные — те же учётные записи, что в README, но пароль (`SEED_PASSWORD`) и секрет TOTP администратора (`SEED_ADMIN_TOTP_SECRET`) генерируются для сервера: значения из репозитория на нём не действуют. `seed-schedule.ts` проводит жеребьёвки через код API в своём процессе по HTTP без TLS, поэтому запускается с `NODE_ENV=development COOKIE_SECURE=false` — работающего `api` это не касается.

### Обновление, почта, резервные копии

- **Обновление:** `bash /opt/sambo/deploy/server/update.sh` — резервная копия, `git pull` ветки `main`, сборка, миграции (`migrate` выполняется при каждом `up`), перезапуск.
- **Настоящая почта:** в `deploy/server/.env` — `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` (образец — в комментарии файла), затем `update.sh --no-pull`. Для доставки — SPF и DKIM домена у почтового провайдера.
- **Резервные копии:** каждую ночь в 03:30 (`/etc/cron.d/sambo-backup`) — `/var/backups/sambo/db-*.dump` (pg_dump custom) и `files-*.tar.gz` (данные MinIO), 14 дней; вручную — `backup.sh`. Копии лежат на том же диске: дополнительно включите резервное копирование у хостинга.
- **Восстановление базы:**

```bash
cd /opt/sambo/deploy/server
docker compose stop api worker web
docker compose exec -T postgres pg_restore -U sde -d sde --clean --if-exists < /var/backups/sambo/db-<дата>.dump
docker compose start api worker web
```

- **Журналы:** `docker compose -f /opt/sambo/deploy/server/compose.yml logs --tail 100 api` (ротация — 5 файлов по 10 МБ на сервис).
