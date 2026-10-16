-- Phase 9a «Регистрация в системе по ролям» (DATABASE.md, 3.10): заявки руководителя спортивной организации, тренера,
-- спортсмена и судьи, их документы и история статусов; право тренера рассматривать заявки спортсменов; новые типы
-- документов; право `onboarding.review` в каталоге прав. Только расширение: существующие таблицы и данные не меняются,
-- кроме новой колонки coach_membership.can_review_athletes (по умолчанию false).

-- ---------- Перечисления ----------

CREATE TYPE "OnboardingRole" AS ENUM ('ORGANIZATION_HEAD', 'COACH', 'ATHLETE', 'REFEREE');
CREATE TYPE "OnboardingKind" AS ENUM ('REGISTRATION', 'JOIN_ORGANIZATION');
CREATE TYPE "OnboardingStatus" AS ENUM (
  'DRAFT', 'PENDING_REVIEW', 'PENDING_ORGANIZATION_APPROVAL', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'CANCELLED'
);
CREATE TYPE "OrganizationLegalForm" AS ENUM ('RU_LEGAL_ENTITY', 'FOREIGN', 'OTHER');

-- ---------- Заявка ----------

CREATE TABLE "onboarding_request" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "OnboardingRole" NOT NULL,
    "kind" "OnboardingKind" NOT NULL DEFAULT 'REGISTRATION',
    "status" "OnboardingStatus" NOT NULL DEFAULT 'DRAFT',
    "in_organization" BOOLEAN,
    "organization_id" UUID,
    "coach_id" UUID,
    "last_name" TEXT,
    "first_name" TEXT,
    "middle_name" TEXT,
    "birth_date" DATE,
    "gender" "Gender",
    "phone" TEXT,
    "contact_email" CITEXT,
    "telegram" TEXT,
    "contact_channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "coach_qualification" TEXT,
    "referee_category_code" TEXT,
    "org_name" TEXT,
    "org_short_name" TEXT,
    "org_type" "OrganizationType",
    "org_legal_form" "OrganizationLegalForm",
    "org_country_code" CHAR(2),
    "org_region_id" UUID,
    "org_city" TEXT,
    "org_inn" TEXT,
    "org_ogrn" TEXT,
    "org_legal_name" TEXT,
    "org_legal_address" TEXT,
    "consent_template_id" UUID,
    "consent_given_at" TIMESTAMPTZ(3),
    "decision_reason" TEXT,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3),
    "result_organization_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "onboarding_request_pkey" PRIMARY KEY ("id"),
    -- Способы связи — из перечня; Telegram выбран → имя пользователя указано (проверяется и сервером при отправке).
    CONSTRAINT "onboarding_request_channels_check" CHECK (
      "contact_channels" <@ ARRAY['EMAIL', 'PHONE', 'TELEGRAM']::TEXT[]
    ),
    CONSTRAINT "onboarding_request_phone_check" CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9][0-9]{6,14}$'),
    CONSTRAINT "onboarding_request_inn_check" CHECK ("org_inn" IS NULL OR "org_inn" ~ '^([0-9]{10}|[0-9]{12})$'),
    -- Присоединение к организации — только тренер и спортсмен, и только с выбранной организацией.
    CONSTRAINT "onboarding_request_join_check" CHECK (
      "kind" = 'REGISTRATION' OR ("role" IN ('COACH', 'ATHLETE') AND "organization_id" IS NOT NULL)
    ),
    -- Заявка, ушедшая с черновика, отправлена: есть время отправки и согласие на обработку ПДн.
    CONSTRAINT "onboarding_request_submitted_check" CHECK (
      "status" IN ('DRAFT', 'CANCELLED') OR ("submitted_at" IS NOT NULL AND "consent_given_at" IS NOT NULL)
    ),
    -- Решение принято → известно кто и когда; отказ и запрос исправлений — с причиной.
    CONSTRAINT "onboarding_request_decision_check" CHECK (
      "status" NOT IN ('APPROVED', 'REJECTED') OR ("decided_at" IS NOT NULL AND "decided_by_id" IS NOT NULL)
    ),
    CONSTRAINT "onboarding_request_reason_check" CHECK (
      "status" NOT IN ('REJECTED', 'CHANGES_REQUESTED') OR "decision_reason" IS NOT NULL
    )
);

-- Одна незавершённая заявка пользователя на роль: повторная отправка или второй черновик той же роли невозможны.
CREATE UNIQUE INDEX "onboarding_request_open_uq" ON "onboarding_request" ("user_id", "role")
  WHERE "status" IN ('DRAFT', 'PENDING_REVIEW', 'PENDING_ORGANIZATION_APPROVAL', 'CHANGES_REQUESTED');

CREATE INDEX "onboarding_request_user_id_status_idx" ON "onboarding_request"("user_id", "status");
CREATE INDEX "onboarding_request_status_role_submitted_at_idx" ON "onboarding_request"("status", "role", "submitted_at");
CREATE INDEX "onboarding_request_organization_id_status_idx" ON "onboarding_request"("organization_id", "status");
CREATE INDEX "onboarding_request_coach_id_status_idx" ON "onboarding_request"("coach_id", "status");
-- Поиск дублей регистрируемой организации среди незавершённых заявок: ИНН и нормализованное название.
CREATE INDEX "onboarding_request_org_inn_idx" ON "onboarding_request"("org_inn") WHERE "org_inn" IS NOT NULL;

ALTER TABLE "onboarding_request" ADD CONSTRAINT "onboarding_request_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "onboarding_request" ADD CONSTRAINT "onboarding_request_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "onboarding_request" ADD CONSTRAINT "onboarding_request_coach_id_fkey"
  FOREIGN KEY ("coach_id") REFERENCES "coach_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "onboarding_request" ADD CONSTRAINT "onboarding_request_referee_category_code_fkey"
  FOREIGN KEY ("referee_category_code") REFERENCES "referee_category"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "onboarding_request" ADD CONSTRAINT "onboarding_request_org_region_id_fkey"
  FOREIGN KEY ("org_region_id") REFERENCES "region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "onboarding_request" ADD CONSTRAINT "onboarding_request_consent_template_id_fkey"
  FOREIGN KEY ("consent_template_id") REFERENCES "consent_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "onboarding_request" ADD CONSTRAINT "onboarding_request_decided_by_id_fkey"
  FOREIGN KEY ("decided_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "onboarding_request" ADD CONSTRAINT "onboarding_request_result_organization_id_fkey"
  FOREIGN KEY ("result_organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Документы заявки ----------

CREATE TABLE "onboarding_document" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "type_code" TEXT NOT NULL,
    "file_id" UUID NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "onboarding_document_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "onboarding_document_file_id_key" ON "onboarding_document"("file_id");
CREATE INDEX "onboarding_document_request_id_idx" ON "onboarding_document"("request_id");

ALTER TABLE "onboarding_document" ADD CONSTRAINT "onboarding_document_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "onboarding_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "onboarding_document" ADD CONSTRAINT "onboarding_document_type_code_fkey"
  FOREIGN KEY ("type_code") REFERENCES "document_type"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "onboarding_document" ADD CONSTRAINT "onboarding_document_file_id_fkey"
  FOREIGN KEY ("file_id") REFERENCES "stored_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "onboarding_document" ADD CONSTRAINT "onboarding_document_uploaded_by_id_fkey"
  FOREIGN KEY ("uploaded_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- История статусов (только добавление) ----------

CREATE TABLE "onboarding_status_change" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "from_status" "OnboardingStatus",
    "to_status" "OnboardingStatus" NOT NULL,
    "actor_user_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_status_change_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "onboarding_status_change_request_id_created_at_idx"
  ON "onboarding_status_change"("request_id", "created_at");

ALTER TABLE "onboarding_status_change" ADD CONSTRAINT "onboarding_status_change_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "onboarding_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "onboarding_status_change" ADD CONSTRAINT "onboarding_status_change_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Тренер: право рассматривать заявки спортсменов ----------

ALTER TABLE "coach_membership" ADD COLUMN "can_review_athletes" BOOLEAN NOT NULL DEFAULT false;

-- ---------- Типы документов заявок (справочник; существующие записи не перезаписываются) ----------

INSERT INTO "document_type" ("code", "name_ru", "name_en", "sensitivity", "allowed_mime", "max_size_bytes", "retention_days") VALUES
  ('EGRUL_EXTRACT', 'Выписка из ЕГРЮЛ', 'Extract from the Unified State Register of Legal Entities', 'GENERAL'::"Sensitivity", 'application/pdf,image/jpeg,image/png', 10485760, 1095),
  ('REFEREE_BOOK', 'Судейская книжка', 'Referee record book', 'IDENTITY'::"Sensitivity", 'application/pdf,image/jpeg,image/png', 10485760, 1095),
  ('COACH_QUALIFICATION', 'Документ о квалификации тренера', 'Coach qualification document', 'GENERAL'::"Sensitivity", 'application/pdf,image/jpeg,image/png', 10485760, 1095)
ON CONFLICT ("code") DO NOTHING;

-- ---------- Каталог прав: onboarding.review (packages/contracts/src/permissions.ts, roles.ts) ----------

INSERT INTO "permission" ("code", "module", "description", "scopes") VALUES
  ('onboarding.review', 'onboarding', 'Проверка заявок на регистрацию в системе и на вступление в организацию', ARRAY['PLATFORM', 'ORGANIZATION']::"RoleScope"[])
ON CONFLICT ("code") DO UPDATE SET "module" = EXCLUDED."module", "description" = EXCLUDED."description", "scopes" = EXCLUDED."scopes";

INSERT INTO "role_permission" ("role_id", "permission_code", "mode")
SELECT r."id", 'onboarding.review', 'DIRECT'::"GrantMode"
FROM "role" r
WHERE r."code" IN ('SUPER_ADMIN', 'PLATFORM_ADMIN', 'FEDERATION_ADMIN', 'CLUB_MANAGER')
ON CONFLICT ("role_id", "permission_code") DO UPDATE SET "mode" = EXCLUDED."mode";

-- Права ролей изменились → кэш эффективных прав всех пользователей устарел
UPDATE "user" SET "permissions_version" = "permissions_version" + 1;

-- ---------- Права роли приложения ----------
-- Новые таблицы получают права по умолчанию (ALTER DEFAULT PRIVILEGES, миграция foundation); явно — на случай,
-- если миграцию применяет другая роль. История статусов — только добавление: UPDATE и DELETE роли приложения не нужны.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sde_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "onboarding_request", "onboarding_document" TO sde_app;
    GRANT SELECT, INSERT ON TABLE "onboarding_status_change" TO sde_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "onboarding_status_change" FROM sde_app;
  END IF;
END
$$;
