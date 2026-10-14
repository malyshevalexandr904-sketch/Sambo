-- Phase 8b «Уведомления» (DATABASE.md, 3.8): устройства Web Push, подписки на спортсменов, настройка турнира
-- «уведомлять о схватке за N схваток». Подписки — данные пользователя, а не операционные данные турнира: в журнал
-- синхронизации (ADR-21) не пишутся и на площадочный узел не уходят.

-- ---------- Устройства Web Push ----------
-- Подписка браузера: адрес push-службы (`endpoint`) и ключи шифрования устройства. Привязана к сессии входа
-- (`session_id` — семейство refresh token): после выхода или окончания сессии уведомления на устройство не уходят.

CREATE TABLE "push_subscription" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),

    CONSTRAINT "push_subscription_pkey" PRIMARY KEY ("id"),
    -- Адрес push-службы — только https; длина и ключи — в границах спецификации (RFC 8291: p256dh — 65 байт,
    -- auth — 16 байт в base64url).
    CONSTRAINT "push_subscription_endpoint_check" CHECK ("endpoint" LIKE 'https://%' AND char_length("endpoint") <= 2048),
    CONSTRAINT "push_subscription_keys_check" CHECK (
      char_length("p256dh") BETWEEN 80 AND 100 AND char_length("auth") BETWEEN 16 AND 32
    ),
    CONSTRAINT "push_subscription_user_agent_check" CHECK ("user_agent" IS NULL OR char_length("user_agent") <= 200)
);

CREATE UNIQUE INDEX "push_subscription_endpoint_key" ON "push_subscription"("endpoint");
CREATE INDEX "push_subscription_user_id_idx" ON "push_subscription"("user_id");
CREATE INDEX "push_subscription_session_id_idx" ON "push_subscription"("session_id");

ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Подписки на спортсменов ----------

CREATE TYPE "FollowTarget" AS ENUM ('ATHLETE');

CREATE TABLE "follow" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "target_type" "FollowTarget" NOT NULL,
    "target_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "follow_user_id_target_type_target_id_key" ON "follow"("user_id", "target_type", "target_id");
CREATE INDEX "follow_target_type_target_id_idx" ON "follow"("target_type", "target_id");

ALTER TABLE "follow" ADD CONSTRAINT "follow_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Турнир: «уведомлять о схватке за N схваток» ----------

ALTER TABLE "competition" ADD COLUMN "notify_matches_ahead" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "competition" ADD CONSTRAINT "competition_notify_matches_ahead_check"
  CHECK ("notify_matches_ahead" BETWEEN 0 AND 10);

-- ---------- Права роли приложения ----------
-- Новые таблицы получают права по умолчанию (ALTER DEFAULT PRIVILEGES, миграция foundation); явно — на случай,
-- если миграцию применяет другая роль.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sde_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "push_subscription", "follow" TO sde_app;
  END IF;
END
$$;
