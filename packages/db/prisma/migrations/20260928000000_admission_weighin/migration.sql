-- Phase 4b — допуск (G-06), прибытие, взвешивание (D-06), медицинский допуск (G-05, часть 1) — DATABASE.md, 3.5;
-- уведомления: уведомление, доставка по каналам, настройки пользователя (3.8).
-- Часть 1 сгенерирована `prisma migrate diff` и проверена вручную; часть 2 — SQL-шаги, которые Prisma
-- не выражает (DATABASE.md, 10).
-- Уточнения к DATABASE.md: у операционных таблиц допуска и взвешивания есть competition_id (триггер журнала
-- синхронизации берёт турнир из строки); weigh_in_window_category — суррогатный id; weigh_in_attempt.category_id —
-- категория, для которой снят снимок границ; medical_clearance.revoked_* (кто и почему отозвал);
-- notification.source_event_id — идемпотентность обработки события; competition.weigh_in_failure_outcome — исход
-- неудачного взвешивания по положению (D-06).

-- CreateEnum
CREATE TYPE "WeighInFailureOutcome" AS ENUM ('WITHDRAW', 'RECHECK', 'TRANSFER');

-- CreateEnum
CREATE TYPE "AdmissionStatus" AS ENUM ('PENDING', 'ADMITTED', 'NOT_ADMITTED');

-- CreateEnum
CREATE TYPE "AdmissionCheckKind" AS ENUM ('DOCUMENTS', 'CONSENTS', 'MEDICAL', 'INSURANCE', 'AGE', 'QUALIFICATION', 'WEIGHT', 'CHECK_IN');

-- CreateEnum
CREATE TYPE "AdmissionCheckStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'WAIVED');

-- CreateEnum
CREATE TYPE "CheckInStatus" AS ENUM ('EXPECTED', 'ARRIVED', 'NOT_ARRIVED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "CheckInMethod" AS ENUM ('QR', 'SEARCH', 'MANUAL');

-- CreateEnum
CREATE TYPE "WeighInWindowKind" AS ENUM ('OFFICIAL', 'CONTROL');

-- CreateEnum
CREATE TYPE "WeighInAttemptKind" AS ENUM ('OFFICIAL', 'CONTROL', 'RECHECK');

-- CreateEnum
CREATE TYPE "WeighInResult" AS ENUM ('PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "WeighInStatus" AS ENUM ('EXPECTED', 'PASSED', 'FAILED', 'RECHECK_REQUIRED');

-- CreateEnum
CREATE TYPE "MedicalClearanceStatus" AS ENUM ('VALID', 'REVOKED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'TELEGRAM', 'MAX', 'PUSH');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "competition" ADD COLUMN     "weigh_in_failure_outcome" "WeighInFailureOutcome" NOT NULL DEFAULT 'RECHECK';

-- CreateTable
CREATE TABLE "admission" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "status" "AdmissionStatus" NOT NULL DEFAULT 'PENDING',
    "decided_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_check" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "kind" "AdmissionCheckKind" NOT NULL,
    "status" "AdmissionCheckStatus" NOT NULL,
    "reason_code" TEXT,
    "reason_params" JSONB,
    "waiver_reason" TEXT,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admission_check_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_in" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "athlete_id" UUID NOT NULL,
    "status" "CheckInStatus" NOT NULL DEFAULT 'EXPECTED',
    "method" "CheckInMethod",
    "arrived_at" TIMESTAMPTZ(3),
    "operator_id" UUID,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "check_in_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scale" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "serial_number" TEXT,
    "verified_until" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weigh_in_window" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "kind" "WeighInWindowKind" NOT NULL DEFAULT 'OFFICIAL',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "weigh_in_window_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weigh_in_window_category" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "window_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,

    CONSTRAINT "weigh_in_window_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weigh_in_attempt" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "window_id" UUID NOT NULL,
    "scale_id" UUID NOT NULL,
    "weight_grams" INTEGER NOT NULL,
    "measured_at" TIMESTAMPTZ(3) NOT NULL,
    "kind" "WeighInAttemptKind" NOT NULL,
    "result" "WeighInResult" NOT NULL,
    "limit_lower_grams" INTEGER,
    "limit_upper_grams" INTEGER,
    "tolerance_grams" INTEGER NOT NULL,
    "operator_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weigh_in_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weigh_in_record" (
    "entry_id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "status" "WeighInStatus" NOT NULL DEFAULT 'EXPECTED',
    "last_attempt_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "weigh_in_record_pkey" PRIMARY KEY ("entry_id")
);

-- CreateTable
CREATE TABLE "medical_clearance" (
    "id" UUID NOT NULL,
    "athlete_id" UUID NOT NULL,
    "competition_id" UUID,
    "valid_until" DATE NOT NULL,
    "issued_by" TEXT NOT NULL,
    "document_id" UUID,
    "status" "MedicalClearanceStatus" NOT NULL DEFAULT 'VALID',
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_id" UUID,
    "revoke_reason" TEXT,

    CONSTRAINT "medical_clearance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "competition_id" UUID,
    "source_event_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(3),

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_delivery" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" TEXT,
    "provider_message_id" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preference" (
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("user_id","type","channel")
);

-- CreateIndex
CREATE UNIQUE INDEX "admission_entry_id_key" ON "admission"("entry_id");

-- CreateIndex
CREATE INDEX "admission_competition_id_status_idx" ON "admission"("competition_id", "status");

-- CreateIndex
CREATE INDEX "admission_check_competition_id_kind_status_idx" ON "admission_check"("competition_id", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "admission_check_admission_id_kind_key" ON "admission_check"("admission_id", "kind");

-- CreateIndex
CREATE INDEX "check_in_competition_id_status_idx" ON "check_in"("competition_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "check_in_competition_id_athlete_id_key" ON "check_in"("competition_id", "athlete_id");

-- CreateIndex
CREATE INDEX "scale_competition_id_idx" ON "scale"("competition_id");

-- CreateIndex
CREATE INDEX "weigh_in_window_competition_id_starts_at_idx" ON "weigh_in_window"("competition_id", "starts_at");

-- CreateIndex
CREATE INDEX "weigh_in_window_category_category_id_idx" ON "weigh_in_window_category"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "weigh_in_window_category_window_id_category_id_key" ON "weigh_in_window_category"("window_id", "category_id");

-- CreateIndex
CREATE INDEX "weigh_in_attempt_entry_id_measured_at_idx" ON "weigh_in_attempt"("entry_id", "measured_at");

-- CreateIndex
CREATE INDEX "weigh_in_attempt_competition_id_measured_at_idx" ON "weigh_in_attempt"("competition_id", "measured_at");

-- CreateIndex
CREATE INDEX "weigh_in_record_competition_id_status_idx" ON "weigh_in_record"("competition_id", "status");

-- CreateIndex
CREATE INDEX "medical_clearance_competition_id_idx" ON "medical_clearance"("competition_id");

-- CreateIndex
CREATE INDEX "notification_user_id_created_at_idx" ON "notification"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "notification_source_event_id_user_id_key" ON "notification"("source_event_id", "user_id");

-- CreateIndex
CREATE INDEX "notification_delivery_status_channel_idx" ON "notification_delivery"("status", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "notification_delivery_notification_id_channel_key" ON "notification_delivery"("notification_id", "channel");

-- AddForeignKey
ALTER TABLE "admission" ADD CONSTRAINT "admission_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission" ADD CONSTRAINT "admission_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_check" ADD CONSTRAINT "admission_check_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "admission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_check" ADD CONSTRAINT "admission_check_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_in" ADD CONSTRAINT "check_in_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_in" ADD CONSTRAINT "check_in_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athlete_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_in" ADD CONSTRAINT "check_in_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scale" ADD CONSTRAINT "scale_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weigh_in_window" ADD CONSTRAINT "weigh_in_window_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weigh_in_window_category" ADD CONSTRAINT "weigh_in_window_category_window_id_fkey" FOREIGN KEY ("window_id") REFERENCES "weigh_in_window"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weigh_in_window_category" ADD CONSTRAINT "weigh_in_window_category_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "competition_category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weigh_in_attempt" ADD CONSTRAINT "weigh_in_attempt_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weigh_in_attempt" ADD CONSTRAINT "weigh_in_attempt_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "competition_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weigh_in_attempt" ADD CONSTRAINT "weigh_in_attempt_window_id_fkey" FOREIGN KEY ("window_id") REFERENCES "weigh_in_window"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weigh_in_attempt" ADD CONSTRAINT "weigh_in_attempt_scale_id_fkey" FOREIGN KEY ("scale_id") REFERENCES "scale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weigh_in_attempt" ADD CONSTRAINT "weigh_in_attempt_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weigh_in_record" ADD CONSTRAINT "weigh_in_record_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weigh_in_record" ADD CONSTRAINT "weigh_in_record_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weigh_in_record" ADD CONSTRAINT "weigh_in_record_last_attempt_id_fkey" FOREIGN KEY ("last_attempt_id") REFERENCES "weigh_in_attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_clearance" ADD CONSTRAINT "medical_clearance_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athlete_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_clearance" ADD CONSTRAINT "medical_clearance_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_clearance" ADD CONSTRAINT "medical_clearance_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_clearance" ADD CONSTRAINT "medical_clearance_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_clearance" ADD CONSTRAINT "medical_clearance_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------- Частичные индексы ----------

-- Действующий медицинский допуск спортсмена — условие проверки MEDICAL.
CREATE INDEX "medical_clearance_valid_idx" ON "medical_clearance" ("athlete_id", "valid_until") WHERE "status" = 'VALID';
-- Счётчик непрочитанных уведомлений.
CREATE INDEX "notification_unread_idx" ON "notification" ("user_id") WHERE "read_at" IS NULL;

-- ---------- CHECK-ограничения ----------

ALTER TABLE "admission_check"
  ADD CONSTRAINT "admission_check_waiver_ck" CHECK ("status" <> 'WAIVED' OR "waiver_reason" IS NOT NULL);

ALTER TABLE "check_in"
  ADD CONSTRAINT "check_in_arrived_ck" CHECK ("status" <> 'ARRIVED' OR "arrived_at" IS NOT NULL);

ALTER TABLE "weigh_in_window"
  ADD CONSTRAINT "weigh_in_window_period_ck" CHECK ("ends_at" > "starts_at");

ALTER TABLE "weigh_in_attempt"
  ADD CONSTRAINT "weigh_in_attempt_weight_ck" CHECK ("weight_grams" BETWEEN 10000 AND 250000),
  ADD CONSTRAINT "weigh_in_attempt_tolerance_ck" CHECK ("tolerance_grams" >= 0),
  ADD CONSTRAINT "weigh_in_attempt_limits_ck"
    CHECK ("limit_lower_grams" IS NULL OR "limit_upper_grams" IS NULL OR "limit_lower_grams" < "limit_upper_grams");

ALTER TABLE "medical_clearance"
  ADD CONSTRAINT "medical_clearance_revoked_ck"
    CHECK (("status" = 'REVOKED') = ("revoked_at" IS NOT NULL) AND ("status" <> 'REVOKED' OR "revoke_reason" IS NOT NULL));

-- ---------- Журнал синхронизации (DATABASE.md, 7) ----------

-- Второй аргумент триггера — колонка идентификатора строки (по умолчанию `id`): у weigh_in_record ключ — entry_id.
-- Строки без турнира в журнал не пишутся.
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
  IF v_competition IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT "epoch" INTO v_epoch FROM "competition_write_lease" WHERE "competition_id" = v_competition;
  INSERT INTO "sync_log" ("competition_id", "epoch", "table_name", "row_id", "op", "row_image")
  VALUES (
    v_competition,
    COALESCE(v_epoch, 1),
    TG_TABLE_NAME,
    (v_row ->> COALESCE(TG_ARGV[1], 'id'))::uuid,
    TG_OP::"SyncOp",
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE v_row END
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER "admission_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "admission"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "admission_check_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "admission_check"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "check_in_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "check_in"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "scale_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "scale"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "weigh_in_window_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "weigh_in_window"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "weigh_in_window_category_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "weigh_in_window_category"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "weigh_in_attempt_sync_log"
  AFTER INSERT ON "weigh_in_attempt"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "weigh_in_record_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "weigh_in_record"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id', 'entry_id');

-- ---------- Права роли приложения ----------
-- Попытки взвешивания append-only (раздел 16 ТЗ): история не перезаписывается и не удаляется.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sde_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      "admission", "admission_check", "check_in", "scale", "weigh_in_window", "weigh_in_window_category",
      "weigh_in_record", "medical_clearance", "notification", "notification_delivery", "notification_preference"
    TO sde_app;
    GRANT SELECT, INSERT ON TABLE "weigh_in_attempt" TO sde_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "weigh_in_attempt" FROM sde_app;
  END IF;
END
$$;

-- ---------- Турниры, уже начавшие мандатную комиссию ----------
-- Строки прибытия и этап взвешивания в закрытых категориях создаёт переход REGISTRATION_CLOSED → CHECK_IN. Для
-- турниров, прошедших его до этой миграции, они создаются здесь (после триггеров — изменения попадают в журнал
-- синхронизации). Допуск таких турниров пересчитывает POST /competitions/{id}/admission/recompute (DEPLOYMENT.md).

INSERT INTO "check_in" ("id", "competition_id", "athlete_id", "status", "version", "created_at", "updated_at")
SELECT gen_random_uuid(), x."competition_id", x."athlete_id", 'EXPECTED', 1, now(), now()
FROM (
  SELECT DISTINCT e."competition_id", e."athlete_id"
  FROM "entry" e JOIN "competition" c ON c."id" = e."competition_id"
  WHERE e."status" = 'APPROVED' AND c."status" IN ('CHECK_IN', 'DRAWING', 'SCHEDULED', 'IN_PROGRESS')
) x
ON CONFLICT ("competition_id", "athlete_id") DO NOTHING;

UPDATE "competition_category" cc
SET "status" = 'WEIGH_IN', "version" = cc."version" + 1, "updated_at" = now()
FROM "competition" c
WHERE c."id" = cc."competition_id" AND c."status" = 'CHECK_IN' AND cc."status" = 'CLOSED';
