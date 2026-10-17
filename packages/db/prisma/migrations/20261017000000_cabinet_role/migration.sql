-- 0.13.0 «Роль в кабинете»: человек с несколькими ролями (руководитель клуба и тренер, судья и родитель) работает в
-- одной выбранной — права на сервере действуют только для неё (docs/README.md, «Изменения 0.13.0»).
-- Выбор хранится на сессию входа (`session_id` — семейство refresh token, как у push_subscription): планшет судьи и
-- телефон того же человека в роли представителя не мешают друг другу. `role` NULL — у пользователя пока нет ролей.
-- `permissions_version` — версия прав пользователя на момент выбора: при изменении ролей выбор проверяется заново.
-- Данные пользователя, не турнира: в журнал синхронизации (ADR-21) не пишутся.

CREATE TABLE "session_role" (
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT,
    "permissions_version" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_role_pkey" PRIMARY KEY ("session_id"),
    CONSTRAINT "session_role_role_check" CHECK ("role" IS NULL OR "role" IN (
      'ADMIN', 'ORGANIZATION_HEAD', 'TOURNAMENT_STAFF', 'REFEREE', 'MEDICAL', 'COACH', 'ATHLETE', 'GUARDIAN'
    ))
);

CREATE INDEX "session_role_user_id_idx" ON "session_role"("user_id");

ALTER TABLE "session_role" ADD CONSTRAINT "session_role_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Последняя выбранная роль — с неё начинается новая сессия; при регистрации — роль, выбранная до заполнения формы.
ALTER TABLE "user" ADD COLUMN "preferred_role" TEXT;
ALTER TABLE "user" ADD CONSTRAINT "user_preferred_role_check" CHECK ("preferred_role" IS NULL OR "preferred_role" IN (
  'ADMIN', 'ORGANIZATION_HEAD', 'TOURNAMENT_STAFF', 'REFEREE', 'MEDICAL', 'COACH', 'ATHLETE', 'GUARDIAN'
));

-- ---------- Права роли приложения ----------
-- Новые таблицы получают права по умолчанию (ALTER DEFAULT PRIVILEGES, миграция foundation); явно — на случай,
-- если миграцию применяет другая роль.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sde_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "session_role" TO sde_app;
  END IF;
END
$$;
