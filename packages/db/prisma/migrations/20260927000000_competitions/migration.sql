-- Phase 4a — Competitions: турнир, место, категории турнира, правила допуска, требования (DATABASE.md, 3.4),
-- заявки и участия (3.5; C-02), право записи турнира и журнал синхронизации (3.9, 7; ADR-21).
-- Часть 1 сгенерирована `prisma migrate diff` и проверена вручную; часть 2 — SQL-шаги, которые Prisma
-- не выражает (DATABASE.md, 10).
-- Уточнения к DATABASE.md: competition_membership.invited_email и user_id NULL (приглашение по email, как в
-- организации); entry.withdrawn_* (кто и почему снял участника); venue.deleted_at; sync_log без FK (журнал).

-- CreateEnum
CREATE TYPE "CompetitionStatus" AS ENUM ('DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN', 'DRAWING', 'SCHEDULED', 'IN_PROGRESS', 'FINISHED', 'ARCHIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CompetitionLevel" AS ENUM ('CLUB', 'CITY', 'REGIONAL', 'INTERREGIONAL', 'NATIONAL', 'INTERNATIONAL');

-- CreateEnum
CREATE TYPE "CategoryStatus" AS ENUM ('REGISTRATION', 'CLOSED', 'WEIGH_IN', 'READY_FOR_DRAW', 'DRAWN', 'IN_PROGRESS', 'COMPLETED', 'RESULTS_PUBLISHED', 'MERGED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CompetitionFormatCode" AS ENUM ('ROUND_ROBIN', 'SINGLE_ELIMINATION', 'ELIMINATION_WITH_REPECHAGE', 'DOUBLE_ELIMINATION', 'PENALTY_POINTS_ELIMINATION', 'GROUP_STAGE', 'GROUP_PLUS_PLAYOFF');

-- CreateEnum
CREATE TYPE "CategoryRuleKind" AS ENUM ('MIN_RANK', 'MAX_RANK', 'ALLOW_YOUNGER', 'MAX_CATEGORIES_PER_ATHLETE', 'REGION_ONLY');

-- CreateEnum
CREATE TYPE "RequirementKind" AS ENUM ('DOCUMENT', 'CONSENT', 'MEDICAL_CLEARANCE', 'INSURANCE', 'WEIGH_IN', 'CHECK_IN');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WAITING_DOCUMENTS', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "LeaseHolder" AS ENUM ('CLOUD', 'NODE');

-- CreateEnum
CREATE TYPE "LeaseStatus" AS ENUM ('ACTIVE', 'CHECKING_OUT', 'RETURNING', 'RECOVERED');

-- CreateEnum
CREATE TYPE "SyncOp" AS ENUM ('INSERT', 'UPDATE', 'DELETE');

-- AlterTable
ALTER TABLE "competition_membership" ADD COLUMN     "invited_email" CITEXT,
ALTER COLUMN "user_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "venue" (
    "id" UUID NOT NULL,
    "owner_organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "region_id" UUID,
    "timezone" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT,
    "description_md" TEXT,
    "organizer_organization_id" UUID NOT NULL,
    "venue_id" UUID,
    "timezone" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "registration_starts_at" TIMESTAMPTZ(3) NOT NULL,
    "registration_ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "CompetitionStatus" NOT NULL DEFAULT 'DRAFT',
    "level" "CompetitionLevel" NOT NULL,
    "discipline_code" TEXT NOT NULL,
    "rule_set_version_id" UUID,
    "logo_file_id" UUID,
    "regulation_file_id" UUID,
    "requirements_md" TEXT,
    "contact_info" JSONB,
    "name_norm" text GENERATED ALWAYS AS (replace(lower("name"), 'ё', 'е')) STORED,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "published_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "competition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_category" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_ru" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "gender" "Gender" NOT NULL,
    "age_group_id" UUID,
    "age_policy" "AgeCalculationPolicy" NOT NULL,
    "age_from" INTEGER,
    "age_to" INTEGER,
    "birth_year_from" INTEGER,
    "birth_year_to" INTEGER,
    "age_reference_date" DATE,
    "weight_kind" "WeightLimitKind" NOT NULL,
    "weight_lower_grams" INTEGER,
    "weight_upper_grams" INTEGER,
    "format_override" "CompetitionFormatCode",
    "status" "CategoryStatus" NOT NULL DEFAULT 'REGISTRATION',
    "merged_into_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "competition_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_rule" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "category_id" UUID,
    "kind" "CategoryRuleKind" NOT NULL,
    "params" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_requirement" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "category_id" UUID,
    "kind" "RequirementKind" NOT NULL,
    "document_type_code" TEXT,
    "consent_kind" "ConsentKind",
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "note_md" TEXT,

    CONSTRAINT "competition_requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "coach_id" UUID,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "representation_organization_id" UUID,
    "representation_region_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "submitted_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_id" UUID,
    "review_comment" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entry" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "athlete_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "declared_category_id" UUID NOT NULL,
    "status" "EntryStatus" NOT NULL DEFAULT 'PENDING',
    "snap_last_name" TEXT NOT NULL,
    "snap_first_name" TEXT NOT NULL,
    "snap_middle_name" TEXT,
    "snap_birth_date" DATE NOT NULL,
    "snap_gender" "Gender" NOT NULL,
    "snap_club_id" UUID,
    "snap_club_name" TEXT,
    "snap_coach_name" TEXT,
    "snap_region_id" UUID,
    "snap_region_name" TEXT,
    "snap_rank_code" TEXT,
    "representation_organization_id" UUID,
    "representation_region_id" UUID,
    "public_name" TEXT NOT NULL,
    "declared_weight_grams" INTEGER,
    "decided_at" TIMESTAMPTZ(3),
    "decided_by_id" UUID,
    "decision_reason" TEXT,
    "withdrawn_at" TIMESTAMPTZ(3),
    "withdrawn_by_id" UUID,
    "withdraw_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_write_lease" (
    "competition_id" UUID NOT NULL,
    "holder_type" "LeaseHolder" NOT NULL DEFAULT 'CLOUD',
    "holder_node_id" UUID,
    "epoch" INTEGER NOT NULL DEFAULT 1,
    "status" "LeaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_applied_sync_seq" BIGINT,
    "acquired_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acquired_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "competition_write_lease_pkey" PRIMARY KEY ("competition_id")
);

-- CreateTable
CREATE TABLE "sync_log" (
    "sync_seq" BIGSERIAL NOT NULL,
    "competition_id" UUID NOT NULL,
    "epoch" INTEGER NOT NULL,
    "table_name" TEXT NOT NULL,
    "row_id" UUID NOT NULL,
    "op" "SyncOp" NOT NULL,
    "row_image" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_log_pkey" PRIMARY KEY ("sync_seq")
);

-- CreateIndex
CREATE INDEX "venue_owner_organization_id_idx" ON "venue"("owner_organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "competition_slug_key" ON "competition"("slug");

-- CreateIndex
CREATE INDEX "competition_status_start_date_idx" ON "competition"("status", "start_date");

-- CreateIndex
CREATE INDEX "competition_organizer_organization_id_start_date_idx" ON "competition"("organizer_organization_id", "start_date");

-- CreateIndex
CREATE INDEX "competition_category_competition_id_status_idx" ON "competition_category"("competition_id", "status");

-- CreateIndex
CREATE INDEX "competition_category_competition_id_gender_age_from_idx" ON "competition_category"("competition_id", "gender", "age_from");

-- CreateIndex
CREATE UNIQUE INDEX "competition_category_competition_id_code_key" ON "competition_category"("competition_id", "code");

-- CreateIndex
CREATE INDEX "category_rule_competition_id_category_id_idx" ON "category_rule"("competition_id", "category_id");

-- CreateIndex
CREATE INDEX "competition_requirement_competition_id_idx" ON "competition_requirement"("competition_id");

-- CreateIndex
CREATE INDEX "application_competition_id_status_idx" ON "application"("competition_id", "status");

-- CreateIndex
CREATE INDEX "application_organization_id_competition_id_idx" ON "application"("organization_id", "competition_id");

-- CreateIndex
CREATE INDEX "entry_competition_id_status_idx" ON "entry"("competition_id", "status");

-- CreateIndex
CREATE INDEX "entry_application_id_idx" ON "entry"("application_id");

-- CreateIndex
CREATE INDEX "entry_athlete_id_idx" ON "entry"("athlete_id");

-- CreateIndex
CREATE INDEX "entry_category_id_status_idx" ON "entry"("category_id", "status");

-- CreateIndex
CREATE INDEX "sync_log_competition_id_sync_seq_idx" ON "sync_log"("competition_id", "sync_seq");

-- CreateIndex
CREATE INDEX "sync_log_created_at_idx" ON "sync_log"("created_at");

-- AddForeignKey
ALTER TABLE "venue" ADD CONSTRAINT "venue_owner_organization_id_fkey" FOREIGN KEY ("owner_organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue" ADD CONSTRAINT "venue_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue" ADD CONSTRAINT "venue_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition" ADD CONSTRAINT "competition_organizer_organization_id_fkey" FOREIGN KEY ("organizer_organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition" ADD CONSTRAINT "competition_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition" ADD CONSTRAINT "competition_discipline_code_fkey" FOREIGN KEY ("discipline_code") REFERENCES "discipline"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition" ADD CONSTRAINT "competition_rule_set_version_id_fkey" FOREIGN KEY ("rule_set_version_id") REFERENCES "rule_set_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition" ADD CONSTRAINT "competition_logo_file_id_fkey" FOREIGN KEY ("logo_file_id") REFERENCES "stored_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition" ADD CONSTRAINT "competition_regulation_file_id_fkey" FOREIGN KEY ("regulation_file_id") REFERENCES "stored_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition" ADD CONSTRAINT "competition_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition" ADD CONSTRAINT "competition_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_category" ADD CONSTRAINT "competition_category_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_category" ADD CONSTRAINT "competition_category_age_group_id_fkey" FOREIGN KEY ("age_group_id") REFERENCES "age_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_category" ADD CONSTRAINT "competition_category_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "competition_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_rule" ADD CONSTRAINT "category_rule_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_rule" ADD CONSTRAINT "category_rule_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "competition_category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_requirement" ADD CONSTRAINT "competition_requirement_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_requirement" ADD CONSTRAINT "competition_requirement_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "competition_category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_requirement" ADD CONSTRAINT "competition_requirement_document_type_code_fkey" FOREIGN KEY ("document_type_code") REFERENCES "document_type"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application" ADD CONSTRAINT "application_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application" ADD CONSTRAINT "application_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application" ADD CONSTRAINT "application_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coach_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application" ADD CONSTRAINT "application_representation_organization_id_fkey" FOREIGN KEY ("representation_organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application" ADD CONSTRAINT "application_representation_region_id_fkey" FOREIGN KEY ("representation_region_id") REFERENCES "region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application" ADD CONSTRAINT "application_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application" ADD CONSTRAINT "application_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application" ADD CONSTRAINT "application_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry" ADD CONSTRAINT "entry_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry" ADD CONSTRAINT "entry_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry" ADD CONSTRAINT "entry_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athlete_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry" ADD CONSTRAINT "entry_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "competition_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry" ADD CONSTRAINT "entry_declared_category_id_fkey" FOREIGN KEY ("declared_category_id") REFERENCES "competition_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry" ADD CONSTRAINT "entry_snap_club_id_fkey" FOREIGN KEY ("snap_club_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry" ADD CONSTRAINT "entry_snap_region_id_fkey" FOREIGN KEY ("snap_region_id") REFERENCES "region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry" ADD CONSTRAINT "entry_representation_organization_id_fkey" FOREIGN KEY ("representation_organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry" ADD CONSTRAINT "entry_representation_region_id_fkey" FOREIGN KEY ("representation_region_id") REFERENCES "region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry" ADD CONSTRAINT "entry_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry" ADD CONSTRAINT "entry_withdrawn_by_id_fkey" FOREIGN KEY ("withdrawn_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry" ADD CONSTRAINT "entry_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_write_lease" ADD CONSTRAINT "competition_write_lease_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_write_lease" ADD CONSTRAINT "competition_write_lease_acquired_by_id_fkey" FOREIGN KEY ("acquired_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Внешние ключи на турнир и заявку для таблиц Phase 2–3 ----------
-- До Phase 4 турнир «существовал» через персонал (CompetitionMembership), а документы и согласия хранили
-- его идентификатор без FK. Ключи добавляются NOT VALID: новые строки проверяются сразу, а существующие —
-- ниже, если ссылок на несуществующие турниры нет (на чистой базе — всегда). В базе разработки со старым
-- seed ключ проверяется после повторного seed: `ALTER TABLE … VALIDATE CONSTRAINT …` (DEPLOYMENT.md).
-- AddForeignKey
ALTER TABLE "competition_membership" ADD CONSTRAINT "competition_membership_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "consent" ADD CONSTRAINT "consent_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "competition_membership" m WHERE NOT EXISTS (SELECT 1 FROM "competition" c WHERE c."id" = m."competition_id")) THEN
    ALTER TABLE "competition_membership" VALIDATE CONSTRAINT "competition_membership_competition_id_fkey";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "consent" x WHERE x."competition_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "competition" c WHERE c."id" = x."competition_id")) THEN
    ALTER TABLE "consent" VALIDATE CONSTRAINT "consent_competition_id_fkey";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "document" x WHERE x."competition_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "competition" c WHERE c."id" = x."competition_id")) THEN
    ALTER TABLE "document" VALIDATE CONSTRAINT "document_competition_id_fkey";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "document" x WHERE x."application_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "application" a WHERE a."id" = x."application_id")) THEN
    ALTER TABLE "document" VALIDATE CONSTRAINT "document_application_id_fkey";
  END IF;
END
$$;



-- =====================================================================
-- Часть 2. SQL-шаги (DATABASE.md, 10)
-- =====================================================================

-- ---------- Partial unique и частичные индексы ----------

-- Персонал турнира: как в организации — одно действующее членство пользователя с ролью
-- и одно ожидающее приглашение на email с ролью (приглашённого ещё нет в системе).
DROP INDEX "competition_membership_active_uq";
CREATE UNIQUE INDEX "competition_membership_active_uq"
  ON "competition_membership" ("competition_id", "user_id", "role_id")
  WHERE "status" IN ('INVITED', 'ACTIVE') AND "user_id" IS NOT NULL;
CREATE UNIQUE INDEX "competition_membership_invite_uq"
  ON "competition_membership" ("competition_id", "invited_email", "role_id")
  WHERE "status" = 'INVITED' AND "user_id" IS NULL;

-- Раздел 53: спортсмена нельзя заявить в одну категорию дважды (гонку двух запросов ловит база).
CREATE UNIQUE INDEX "entry_active_uq"
  ON "entry" ("category_id", "athlete_id") WHERE "status" NOT IN ('REJECTED', 'WITHDRAWN');

-- Нет дублей требований положения (NULLS NOT DISTINCT: требование на весь турнир — category_id пуст).
CREATE UNIQUE INDEX "competition_requirement_uq"
  ON "competition_requirement" ("competition_id", "category_id", "kind", "document_type_code", "consent_kind")
  NULLS NOT DISTINCT;

-- Поиск турниров по названию и публичный список опубликованных турниров.
CREATE INDEX "competition_name_norm_trgm_idx" ON "competition" USING GIN ("name_norm" gin_trgm_ops);
CREATE INDEX "competition_public_idx"
  ON "competition" ("start_date", "id") WHERE "deleted_at" IS NULL AND "status" <> 'DRAFT';

-- ---------- CHECK-ограничения ----------

ALTER TABLE "venue"
  ADD CONSTRAINT "venue_timezone_ck" CHECK (length("timezone") BETWEEN 1 AND 64);

-- Сроки турнира (раздел 53). Точное правило «регистрация заканчивается не позже даты начала в timezone
-- турнира» проверяет сервис; база — страховка, не зависящая от часового пояса сессии.
ALTER TABLE "competition"
  ADD CONSTRAINT "competition_slug_ck" CHECK ("slug" ~ '^[a-z0-9-]{3,80}$'),
  ADD CONSTRAINT "competition_timezone_ck" CHECK (length("timezone") BETWEEN 1 AND 64),
  ADD CONSTRAINT "competition_dates_ck" CHECK ("start_date" <= "end_date"),
  ADD CONSTRAINT "competition_registration_window_ck"
    CHECK ("registration_starts_at" < "registration_ends_at"
           AND "registration_ends_at" < (("start_date" + 2)::timestamp AT TIME ZONE 'UTC')),
  -- Опубликованный турнир всегда с закреплённой версией правил.
  ADD CONSTRAINT "competition_ruleset_ck"
    CHECK ("status" IN ('DRAFT', 'CANCELLED') OR "rule_set_version_id" IS NOT NULL),
  ADD CONSTRAINT "competition_cancel_ck" CHECK ("status" <> 'CANCELLED' OR "cancel_reason" IS NOT NULL);

ALTER TABLE "competition_category"
  ADD CONSTRAINT "competition_category_code_ck" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_+-]{1,39}$'),
  ADD CONSTRAINT "competition_category_weight_ck"
    CHECK (("weight_kind" = 'ABOVE' AND "weight_lower_grams" IS NOT NULL AND "weight_upper_grams" IS NULL)
        OR ("weight_kind" = 'UP_TO' AND "weight_upper_grams" IS NOT NULL
            AND ("weight_lower_grams" IS NULL OR "weight_lower_grams" < "weight_upper_grams"))),
  ADD CONSTRAINT "competition_category_weight_range_ck"
    CHECK (("weight_lower_grams" IS NULL OR "weight_lower_grams" BETWEEN 10000 AND 250000)
       AND ("weight_upper_grams" IS NULL OR "weight_upper_grams" BETWEEN 10000 AND 250000)),
  ADD CONSTRAINT "competition_category_age_ck"
    CHECK (("age_from" IS NULL OR "age_to" IS NULL OR "age_from" <= "age_to")
       AND ("birth_year_from" IS NULL OR "birth_year_to" IS NULL OR "birth_year_from" <= "birth_year_to")),
  ADD CONSTRAINT "competition_category_merge_ck"
    CHECK (("status" = 'MERGED') = ("merged_into_id" IS NOT NULL) AND "merged_into_id" IS DISTINCT FROM "id");

ALTER TABLE "competition_requirement"
  ADD CONSTRAINT "competition_requirement_kind_ck"
    CHECK (CASE "kind"
             WHEN 'DOCUMENT' THEN "document_type_code" IS NOT NULL AND "consent_kind" IS NULL
             WHEN 'INSURANCE' THEN "document_type_code" IS NOT NULL AND "consent_kind" IS NULL
             WHEN 'CONSENT' THEN "consent_kind" IS NOT NULL AND "document_type_code" IS NULL
             ELSE "document_type_code" IS NULL AND "consent_kind" IS NULL
           END);

ALTER TABLE "application"
  ADD CONSTRAINT "application_submitted_ck"
    CHECK ("status" IN ('DRAFT', 'CANCELLED') OR "submitted_at" IS NOT NULL),
  ADD CONSTRAINT "application_comment_ck"
    CHECK ("status" NOT IN ('REJECTED', 'WAITING_DOCUMENTS') OR "review_comment" IS NOT NULL);

ALTER TABLE "entry"
  ADD CONSTRAINT "entry_rejected_ck" CHECK ("status" <> 'REJECTED' OR "decision_reason" IS NOT NULL),
  ADD CONSTRAINT "entry_withdrawn_ck" CHECK ("status" <> 'WITHDRAWN' OR "withdraw_reason" IS NOT NULL),
  ADD CONSTRAINT "entry_declared_weight_ck"
    CHECK ("declared_weight_grams" IS NULL OR "declared_weight_grams" BETWEEN 10000 AND 250000);

-- Один держатель права записи (ADR-21): у узла есть идентификатор, у облака — нет.
ALTER TABLE "competition_write_lease"
  ADD CONSTRAINT "competition_write_lease_holder_ck" CHECK (("holder_type" = 'NODE') = ("holder_node_id" IS NOT NULL)),
  ADD CONSTRAINT "competition_write_lease_epoch_ck" CHECK ("epoch" >= 1);

-- ---------- Журнал синхронизации (DATABASE.md, 7) ----------

-- Триггеры операционных таблиц пишут образ строки. Код приложения для этого ничего не делает, поэтому
-- пропустить изменение нельзя. При применении пачки с узла облако выставляет `SET LOCAL app.replication = 'on'`,
-- и триггеры не пишут изменения повторно (Phase 9.5). Аргумент триггера — колонка с идентификатором турнира.
CREATE OR REPLACE FUNCTION "sync_log_capture"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_row jsonb;
  v_competition uuid;
  v_epoch int;
BEGIN
  IF current_setting('app.replication', true) = 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    v_row := to_jsonb(OLD);
  ELSE
    v_row := to_jsonb(NEW);
  END IF;
  v_competition := (v_row ->> TG_ARGV[0])::uuid;
  SELECT "epoch" INTO v_epoch FROM "competition_write_lease" WHERE "competition_id" = v_competition;
  INSERT INTO "sync_log" ("competition_id", "epoch", "table_name", "row_id", "op", "row_image")
  VALUES (
    v_competition,
    COALESCE(v_epoch, 1),
    TG_TABLE_NAME,
    (v_row ->> 'id')::uuid,
    TG_OP::"SyncOp",
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE v_row END
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER "competition_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "competition"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('id');
CREATE TRIGGER "competition_category_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "competition_category"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "competition_membership_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "competition_membership"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "entry_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "entry"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');

-- ---------- Права роли приложения ----------
-- Default privileges из первой миграции покрывают новые таблицы; явный GRANT — на случай, если миграции
-- выполняет другая роль-владелец. Журнал синхронизации не правится: только вставка (триггеры) и удаление
-- по сроку хранения (worker, DATABASE.md, 9).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sde_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      "venue", "competition", "competition_category", "category_rule", "competition_requirement",
      "application", "entry", "competition_write_lease"
    TO sde_app;
    GRANT SELECT, INSERT, DELETE ON TABLE "sync_log" TO sde_app;
    REVOKE UPDATE, TRUNCATE ON TABLE "sync_log" FROM sde_app;
    GRANT USAGE, SELECT ON SEQUENCE "sync_log_sync_seq_seq" TO sde_app;
  END IF;
END
$$;
