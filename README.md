# SAMBO DIGITAL ECOSYSTEM

Цифровая экосистема детско-юношеских турниров по самбо: турнир целиком проходит в системе — от положения до архива результатов.

Текущее состояние — **Phase 3 (Athletes)**, версия 0.3.0. Готово: вход и сессии, роли и права, организации с иерархией, файлы, аудит, outbox и фоновые задачи, админ-панель (Phase 2); спортсмены с клубами, тренерами и разрядами, поиск дублей и слияние, импорт из CSV/XLSX, законные представители и согласия (ФЗ-152), документы с проверкой, тренеры и судьи, наборы правил с версиями, возрастные группы и весовые категории (Phase 3). Турниры, заявки, жеребьёвка и судейство — следующие фазы ([план](docs/README.md#план)).

## Состав репозитория

| Путь | Что это |
|---|---|
| `apps/api` | Backend: модульный монолит NestJS (REST, `/api/v1`) |
| `apps/worker` | Фоновые задачи: диспетчер outbox, письма, разбор импорта, истечение документов, обслуживание БД (BullMQ) |
| `apps/web` | Веб-клиент Next.js: кабинеты тренера, клуба, представителя, секретаря; админ-панель; ru и en |
| `packages/contracts` | Единый источник схем API (Zod), каталог прав и ролей, коды ошибок |
| `packages/db` | Схема Prisma, миграции, seed |
| `packages/server-kit` | Общий серверный код: окружение, криптография, пароли, логирование |
| `packages/ui` | Базовые UI-компоненты (Tailwind CSS) |
| `infra/` | Dockerfile и инициализация PostgreSQL |
| `docs/` | Документация по эксплуатации; архитектура — в [docs/README.md](docs/README.md) |

Стек: TypeScript 5.9, Node.js 22, pnpm + Turborepo, NestJS 11, Prisma 6 + PostgreSQL 16, Redis 7, S3 (MinIO локально), Next.js 15 + React 19, TanStack Query, next-intl, Tailwind CSS 4, Vitest.

## Быстрый старт: Docker

```bash
cp .env.example .env
docker compose up --build
```

- Веб: http://localhost:3000 — вход `admin@sambo.local`, пароль `Sambo-Dev-2026!`, код TOTP из приложения-аутентификатора с ключом `KVKFKRCPNZQUYMLXOVYDSQKJKZDTSRLD` (учебный, только для разработки).
- Письма (подтверждение email, приглашения): http://localhost:8025 (Mailpit).
- Консоль MinIO: http://localhost:9001 (`sde-dev` / `sde-dev-secret`).

Сервис `migrate` применяет миграции и seed перед стартом `api` и `worker`. Все учётные записи seed вымышленные: см. вывод `migrate` или [packages/db/seed/data.ts](packages/db/seed/data.ts). Пароль у всех — `Sambo-Dev-2026!`.

| Учётная запись | Что посмотреть |
|---|---|
| `coach1@sambo.local`, `coach2@sambo.local` | Тренеры двух клубов: свои спортсмены, карточка, представители, документы; спортсмены чужого клуба не видны |
| `manager1@sambo.local` | Руководитель спортшколы: все спортсмены клуба, тренеры, импорт из файла |
| `parent1@sambo.local` | Законный представитель спортсмена «Орлов Дмитрий»: «Мои спортсмены», согласия |
| `secretary@sambo.local` | Секретарь учебного турнира: проверка документов, загруженных с ID турнира `01920000-0000-7000-8015-000000000001` |
| `federation@sambo.local` | Федерация: судьи, категории, правила своей федерации |
| `admin@sambo.local` (TOTP) | Платформа: всё, включая тексты согласий и слияние дублей |

## Разработка без Docker

Нужны Node.js ≥ 22.12, pnpm 10, PostgreSQL 16, Redis 7 и S3-совместимое хранилище.

```bash
pnpm install
cp .env.example .env              # поправьте адреса сервисов
# роли БД: владелец схемы (DATABASE_ADMIN_URL) и роль приложения sde_app (DATABASE_URL) — см. docs/DEPLOYMENT.md
pnpm db:migrate                   # миграции
pnpm db:seed                      # учебные данные
pnpm dev                          # api :4000, worker, web :3000
```

## Проверки

| Команда | Что делает |
|---|---|
| `pnpm lint` | ESLint (без `any`, запрет небезопасного SQL и `dangerouslySetInnerHTML`) + границы модулей (dependency-cruiser) |
| `pnpm typecheck` | TypeScript `strict`, `noUncheckedIndexedAccess` |
| `pnpm test:unit` | Unit-тесты: права и иерархия, ротация refresh token, правила организаций, сигнатуры файлов, шаблоны писем, словари; возраст (три политики, 29 февраля, день рождения, граница года), подбор категорий, машина состояний документа, разбор CSV/XLSX |
| `pnpm test:integration` | Интеграционные тесты на реальных PostgreSQL и Redis: полный цикл входа, автотест безопасности маршрутов, аудит в транзакции, rate limit, организации, файлы; изоляция клубов, дубли и слияние, представители и согласия, документы (доступ без прав → 403 и запись в журнал, неподдерживаемый тип), правила и категории, импорт |
| `pnpm build` | Сборка всех пакетов |
| `pnpm format:check` | Prettier |

CI (`.github/workflows/ci.yml`) запускает всё это, плюс gitleaks, `pnpm audit` и сборку Docker-образов.

## Документация

- [docs/README.md](docs/README.md) — где лежат архитектурные документы и что изменилось в Phase 2.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — окружения, переменные, роли БД, миграции.
- [CONTRIBUTING.md](CONTRIBUTING.md) — правила работы с кодом.
- [CHANGELOG.md](CHANGELOG.md) — изменения по версиям.
