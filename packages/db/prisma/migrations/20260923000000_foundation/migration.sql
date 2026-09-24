-- Phase 2 — Foundation: Identity & Access, Organizations, Platform (DATABASE.md, 3.1, 3.2, 3.9).
-- Часть 1 сгенерирована `prisma migrate diff` и отредактирована вручную:
--   * audit_log и data_access_log партиционированы по месяцам (DATABASE.md, 8);
--   * *_norm — генерируемые колонки (DATABASE.md, 1.4).
-- Часть 2 — SQL-шаги, которые Prisma не выражает (DATABASE.md, 10).

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('EMAIL_PASSWORD', 'TELEGRAM', 'MAX');

-- CreateEnum
CREATE TYPE "TokenPurpose" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET', 'INVITE', 'MESSENGER_LINK');

-- CreateEnum
CREATE TYPE "RoleScope" AS ENUM ('PLATFORM', 'ORGANIZATION', 'COMPETITION');

-- CreateEnum
CREATE TYPE "GrantMode" AS ENUM ('DIRECT', 'POLICY', 'INHERITED', 'LIMITED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'ENDED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('NATIONAL_FEDERATION', 'REGIONAL_FEDERATION', 'CLUB', 'SPORTS_SCHOOL', 'ORGANIZER', 'OTHER');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('PENDING_REVIEW', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Sensitivity" AS ENUM ('HEALTH', 'IDENTITY', 'GENERAL');

-- CreateEnum
CREATE TYPE "FileBucket" AS ENUM ('PUBLIC_MEDIA', 'PRIVATE_DOCUMENTS', 'GENERATED');

-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('PENDING_UPLOAD', 'AVAILABLE', 'REJECTED', 'DELETED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'NODE');

-- CreateEnum
CREATE TYPE "AccessAction" AS ENUM ('VIEW', 'DOWNLOAD', 'DENIED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DISPATCHED', 'FAILED');

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "email" CITEXT,
    "email_verified_at" TIMESTAMPTZ(3),
    "display_name" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "timezone" TEXT,
    "person_id" UUID,
    "totp_secret_enc" BYTEA,
    "totp_enabled_at" TIMESTAMPTZ(3),
    "totp_recovery_code_hashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "permissions_version" INTEGER NOT NULL DEFAULT 1,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_identity" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "provider_subject" TEXT NOT NULL,
    "secret_hash" TEXT,
    "metadata" JSONB,
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "replaced_by_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoke_reason" TEXT,
    "ip" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_token" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "purpose" "TokenPurpose" NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "payload" JSONB,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "scope" "RoleScope" NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "name_key" TEXT NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "scopes" "RoleScope"[],

    CONSTRAINT "permission_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "role_id" UUID NOT NULL,
    "permission_code" TEXT NOT NULL,
    "mode" "GrantMode" NOT NULL DEFAULT 'DIRECT',

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_id","permission_code")
);

-- CreateTable
CREATE TABLE "platform_role_assignment" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "granted_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "platform_role_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_membership" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID,
    "invited_email" CITEXT,
    "role_id" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "valid_from" DATE,
    "valid_to" DATE,
    "invited_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_membership" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "invited_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "competition_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person" (
    "id" UUID NOT NULL,
    "last_name" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "birth_date" DATE NOT NULL,
    "gender" "Gender" NOT NULL,
    "country_code" CHAR(2),
    "region_id" UUID,
    "city" TEXT,
    "photo_file_id" UUID,
    "last_name_norm" text GENERATED ALWAYS AS (replace(lower("last_name"), 'ё', 'е')) STORED,
    "first_name_norm" text GENERATED ALWAYS AS (replace(lower("first_name"), 'ё', 'е')) STORED,
    "merged_into_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "country" (
    "code" CHAR(2) NOT NULL,
    "name_ru" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,

    CONSTRAINT "country_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "region" (
    "id" UUID NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "code" TEXT NOT NULL,
    "name_ru" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,

    CONSTRAINT "region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization" (
    "id" UUID NOT NULL,
    "type" "OrganizationType" NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "short_name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo_file_id" UUID,
    "country_code" CHAR(2) NOT NULL,
    "region_id" UUID,
    "city" TEXT,
    "address" TEXT,
    "contact_email" CITEXT,
    "contact_phone" TEXT,
    "website" TEXT,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "name_norm" text GENERATED ALWAYS AS (replace(lower("name"), 'ё', 'е')) STORED,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_legal_details" (
    "organization_id" UUID NOT NULL,
    "legal_name" TEXT NOT NULL,
    "inn" TEXT NOT NULL,
    "kpp" TEXT,
    "ogrn" TEXT,
    "legal_address" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_legal_details_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "organization_closure" (
    "ancestor_id" UUID NOT NULL,
    "descendant_id" UUID NOT NULL,
    "depth" INTEGER NOT NULL,

    CONSTRAINT "organization_closure_pkey" PRIMARY KEY ("ancestor_id","descendant_id")
);

-- CreateTable
CREATE TABLE "sport_rank" (
    "code" TEXT NOT NULL,
    "name_ru" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "rank_order" INTEGER NOT NULL,

    CONSTRAINT "sport_rank_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "referee_category" (
    "code" TEXT NOT NULL,
    "name_ru" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "rank_order" INTEGER NOT NULL,

    CONSTRAINT "referee_category_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "discipline" (
    "code" TEXT NOT NULL,
    "name_ru" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,

    CONSTRAINT "discipline_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "document_type" (
    "code" TEXT NOT NULL,
    "name_ru" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "sensitivity" "Sensitivity" NOT NULL,
    "allowed_mime" TEXT NOT NULL,
    "max_size_bytes" INTEGER NOT NULL,
    "retention_days" INTEGER NOT NULL,

    CONSTRAINT "document_type_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "stored_file" (
    "id" UUID NOT NULL,
    "bucket" "FileBucket" NOT NULL,
    "purpose" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" "FileStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "stored_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_type" "ActorType" NOT NULL,
    "actor_user_id" UUID,
    "node_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "competition_id" UUID,
    "organization_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "platform_intervention" BOOLEAN NOT NULL DEFAULT false,
    "ip" INET,
    "user_agent" TEXT,
    "trace_id" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id","occurred_at")
) PARTITION BY RANGE ("occurred_at");

-- CreateTable
CREATE TABLE "data_access_log" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "action" "AccessAction" NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "competition_id" UUID,
    "ip" INET,
    "user_agent" TEXT,

    CONSTRAINT "data_access_log_pkey" PRIMARY KEY ("id","occurred_at")
) PARTITION BY RANGE ("occurred_at");

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "competition_id" UUID,
    "trace_id" TEXT,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_event" (
    "consumer" TEXT NOT NULL,
    "event_id" UUID NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_event_pkey" PRIMARY KEY ("consumer","event_id")
);

-- CreateTable
CREATE TABLE "system_setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "system_setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_person_id_key" ON "user"("person_id");

-- CreateIndex
CREATE INDEX "user_status_created_at_idx" ON "user"("status", "created_at");

-- CreateIndex
CREATE INDEX "auth_identity_user_id_idx" ON "auth_identity"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identity_provider_provider_subject_key" ON "auth_identity"("provider", "provider_subject");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_replaced_by_id_key" ON "refresh_token"("replaced_by_id");

-- CreateIndex
CREATE INDEX "refresh_token_family_id_idx" ON "refresh_token"("family_id");

-- CreateIndex
CREATE INDEX "refresh_token_user_id_revoked_at_idx" ON "refresh_token"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "refresh_token_expires_at_idx" ON "refresh_token"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "verification_token_token_hash_key" ON "verification_token"("token_hash");

-- CreateIndex
CREATE INDEX "verification_token_expires_at_idx" ON "verification_token"("expires_at");

-- CreateIndex
CREATE INDEX "verification_token_user_id_purpose_idx" ON "verification_token"("user_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "role_code_key" ON "role"("code");

-- CreateIndex
CREATE INDEX "platform_role_assignment_user_id_idx" ON "platform_role_assignment"("user_id");

-- CreateIndex
CREATE INDEX "organization_membership_user_id_status_idx" ON "organization_membership"("user_id", "status");

-- CreateIndex
CREATE INDEX "organization_membership_organization_id_status_idx" ON "organization_membership"("organization_id", "status");

-- CreateIndex
CREATE INDEX "competition_membership_user_id_status_idx" ON "competition_membership"("user_id", "status");

-- CreateIndex
CREATE INDEX "competition_membership_competition_id_role_id_idx" ON "competition_membership"("competition_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "region_country_code_code_key" ON "region"("country_code", "code");

-- CreateIndex
CREATE UNIQUE INDEX "region_code_key" ON "region"("code");

-- CreateIndex
CREATE UNIQUE INDEX "organization_slug_key" ON "organization"("slug");

-- CreateIndex
CREATE INDEX "organization_parent_id_idx" ON "organization"("parent_id");

-- CreateIndex
CREATE INDEX "organization_region_id_type_status_idx" ON "organization"("region_id", "type", "status");

-- CreateIndex
CREATE INDEX "organization_closure_descendant_id_idx" ON "organization_closure"("descendant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sport_rank_rank_order_key" ON "sport_rank"("rank_order");

-- CreateIndex
CREATE UNIQUE INDEX "referee_category_rank_order_key" ON "referee_category"("rank_order");

-- CreateIndex
CREATE UNIQUE INDEX "stored_file_storage_key_key" ON "stored_file"("storage_key");

-- CreateIndex
CREATE INDEX "stored_file_status_created_at_idx" ON "stored_file"("status", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_occurred_at_idx" ON "audit_log"("entity_type", "entity_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_competition_id_occurred_at_idx" ON "audit_log"("competition_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_occurred_at_idx" ON "audit_log"("actor_user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_occurred_at_idx" ON "audit_log"("occurred_at");

-- CreateIndex
CREATE INDEX "data_access_log_resource_type_resource_id_occurred_at_idx" ON "data_access_log"("resource_type", "resource_id", "occurred_at");

-- CreateIndex
CREATE INDEX "data_access_log_user_id_occurred_at_idx" ON "data_access_log"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "processed_event_processed_at_idx" ON "processed_event"("processed_at");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_identity" ADD CONSTRAINT "auth_identity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "refresh_token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_token" ADD CONSTRAINT "verification_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permission"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_role_assignment" ADD CONSTRAINT "platform_role_assignment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_role_assignment" ADD CONSTRAINT "platform_role_assignment_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_role_assignment" ADD CONSTRAINT "platform_role_assignment_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_membership" ADD CONSTRAINT "organization_membership_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_membership" ADD CONSTRAINT "organization_membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_membership" ADD CONSTRAINT "organization_membership_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_membership" ADD CONSTRAINT "organization_membership_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_membership" ADD CONSTRAINT "competition_membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_membership" ADD CONSTRAINT "competition_membership_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_membership" ADD CONSTRAINT "competition_membership_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person" ADD CONSTRAINT "person_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "country"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person" ADD CONSTRAINT "person_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person" ADD CONSTRAINT "person_photo_file_id_fkey" FOREIGN KEY ("photo_file_id") REFERENCES "stored_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person" ADD CONSTRAINT "person_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person" ADD CONSTRAINT "person_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "region" ADD CONSTRAINT "region_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "country"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization" ADD CONSTRAINT "organization_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization" ADD CONSTRAINT "organization_logo_file_id_fkey" FOREIGN KEY ("logo_file_id") REFERENCES "stored_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization" ADD CONSTRAINT "organization_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "country"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization" ADD CONSTRAINT "organization_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization" ADD CONSTRAINT "organization_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_legal_details" ADD CONSTRAINT "organization_legal_details_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_closure" ADD CONSTRAINT "organization_closure_ancestor_id_fkey" FOREIGN KEY ("ancestor_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_closure" ADD CONSTRAINT "organization_closure_descendant_id_fkey" FOREIGN KEY ("descendant_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_access_log" ADD CONSTRAINT "data_access_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_setting" ADD CONSTRAINT "system_setting_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- =====================================================================
-- Часть 2. SQL-шаги (DATABASE.md, 10)
-- =====================================================================

-- ---------- Partial unique индексы ----------

-- Нет дублей активных платформенных ролей.
CREATE UNIQUE INDEX "platform_role_assignment_active_uq"
  ON "platform_role_assignment" ("user_id", "role_id") WHERE "revoked_at" IS NULL;

-- Одно действующее членство пользователя с ролью в организации.
CREATE UNIQUE INDEX "organization_membership_active_uq"
  ON "organization_membership" ("organization_id", "user_id", "role_id")
  WHERE "status" IN ('INVITED', 'ACTIVE') AND "user_id" IS NOT NULL;

-- Одно ожидающее приглашение на email с ролью в организации.
CREATE UNIQUE INDEX "organization_membership_invite_uq"
  ON "organization_membership" ("organization_id", "invited_email", "role_id")
  WHERE "status" = 'INVITED' AND "user_id" IS NULL;

CREATE UNIQUE INDEX "competition_membership_active_uq"
  ON "competition_membership" ("competition_id", "user_id", "role_id")
  WHERE "status" IN ('INVITED', 'ACTIVE');

-- Очередь диспетчера outbox (DATABASE.md, 6).
CREATE INDEX "outbox_event_pending_idx"
  ON "outbox_event" ("available_at", "occurred_at") WHERE "status" = 'PENDING';
CREATE INDEX "outbox_event_dispatched_idx"
  ON "outbox_event" ("dispatched_at") WHERE "status" = 'DISPATCHED';

-- ---------- Поиск (pg_trgm) ----------

CREATE INDEX "organization_name_norm_trgm_idx" ON "organization" USING GIN ("name_norm" gin_trgm_ops);
CREATE INDEX "person_last_name_norm_trgm_idx" ON "person" USING GIN ("last_name_norm" gin_trgm_ops);
CREATE INDEX "person_dedup_idx" ON "person" ("last_name_norm", "first_name_norm", "birth_date");

-- ---------- CHECK-ограничения ----------

ALTER TABLE "organization_membership"
  ADD CONSTRAINT "organization_membership_valid_period_ck" CHECK ("valid_to" IS NULL OR "valid_from" IS NULL OR "valid_to" >= "valid_from"),
  ADD CONSTRAINT "organization_membership_subject_ck" CHECK ("user_id" IS NOT NULL OR "invited_email" IS NOT NULL),
  ADD CONSTRAINT "organization_membership_accepted_ck" CHECK ("status" = 'INVITED' OR "user_id" IS NOT NULL);

ALTER TABLE "organization"
  ADD CONSTRAINT "organization_not_own_parent_ck" CHECK ("parent_id" IS NULL OR "parent_id" <> "id"),
  ADD CONSTRAINT "organization_slug_ck" CHECK ("slug" ~ '^[a-z0-9-]{3,80}$');

ALTER TABLE "organization_closure"
  ADD CONSTRAINT "organization_closure_depth_ck" CHECK ("depth" >= 0 AND ("depth" = 0) = ("ancestor_id" = "descendant_id"));

ALTER TABLE "organization_legal_details"
  ADD CONSTRAINT "organization_legal_details_inn_ck" CHECK ("inn" ~ '^(\d{10}|\d{12})$');

ALTER TABLE "person"
  ADD CONSTRAINT "person_birth_date_ck" CHECK ("birth_date" > DATE '1900-01-01');

ALTER TABLE "auth_identity"
  ADD CONSTRAINT "auth_identity_password_ck" CHECK ("provider" <> 'EMAIL_PASSWORD' OR "secret_hash" IS NOT NULL);

ALTER TABLE "stored_file"
  ADD CONSTRAINT "stored_file_size_ck" CHECK ("size_bytes" > 0),
  ADD CONSTRAINT "stored_file_sha256_ck" CHECK ("sha256" ~ '^[a-f0-9]{64}$');

ALTER TABLE "user"
  ADD CONSTRAINT "user_locale_ck" CHECK ("locale" IN ('ru', 'en')),
  ADD CONSTRAINT "user_permissions_version_ck" CHECK ("permissions_version" >= 1);

ALTER TABLE "document_type"
  ADD CONSTRAINT "document_type_limits_ck" CHECK ("max_size_bytes" > 0 AND "retention_days" > 0);

-- ---------- Партиции по месяцам: audit_log, data_access_log (DATABASE.md, 8) ----------

-- Партиция DEFAULT страхует от записи за пределами созданных месяцев.
CREATE TABLE "audit_log_default" PARTITION OF "audit_log" DEFAULT;
CREATE TABLE "data_access_log_default" PARTITION OF "data_access_log" DEFAULT;

-- Создаёт месячные партиции на N месяцев вперёд от p_from. Идемпотентна.
-- SECURITY DEFINER: вызывается worker-ом под ролью приложения, которая не имеет DDL.
CREATE OR REPLACE FUNCTION "ensure_monthly_partitions"(p_table text, p_from date, p_months int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start date := date_trunc('month', p_from)::date;
  v_created int := 0;
  v_name text;
  i int;
BEGIN
  IF p_table NOT IN ('audit_log', 'data_access_log') THEN
    RAISE EXCEPTION 'ensure_monthly_partitions: table % is not allowed', p_table;
  END IF;
  IF p_months < 1 OR p_months > 36 THEN
    RAISE EXCEPTION 'ensure_monthly_partitions: months must be within 1..36';
  END IF;
  FOR i IN 0 .. p_months - 1 LOOP
    v_name := format('%s_%s', p_table, to_char(v_start + make_interval(months => i), 'YYYYMM'));
    IF to_regclass(v_name) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        v_name, p_table,
        (v_start + make_interval(months => i)) AT TIME ZONE 'UTC',
        (v_start + make_interval(months => i + 1)) AT TIME ZONE 'UTC'
      );
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sde_app') THEN
        EXECUTE format('REVOKE ALL ON TABLE %I FROM sde_app', v_name);
      END IF;
      v_created := v_created + 1;
    END IF;
  END LOOP;
  RETURN v_created;
END;
$$;

SELECT "ensure_monthly_partitions"('audit_log', DATE '2026-09-01', 16);
SELECT "ensure_monthly_partitions"('data_access_log', DATE '2026-09-01', 16);

-- ---------- Роль приложения (DATABASE.md, 10) ----------
-- Роль создаётся без LOGIN: пароль и LOGIN выдаёт эксплуатация (infra/postgres/init, DEPLOYMENT.md).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sde_app') THEN
    CREATE ROLE sde_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO sde_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sde_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sde_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO sde_app;
REVOKE ALL ON TABLE "_prisma_migrations" FROM sde_app;

-- Append-only журналы: у роли приложения нет UPDATE/DELETE (раздел 35, 37 ТЗ).
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_log", "data_access_log" FROM sde_app;

-- Прямой доступ к партициям закрыт: только через родительскую таблицу.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname IN ('audit_log', 'data_access_log')
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM sde_app', r.relname);
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION "ensure_monthly_partitions"(text, date, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "ensure_monthly_partitions"(text, date, int) TO sde_app;
