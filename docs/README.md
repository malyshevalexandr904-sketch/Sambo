# Документация

## Где что лежит

Архитектурные документы Phase 1 (согласованы заказчиком 2026-09-23) ведутся в проекте Claude «sambo-online.ru»:
`ARCHITECTURE.md`, `DATABASE.md`, `API.md`, `PERMISSIONS.md`, `SECURITY.md`, `ADR.md`, `PROJECT_ANALYSIS.md`, `IMPLEMENTATION_PLAN.md`.
Каждая фаза дополняет их; ниже — изменения, внесённые Phase 2. В репозитории — эксплуатационные документы:

- [DEPLOYMENT.md](DEPLOYMENT.md) — окружения, переменные, роли БД, миграции, хранилище.
- [../CONTRIBUTING.md](../CONTRIBUTING.md) — правила работы с кодом.
- [../CHANGELOG.md](../CHANGELOG.md) — изменения по версиям.

## План

| Фаза | Статус |
|---|---|
| 0 Analysis, 1 Architecture | Выполнены, согласованы |
| **2 Foundation** | **Выполнена** (этот репозиторий, версия 0.2.1) |
| 3 Athletes → 12 Hardening | Впереди (IMPLEMENTATION_PLAN.md) |

## Изменения Phase 2

Всё ниже — уточнения, найденные при реализации. Они не меняют согласованную архитектуру, но должны быть отражены в документах.

### DATABASE.md

| Сущность | Изменение | Причина |
|---|---|---|
| `User` | + `totpEnabledAt`, `totpRecoveryCodeHashes text[]` | Двухшаговое включение TOTP и коды восстановления (API.md, 3.1) |
| `Permission` | + `scopes RoleScope[]` | Область права хранится вместе с каталогом |
| `RolePermission` | + `mode GrantMode` (`DIRECT`, `POLICY`, `INHERITED`, `LIMITED`) | Отметки матрицы ●, ◐, ▲, ○ (PERMISSIONS.md, 4) |
| `OrganizationMembership` | `userId` nullable + `invitedEmail citext`; CHECK «есть пользователь или email», «не `INVITED` → есть пользователь»; partial unique на ожидающее приглашение | Приглашение человека, у которого ещё нет аккаунта |
| `CompetitionMembership` | Таблица создана, FK на `competition` — миграцией Phase 4 | Таблицы турнира ещё нет |
| `StoredFile` | + `purpose` | Политики загрузки и скачивания по цели файла |
| `AuditLog`, `DataAccessLog` | PK `(id, occurredAt)`; `AuditLog` + `platformIntervention` | Партиционирование требует ключ партиции в PK; флаг вмешательства платформы (PERMISSIONS.md, 6.7) |
| `OutboxEvent` | + `traceId`, `lastError`, `availableAt` | Трассировка и повторы с задержкой |
| `Region` | unique `code` глобально | Код ISO 3166-2 уникален сам по себе; используется в `PUT /admin/dictionaries/regions/{code}` |
| `SportRank`, `RefereeCategory`, `Discipline`, `DocumentType`, `Person` | Созданы в Phase 2 | Эндпоинты справочников и `PUT /me/person` — Phase 2 (API.md, 3.2, 3.7) |
| Функция `ensure_monthly_partitions` | `SECURITY DEFINER`, доступна роли приложения | Worker продлевает партиции без DDL-прав |

### API.md

- **Новые коды ошибок** (`BUSINESS_RULE_ERROR`): `ROLE_SCOPE_MISMATCH` — роль нельзя выдать в этой области; `ROLE_EXCEEDS_GRANTOR` — у выдающего нет всех прав роли (`details.missing`).
- **Bearer-клиенты** просят токены в теле заголовком `X-Auth-Mode: bearer` (`login`, `verify-email`, `refresh`). Запросы с `Authorization` или `X-Auth-Mode` не проходят CSRF-проверку: такой заголовок нельзя отправить с чужого сайта без CORS.
- `GET /auth/csrf` → `200 { data: { csrfToken } }` и cookie. `POST /auth/refresh` для cookie-сессии → `200 { data: { status: "REFRESHED" } }`.
- Добавлен `GET /me/person`; `PUT /me/person` принимает `confirmNotDuplicate: true` для продолжения после `POSSIBLE_DUPLICATE`.
- `POST /invites/accept` — только пользователь с подтверждённым email, совпадающим с приглашённым; иначе `403`.
- `POST /organizations`: создатель получает роль руководителя (`CLUB_MANAGER` / `ORGANIZER` / `FEDERATION_ADMIN` по типу), только если у него нет полномочий создать организацию сразу активной. Создатель с полномочиями (платформенное `organization.approve` или `organization.create_child` на родителе) в состав не входит; необязательное поле `managerEmail` приглашает первого руководителя. `managerEmail` без полномочий — `VALIDATION_FAILED` (`not_allowed`), свой адрес — `manager_is_creator` (0.2.1).
- `Organization` (карточка) содержит `parent: { id, name, shortName } | null` (0.2.1).
- `Membership` содержит `invitedEmail` для ожидающих приглашений.
- Файлы: цели загрузки без зарегистрированной политики запрещены (`403`); в Phase 2 разрешён `ORGANIZATION_LOGO`, остальные цели регистрируют модули Phase 3–4. Скачивание приватного файла по умолчанию — только загрузившему.
- `GET /competitions/{id}/audit-logs` — вместе с турнирами в Phase 4.

### PERMISSIONS.md

- **Неактивная организация.** Участники организации на проверке могут только менять её данные и состав (`organization.update`, `organization.members.view`, `organization.members.manage`) без наследования на дочерние и на турниры. Приостановленная или архивная организация даёт только `organization.members.view`. Иначе создатель «федерации на проверке» мог бы одобрять дочерние организации.
- **Создатель с полномочиями не становится руководителем** (0.2.1). Иначе `PLATFORM_ADMIN` или `FEDERATION_ADMIN`, создав клуб, получали бы права `CLUB_MANAGER` (спортсмены, документы, заявки), которых нет в их ролях. Приглашение первого руководителя при создании не проверяется правилом «роль не шире своей»: это равносильно одобрению самостоятельной регистрации, которое у создателя уже есть.
- **Платформенные роли действуют только при включённом TOTP.** Без него `SUPER_ADMIN` и `PLATFORM_ADMIN` не дают прав.
- **«Роль не шире своей»** сравнивается с правами выдающего в организации и на её турнирах. Поэтому `PLATFORM_ADMIN` не выдаёт организационные роли с правами, которых у него нет (например, `CLUB_MANAGER`); это может `SUPER_ADMIN` или руководитель организации.
- Автотест маршрутов различает три объявления: `@Public`, `@Authenticated`, `@RequirePermission`. Проверка «каждое permission используется маршрутом» включается по мере появления маршрутов (Phase 3–9).

### SECURITY.md (актуализация, раздел 5)

| Мера | Статус Phase 2 |
|---|---|
| Серверная авторизация, deny by default, автотест маршрутов | Сделано |
| Zod на каждом входе, неизвестные поля отбрасываются | Сделано |
| Rate limit (Redis): вход и восстановление — 10/мин по IP и 5/мин по email; API — 600/мин; загрузки — 30/мин | Сделано. При недоступности Redis лимит не применяется (запись в лог), чтобы отказ Redis не останавливал вход |
| CSRF: signed double submit | Сделано |
| argon2id (OWASP), одинаковое время ответа для неизвестного email, проверка по локальному списку распространённых паролей | Сделано. Офлайн-база утечек (k-anonymity) — точка расширения `LeakedPasswordChecker` |
| Refresh token: ротация, обнаружение повтора, отзыв семейства; blocklist сессий в Redis с резервной проверкой по БД | Сделано |
| TOTP: секрет AES-256-GCM с привязкой к пользователю, защита от повтора кода, 10 кодов восстановления | Сделано |
| Письма с одноразовыми ссылками: адрес и ссылки в outbox зашифрованы | Сделано |
| Аудит в транзакции, без ПДн; журналы append-only на уровне прав БД | Сделано |
| Файлы: presigned POST с условиями, проверка размера, SHA-256 и сигнатуры, SVG запрещён, публичные медиа через карантин | Сделано. ClamAV — Phase 12 |
| Логи: pino redaction, тест на отсутствие секретов и ПДн | Сделано |
| Заголовки: HSTS, `nosniff`, Referrer-Policy, Permissions-Policy; CSP с nonce для скриптов | Сделано. `style-src` допускает `'unsafe-inline'`: nonce не покрывает атрибуты `style` |
| gitleaks, `pnpm audit` в CI | Сделано |
| Фиксация базовых образов по digest, подпись образов | Phase 12 |

### ARCHITECTURE.md

- Добавлен пакет `packages/server-kit` — общий серверный код api и worker (окружение, криптография, пароли, логирование).
- Порядок guards: `AuthGuard` (только определяет пользователя) → `RateLimitGuard` → `CsrfGuard` → `PermissionGuard` (отказ `401` / `403` / `404`). Так лимит API считается по пользователю, а публичный маршрут работает и с просроченным токеном.
- Письма — только через outbox (`email.requested`) → worker; обработчик идемпотентен (`ProcessedEvent`).
- Prisma Client генерируется в `packages/db/generated` — так его забирает `pnpm deploy` в Docker-образы.
- **Версии зависимостей.** Взяты последние выпуски проверенных мажорных версий: TypeScript 5.9, NestJS 11, Prisma 6, Next.js 15, ESLint 9, Vitest 3. Уже вышли TypeScript 7, NestJS 12, Prisma 7+, Next.js 16 — переход планируется отдельной задачей с проверкой на всём наборе тестов, не внутри функциональной фазы.
