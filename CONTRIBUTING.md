# Правила работы с кодом

Основание — разделы 64–71 ТЗ и IMPLEMENTATION_PLAN, раздел 0.

## Ветки и PR

- Одна фаза — одна ветка `phase-N-<name>` и один PR в `main`. Мелкие исправления — отдельные ветки `fix/…`.
- PR сливается только при зелёном CI. Упавшая проверка чинится, а не отключается.
- Коммиты — в стиле Conventional Commits: `feat(api): …`, `fix(web): …`, `test: …`, `docs: …`, `build: …`.

## Definition of Done

Задача закрыта, только если есть: реализация, серверная валидация, авторизация, обработка ошибок, тесты, 0 ошибок TypeScript и lint, сборка, документация — и ничего существующего не сломано.

## Архитектурные правила

- **Модули** (`apps/api/src/modules/<domain>`): `api/` → `application/` → `domain/` + `infrastructure/`. Другой модуль импортируется только через его `index.ts`. `domain/` не зависит от NestJS и Prisma. Проверяет dependency-cruiser (`pnpm lint:deps`).
- **Каждый маршрут** объявляет доступ: `@Public()`, `@Authenticated()` или `@RequirePermission(permission, scope)`. Маршрут без объявления не работает и роняет автотест `route-security.e2e.test.ts`.
- **Права** — только из каталога `packages/contracts/src/permissions.ts`; матрица ролей — `roles.ts`. После изменения каталога сгенерируйте миграцию данных:
  `pnpm --filter @sde/db exec tsx scripts/generate-data-migration.ts <yyyymmddhhmmss>_<name> --access-only`.
- **Схемы запросов** — в `packages/contracts` (Zod), одни и те же для API и форм. Бизнес-правила — только на сервере.
- **Ошибки** — `DomainError` с кодом из `packages/contracts/src/errors.ts`; новый код добавляется в каталог и в словари `apps/web/src/messages/*.json` (проверяет тест словарей).
- **Команда = одна транзакция**: изменение + `AuditService.record()` + `OutboxService.enqueue()`. Побочные эффекты (письма) — только через outbox.
- **Версионируемые ресурсы** меняются с `If-Match: "v{version}"`; конфликт — `VERSION_CONFLICT`.
- **Секреты и ПДн** не попадают в логи, аудит и outbox в открытом виде (redaction, `auditDiff`, `sealedParams`).
- Запрещено: `any` без обоснования, `$queryRawUnsafe`/`$executeRawUnsafe`, `dangerouslySetInnerHTML`, `TODO: implement later` — отложенное оформляется точкой расширения (ARCHITECTURE.md, 22).

## Миграции

- Схема меняется только миграциями в `packages/db/prisma/migrations`. SQL пишется и ревьюится вручную: база — `prisma migrate diff`, затем SQL-шаги для того, что Prisma не выражает (partial unique, CHECK, партиции, права роли приложения).
- Несовместимые изменения — в три релиза: expand → migrate → contract.
- Миграция проверяется с нуля: интеграционные тесты пересоздают схему и применяют все миграции.

## Тесты

- Unit — рядом с кодом (`*.test.ts`), для чистой логики.
- Интеграционные — `apps/api/test/*.e2e.test.ts`, через HTTP на реальных PostgreSQL и Redis. Хранилище S3 в тестах подменяется `MemoryStorage`; S3 проверяется сборкой и запуском образов.
- Локально нужны PostgreSQL (роли `sde`, `sde_app`, база `sde_test`) и Redis; адреса меняются переменными `TEST_DATABASE_URL`, `TEST_DATABASE_ADMIN_URL`, `TEST_REDIS_URL`.
