# CHANGELOG

## 0.2.0 — Phase 2: Foundation (2026-09-23)

### Добавлено

- Монорепозиторий pnpm + Turborepo: `apps/api`, `apps/worker`, `apps/web`, `packages/contracts`, `packages/db`, `packages/server-kit`, `packages/ui`. Строгий TypeScript, ESLint, Prettier, dependency-cruiser.
- БД: сущности Identity & Access, Organizations, Platform (DATABASE.md, 3.1, 3.2, 3.9), справочники стран, субъектов РФ, ЕВСК, судейских категорий, дисциплин, типов документов. Роль приложения без DDL, неизменяемые журналы, партиции по месяцам.
- API `/api/v1`: auth (регистрация, подтверждение email, вход, TOTP, ротация refresh token, сеансы, восстановление и смена пароля), me, организации и участники, файлы, аудит, справочники, системные настройки, администрирование пользователей и ролей, `/health`, `/ready`.
- Права: каталог permissions и матрица ролей в `packages/contracts`, `PolicyService`, наследование по иерархии организаций, `@Public` / `@Authenticated` / `@RequirePermission`.
- Worker: диспетчер outbox, доставка писем (SMTP), продление партиций, очистка токенов, outbox и незавершённых загрузок.
- Web: вход, регистрация, подтверждение email, восстановление пароля, приглашения; админ-панель (обзор, пользователи, организации, журнал аудита, настройки), профиль (сеансы, TOTP); ru и en; CSP с nonce.
- Docker-образы, `docker-compose.yml`, CI (lint, typecheck, unit, integration, build, gitleaks, audit, Docker).

### Отличия от документов Phase 1

Перечислены в [docs/README.md](docs/README.md#изменения-phase-2).
