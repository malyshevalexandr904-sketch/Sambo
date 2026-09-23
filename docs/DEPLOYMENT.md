# DEPLOYMENT (dev) — SAMBO DIGITAL ECOSYSTEM

Phase 2: локальная среда и CI. Staging появляется в Phase 4, production — до пилота (IMPLEMENTATION_PLAN, 5).

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

Изменения каталога прав — отдельной миграцией данных (см. CONTRIBUTING.md). Миграция данных идемпотентна и увеличивает `permissions_version` всех пользователей: кэш прав сбрасывается.

## Хранилище

Три bucket: публичные медиа (анонимное чтение, CDN в production), приватные документы (только presigned URL на 60 секунд), генерируемые файлы. Браузер загружает файлы напрямую в хранилище по presigned POST, поэтому:

- `STORAGE_PUBLIC_ENDPOINT` — адрес хранилища, доступный браузеру (подпись ссылок);
- `STORAGE_UPLOAD_ORIGIN` (web) — тот же origin для CSP `connect-src`;
- на bucket приватных документов нужен CORS для origin сайта (метод `POST`).

Публичные медиа сначала попадают в приватный bucket (`incoming/{fileId}`) и копируются в публичный только после проверки размера, SHA-256 и сигнатуры.

MinIO берётся с `quay.io` (публикация community-образов в Docker Hub прекращена) и используется только для разработки; production — S3 российского облачного провайдера (решение Q-07).

## Сеть и прокси

- Next.js проксирует `/api/*` на `API_INTERNAL_URL`: браузер работает с одним origin, cookie и CSRF без CORS. Адрес вшивается при сборке образа web (`--build-arg API_INTERNAL_URL`).
- За reverse proxy установите `TRUST_PROXY=true`, иначе rate limit и аудит увидят IP прокси.
- `/health` и `/ready` в production открываются только во внутренней сети.

## Чек-лист проверки стенда

1. `docker compose up --build` — все сервисы `healthy`, `migrate` завершился с кодом 0.
2. Вход `admin@sambo.local` с TOTP → создание организации → приглашение участника → запись в журнале аудита, письмо в Mailpit.
3. `curl localhost:4000/ready` → `{"status":"ok"}`.
