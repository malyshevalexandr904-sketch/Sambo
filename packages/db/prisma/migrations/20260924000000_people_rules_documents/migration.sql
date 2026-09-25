-- Phase 3 — Athletes: People (DATABASE.md, 3.3), Rules & Setup — правила и категории (3.4), документы (3.5),
-- фоновый импорт (3.9). Часть 1 сгенерирована `prisma migrate diff` и проверена вручную;
-- часть 2 — SQL-шаги, которые Prisma не выражает (DATABASE.md, 10).
-- Уточнения к DATABASE.md: coach_membership (тренер в организации), guardian.ended_* вместо удаления,
-- guardian.verification_basis, document.reviewed_* (проверил или отклонил), import_job.error_code.

-- CreateEnum
CREATE TYPE "ProfileStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "GuardianRelation" AS ENUM ('MOTHER', 'FATHER', 'LEGAL_GUARDIAN', 'OTHER');

-- CreateEnum
CREATE TYPE "GuardianVerificationBasis" AS ENUM ('DOCUMENT_SHOWN', 'PAPER_APPLICATION');

-- CreateEnum
CREATE TYPE "ConsentKind" AS ENUM ('PD_PROCESSING', 'PD_DISTRIBUTION', 'HEALTH_DATA');

-- CreateEnum
CREATE TYPE "ConsentMethod" AS ENUM ('ELECTRONIC', 'PAPER_SCAN');

-- CreateEnum
CREATE TYPE "RuleSetVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "AgeCalculationPolicy" AS ENUM ('BY_BIRTH_YEAR', 'EXACT_ON_DATE', 'BIRTH_YEAR_RANGE');

-- CreateEnum
CREATE TYPE "WeightLimitKind" AS ENUM ('UP_TO', 'ABOVE');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('ATHLETES');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PARSED', 'COMMITTED', 'FAILED');

-- CreateTable
CREATE TABLE "athlete_profile" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "status" "ProfileStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "athlete_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_profile" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "status" "ProfileStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "coach_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_membership" (
    "id" UUID NOT NULL,
    "coach_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coach_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referee_profile" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "referee_category_code" TEXT NOT NULL,
    "category_assigned_at" DATE,
    "status" "ProfileStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "referee_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "athlete_membership" (
    "id" UUID NOT NULL,
    "athlete_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "athlete_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "athlete_coach" (
    "id" UUID NOT NULL,
    "athlete_id" UUID NOT NULL,
    "coach_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "athlete_coach_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "athlete_rank_record" (
    "id" UUID NOT NULL,
    "athlete_id" UUID NOT NULL,
    "sport_rank_code" TEXT NOT NULL,
    "assigned_at" DATE NOT NULL,
    "order_ref" TEXT,
    "document_id" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_id" UUID,
    "revoke_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "athlete_rank_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardian" (
    "id" UUID NOT NULL,
    "athlete_id" UUID NOT NULL,
    "guardian_person_id" UUID NOT NULL,
    "relation" "GuardianRelation" NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "verified_by_id" UUID,
    "verification_basis" "GuardianVerificationBasis",
    "ended_at" TIMESTAMPTZ(3),
    "ended_by_id" UUID,
    "end_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_template" (
    "id" UUID NOT NULL,
    "kind" "ConsentKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "locale" TEXT NOT NULL,
    "operator_name" TEXT NOT NULL,
    "body_markdown" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "retired_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "consent_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent" (
    "id" UUID NOT NULL,
    "subject_person_id" UUID NOT NULL,
    "given_by_person_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "competition_id" UUID,
    "method" "ConsentMethod" NOT NULL,
    "document_id" UUID,
    "given_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_id" UUID,
    "revoke_reason" TEXT,
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_set" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "discipline_code" TEXT NOT NULL,
    "owner_organization_id" UUID,
    "name" TEXT NOT NULL,
    "status" "ProfileStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rule_set_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_set_version" (
    "id" UUID NOT NULL,
    "rule_set_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "parameters" JSONB NOT NULL,
    "checksum" TEXT,
    "status" "RuleSetVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(3),
    "published_by_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rule_set_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "age_group" (
    "id" UUID NOT NULL,
    "discipline_code" TEXT NOT NULL,
    "owner_organization_id" UUID,
    "code" TEXT NOT NULL,
    "name_ru" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "policy" "AgeCalculationPolicy" NOT NULL DEFAULT 'BY_BIRTH_YEAR',
    "age_from" INTEGER NOT NULL,
    "age_to" INTEGER NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "age_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weight_category" (
    "id" UUID NOT NULL,
    "age_group_id" UUID NOT NULL,
    "gender" "Gender" NOT NULL,
    "kind" "WeightLimitKind" NOT NULL,
    "limit_grams" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "weight_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_template" (
    "id" UUID NOT NULL,
    "owner_organization_id" UUID,
    "discipline_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "category_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_template_item" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "age_group_id" UUID NOT NULL,
    "gender" "Gender" NOT NULL,
    "weight_category_id" UUID NOT NULL,

    CONSTRAINT "category_template_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document" (
    "id" UUID NOT NULL,
    "type_code" TEXT NOT NULL,
    "athlete_id" UUID,
    "application_id" UUID,
    "organization_id" UUID,
    "competition_id" UUID,
    "file_id" UUID NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "expiration_date" DATE,
    "uploaded_by_id" UUID,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "reject_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_job" (
    "id" UUID NOT NULL,
    "kind" "ImportKind" NOT NULL DEFAULT 'ATHLETES',
    "organization_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "error_code" TEXT,
    "report" JSONB,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parsed_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "import_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "athlete_profile_person_id_key" ON "athlete_profile"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "athlete_profile_public_id_key" ON "athlete_profile"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "coach_profile_person_id_key" ON "coach_profile"("person_id");

-- CreateIndex
CREATE INDEX "coach_membership_organization_id_valid_to_idx" ON "coach_membership"("organization_id", "valid_to");

-- CreateIndex
CREATE INDEX "coach_membership_coach_id_idx" ON "coach_membership"("coach_id");

-- CreateIndex
CREATE UNIQUE INDEX "referee_profile_person_id_key" ON "referee_profile"("person_id");

-- CreateIndex
CREATE INDEX "referee_profile_referee_category_code_idx" ON "referee_profile"("referee_category_code");

-- CreateIndex
CREATE INDEX "athlete_membership_organization_id_valid_to_idx" ON "athlete_membership"("organization_id", "valid_to");

-- CreateIndex
CREATE INDEX "athlete_membership_athlete_id_idx" ON "athlete_membership"("athlete_id");

-- CreateIndex
CREATE INDEX "athlete_coach_coach_id_valid_to_idx" ON "athlete_coach"("coach_id", "valid_to");

-- CreateIndex
CREATE INDEX "athlete_coach_athlete_id_idx" ON "athlete_coach"("athlete_id");

-- CreateIndex
CREATE INDEX "guardian_guardian_person_id_idx" ON "guardian"("guardian_person_id");

-- CreateIndex
CREATE INDEX "guardian_athlete_id_idx" ON "guardian"("athlete_id");

-- CreateIndex
CREATE UNIQUE INDEX "consent_template_kind_version_locale_key" ON "consent_template"("kind", "version", "locale");

-- CreateIndex
CREATE INDEX "consent_given_by_person_id_idx" ON "consent"("given_by_person_id");

-- CreateIndex
CREATE UNIQUE INDEX "rule_set_code_key" ON "rule_set"("code");

-- CreateIndex
CREATE INDEX "rule_set_owner_organization_id_idx" ON "rule_set"("owner_organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "rule_set_version_rule_set_id_version_key" ON "rule_set_version"("rule_set_id", "version");

-- CreateIndex
CREATE INDEX "age_group_discipline_code_idx" ON "age_group"("discipline_code");

-- CreateIndex
CREATE INDEX "weight_category_age_group_id_idx" ON "weight_category"("age_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "category_template_item_template_id_weight_category_id_key" ON "category_template_item"("template_id", "weight_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_file_id_key" ON "document"("file_id");

-- CreateIndex
CREATE INDEX "document_athlete_id_type_code_status_idx" ON "document"("athlete_id", "type_code", "status");

-- CreateIndex
CREATE INDEX "document_application_id_idx" ON "document"("application_id");

-- CreateIndex
CREATE INDEX "document_organization_id_idx" ON "document"("organization_id");

-- CreateIndex
CREATE INDEX "document_competition_id_idx" ON "document"("competition_id");

-- CreateIndex
CREATE INDEX "document_status_uploaded_at_idx" ON "document"("status", "uploaded_at");

-- CreateIndex
CREATE INDEX "import_job_created_by_id_created_at_idx" ON "import_job"("created_by_id", "created_at");

-- AddForeignKey
ALTER TABLE "athlete_profile" ADD CONSTRAINT "athlete_profile_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_profile" ADD CONSTRAINT "athlete_profile_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_profile" ADD CONSTRAINT "coach_profile_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_profile" ADD CONSTRAINT "coach_profile_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_membership" ADD CONSTRAINT "coach_membership_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coach_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_membership" ADD CONSTRAINT "coach_membership_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_membership" ADD CONSTRAINT "coach_membership_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referee_profile" ADD CONSTRAINT "referee_profile_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referee_profile" ADD CONSTRAINT "referee_profile_referee_category_code_fkey" FOREIGN KEY ("referee_category_code") REFERENCES "referee_category"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referee_profile" ADD CONSTRAINT "referee_profile_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_membership" ADD CONSTRAINT "athlete_membership_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athlete_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_membership" ADD CONSTRAINT "athlete_membership_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_membership" ADD CONSTRAINT "athlete_membership_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_coach" ADD CONSTRAINT "athlete_coach_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athlete_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_coach" ADD CONSTRAINT "athlete_coach_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "coach_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_coach" ADD CONSTRAINT "athlete_coach_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_rank_record" ADD CONSTRAINT "athlete_rank_record_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athlete_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_rank_record" ADD CONSTRAINT "athlete_rank_record_sport_rank_code_fkey" FOREIGN KEY ("sport_rank_code") REFERENCES "sport_rank"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_rank_record" ADD CONSTRAINT "athlete_rank_record_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_rank_record" ADD CONSTRAINT "athlete_rank_record_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_rank_record" ADD CONSTRAINT "athlete_rank_record_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athlete_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_guardian_person_id_fkey" FOREIGN KEY ("guardian_person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_ended_by_id_fkey" FOREIGN KEY ("ended_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_template" ADD CONSTRAINT "consent_template_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent" ADD CONSTRAINT "consent_subject_person_id_fkey" FOREIGN KEY ("subject_person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent" ADD CONSTRAINT "consent_given_by_person_id_fkey" FOREIGN KEY ("given_by_person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent" ADD CONSTRAINT "consent_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "consent_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent" ADD CONSTRAINT "consent_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent" ADD CONSTRAINT "consent_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent" ADD CONSTRAINT "consent_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_set" ADD CONSTRAINT "rule_set_discipline_code_fkey" FOREIGN KEY ("discipline_code") REFERENCES "discipline"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_set" ADD CONSTRAINT "rule_set_owner_organization_id_fkey" FOREIGN KEY ("owner_organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_set" ADD CONSTRAINT "rule_set_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_set_version" ADD CONSTRAINT "rule_set_version_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "rule_set"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_set_version" ADD CONSTRAINT "rule_set_version_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_set_version" ADD CONSTRAINT "rule_set_version_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "age_group" ADD CONSTRAINT "age_group_discipline_code_fkey" FOREIGN KEY ("discipline_code") REFERENCES "discipline"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "age_group" ADD CONSTRAINT "age_group_owner_organization_id_fkey" FOREIGN KEY ("owner_organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "age_group" ADD CONSTRAINT "age_group_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weight_category" ADD CONSTRAINT "weight_category_age_group_id_fkey" FOREIGN KEY ("age_group_id") REFERENCES "age_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_template" ADD CONSTRAINT "category_template_owner_organization_id_fkey" FOREIGN KEY ("owner_organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_template" ADD CONSTRAINT "category_template_discipline_code_fkey" FOREIGN KEY ("discipline_code") REFERENCES "discipline"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_template" ADD CONSTRAINT "category_template_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_template_item" ADD CONSTRAINT "category_template_item_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "category_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_template_item" ADD CONSTRAINT "category_template_item_age_group_id_fkey" FOREIGN KEY ("age_group_id") REFERENCES "age_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_template_item" ADD CONSTRAINT "category_template_item_weight_category_id_fkey" FOREIGN KEY ("weight_category_id") REFERENCES "weight_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_type_code_fkey" FOREIGN KEY ("type_code") REFERENCES "document_type"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athlete_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- =====================================================================
-- Часть 2. SQL-шаги (DATABASE.md, 10)
-- =====================================================================

-- ---------- Partial unique и частичные индексы ----------

-- Один текущий основной клуб и одно открытое членство в организации (DATABASE.md, 3.3).
CREATE UNIQUE INDEX "athlete_membership_primary_uq"
  ON "athlete_membership" ("athlete_id") WHERE "is_primary" AND "valid_to" IS NULL;
CREATE UNIQUE INDEX "athlete_membership_open_uq"
  ON "athlete_membership" ("athlete_id", "organization_id") WHERE "valid_to" IS NULL;

-- Один текущий основной тренер; тренер не связан со спортсменом дважды одновременно.
CREATE UNIQUE INDEX "athlete_coach_primary_uq"
  ON "athlete_coach" ("athlete_id") WHERE "is_primary" AND "valid_to" IS NULL;
CREATE UNIQUE INDEX "athlete_coach_open_uq"
  ON "athlete_coach" ("athlete_id", "coach_id") WHERE "valid_to" IS NULL;

CREATE UNIQUE INDEX "coach_membership_open_uq"
  ON "coach_membership" ("coach_id", "organization_id") WHERE "valid_to" IS NULL;

CREATE UNIQUE INDEX "guardian_active_uq"
  ON "guardian" ("athlete_id", "guardian_person_id") WHERE "ended_at" IS NULL;

-- Текущий разряд — последняя неотозванная запись.
CREATE INDEX "athlete_rank_record_current_idx"
  ON "athlete_rank_record" ("athlete_id", "assigned_at" DESC) WHERE "revoked_at" IS NULL;

-- Проверка действующих согласий при допуске.
CREATE INDEX "consent_active_idx"
  ON "consent" ("subject_person_id", "template_id") WHERE "revoked_at" IS NULL;

-- Шаблоны платформы (owner = NULL) и организаций не конфликтуют между собой.
CREATE UNIQUE INDEX "age_group_code_uq"
  ON "age_group" ("owner_organization_id", "discipline_code", "code") NULLS NOT DISTINCT
  WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "weight_category_limit_uq"
  ON "weight_category" ("age_group_id", "gender", "kind", "limit_grams") WHERE "deleted_at" IS NULL;

-- Фоновая задача истечения документов.
CREATE INDEX "document_expiring_idx" ON "document" ("expiration_date") WHERE "status" = 'VERIFIED';

-- Проверка дублей (G-08): кандидаты ищутся по дате рождения, затем по похожести ФИО.
CREATE INDEX "person_birth_date_idx"
  ON "person" ("birth_date") WHERE "deleted_at" IS NULL AND "merged_into_id" IS NULL;

-- ---------- CHECK-ограничения ----------

ALTER TABLE "athlete_profile"
  ADD CONSTRAINT "athlete_profile_public_id_ck" CHECK ("public_id" ~ '^[1-9A-HJ-NP-Za-km-z]{12}$');

ALTER TABLE "athlete_membership"
  ADD CONSTRAINT "athlete_membership_period_ck" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from");
ALTER TABLE "athlete_coach"
  ADD CONSTRAINT "athlete_coach_period_ck" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from");
ALTER TABLE "coach_membership"
  ADD CONSTRAINT "coach_membership_period_ck" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from");

ALTER TABLE "athlete_rank_record"
  ADD CONSTRAINT "athlete_rank_record_revoke_ck" CHECK ("revoked_at" IS NULL OR "revoke_reason" IS NOT NULL);

ALTER TABLE "guardian"
  ADD CONSTRAINT "guardian_verified_ck" CHECK (("verified_at" IS NULL) = ("verification_basis" IS NULL)),
  ADD CONSTRAINT "guardian_ended_ck" CHECK ("ended_at" IS NULL OR "end_reason" IS NOT NULL);

ALTER TABLE "consent_template"
  ADD CONSTRAINT "consent_template_locale_ck" CHECK ("locale" IN ('ru', 'en')),
  ADD CONSTRAINT "consent_template_version_ck" CHECK ("version" >= 1),
  ADD CONSTRAINT "consent_template_retired_ck" CHECK ("retired_at" IS NULL OR "published_at" IS NOT NULL);

ALTER TABLE "consent"
  ADD CONSTRAINT "consent_scan_ck" CHECK ("method" <> 'PAPER_SCAN' OR "document_id" IS NOT NULL);

ALTER TABLE "rule_set"
  ADD CONSTRAINT "rule_set_code_ck" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{1,39}$');

ALTER TABLE "rule_set_version"
  ADD CONSTRAINT "rule_set_version_number_ck" CHECK ("version" >= 1 AND "schema_version" >= 1),
  ADD CONSTRAINT "rule_set_version_published_ck"
    CHECK ("status" = 'DRAFT' OR ("published_at" IS NOT NULL AND "checksum" IS NOT NULL));

ALTER TABLE "age_group"
  ADD CONSTRAINT "age_group_code_ck" CHECK ("code" ~ '^[A-Z0-9_]{2,30}$'),
  ADD CONSTRAINT "age_group_range_ck"
    CHECK ("age_from" BETWEEN 5 AND 99 AND "age_to" BETWEEN 5 AND 99 AND "age_from" <= "age_to");

ALTER TABLE "weight_category"
  ADD CONSTRAINT "weight_category_limit_ck" CHECK ("limit_grams" BETWEEN 10000 AND 250000);

-- Ровно один владелец документа — явные FK вместо полиморфной ссылки (DATABASE.md, 3.5).
ALTER TABLE "document"
  ADD CONSTRAINT "document_owner_ck" CHECK (num_nonnulls("athlete_id", "application_id", "organization_id") = 1),
  ADD CONSTRAINT "document_rejected_ck" CHECK ("status" <> 'REJECTED' OR "reject_reason" IS NOT NULL);

ALTER TABLE "import_job"
  ADD CONSTRAINT "import_job_failed_ck" CHECK ("status" <> 'FAILED' OR "error_code" IS NOT NULL);

-- ---------- Триггеры неизменяемости (ADR-09) ----------

-- Опубликованная версия правил не меняется и не удаляется; допустим только вывод из обращения
-- (PUBLISHED → RETIRED) без изменения содержимого. Сервис проверяет то же самое раньше, триггер — страховка.
CREATE OR REPLACE FUNCTION "forbid_update_published_rule_set_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'rule_set_version % is published and immutable', OLD."id" USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF OLD."status" = 'PUBLISHED' AND NEW."status" = 'RETIRED'
     AND NEW."rule_set_id" = OLD."rule_set_id" AND NEW."version" = OLD."version"
     AND NEW."schema_version" = OLD."schema_version" AND NEW."parameters" = OLD."parameters"
     AND NEW."checksum" IS NOT DISTINCT FROM OLD."checksum"
     AND NEW."published_at" IS NOT DISTINCT FROM OLD."published_at"
     AND NEW."published_by_id" IS NOT DISTINCT FROM OLD."published_by_id" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'rule_set_version % is published and immutable', OLD."id" USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "rule_set_version_immutable"
  BEFORE UPDATE OR DELETE ON "rule_set_version"
  FOR EACH ROW EXECUTE FUNCTION "forbid_update_published_rule_set_version"();

-- Опубликованный текст согласия не меняется и не удаляется; допустимо только отметить его выведенным.
CREATE OR REPLACE FUNCTION "forbid_update_published_consent_template"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."published_at" IS NOT NULL THEN
      RAISE EXCEPTION 'consent_template % is published and immutable', OLD."id" USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."published_at" IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW."kind" = OLD."kind" AND NEW."version" = OLD."version" AND NEW."locale" = OLD."locale"
     AND NEW."operator_name" = OLD."operator_name" AND NEW."body_markdown" = OLD."body_markdown"
     AND NEW."published_at" = OLD."published_at"
     AND (OLD."retired_at" IS NULL OR NEW."retired_at" IS NOT DISTINCT FROM OLD."retired_at") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'consent_template % is published and immutable', OLD."id" USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "consent_template_immutable"
  BEFORE UPDATE OR DELETE ON "consent_template"
  FOR EACH ROW EXECUTE FUNCTION "forbid_update_published_consent_template"();

-- ---------- Права роли приложения ----------
-- Default privileges из первой миграции покрывают новые таблицы; явный GRANT — на случай, если миграции
-- выполняет другая роль-владелец.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sde_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      "athlete_profile", "coach_profile", "coach_membership", "referee_profile", "athlete_membership",
      "athlete_coach", "athlete_rank_record", "guardian", "consent_template", "consent", "rule_set",
      "rule_set_version", "age_group", "weight_category", "category_template", "category_template_item",
      "document", "import_job"
    TO sde_app;
  END IF;
END
$$;
