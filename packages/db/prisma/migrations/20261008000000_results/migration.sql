-- Phase 7b — итоги (план Phase 7b, §1–§4, §6): итоги категории (места и медали), история спортсмена, прежние
-- варианты изменённых результатов (только дополняются), врач на ковре.
-- Часть 1 сгенерирована `prisma migrate diff` (из применённых миграций в schema.prisma) и проверена вручную: убраны
-- изменения, которые diff показывает для конструкций, объявленных только SQL-шагами прошлых миграций (генерируемые
-- колонки *_norm, trgm-индексы, частичные и отложенные ограничения). Часть 2 — SQL-шаги, которые Prisma не выражает
-- (DATABASE.md, 10).

-- CreateEnum
CREATE TYPE "CategoryResultStatus" AS ENUM ('PROVISIONAL', 'PUBLISHED', 'AMENDED');

-- CreateEnum
CREATE TYPE "Medal" AS ENUM ('GOLD', 'SILVER', 'BRONZE');

-- CreateEnum
CREATE TYPE "MedicalIncidentKind" AS ENUM ('ASSISTANCE', 'STOPPAGE');

-- CreateEnum
CREATE TYPE "MedicalIncidentDecision" AS ENUM ('CONTINUE', 'WITHDRAWN_BY_DOCTOR');

-- CreateTable
CREATE TABLE "match_result_revision" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "match_result_id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "MatchResultStatus" NOT NULL,
    "winner_side" "Side",
    "method" "WinMethod" NOT NULL,
    "method_detail" TEXT,
    "red_score" INTEGER,
    "blue_score" INTEGER,
    "confirmed_by_id" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "reason" TEXT NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_result_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_result" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "draw_id" UUID NOT NULL,
    "status" "CategoryResultStatus" NOT NULL DEFAULT 'PROVISIONAL',
    "computed_at" TIMESTAMPTZ(3) NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "published_by_id" UUID,
    "amended_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "category_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "category_result_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "place" INTEGER NOT NULL,
    "medal" "Medal",
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "placement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "athlete_result" (
    "id" UUID NOT NULL,
    "athlete_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "category_result_id" UUID NOT NULL,
    "competition_name" TEXT NOT NULL,
    "competition_start_date" DATE NOT NULL,
    "competition_end_date" DATE NOT NULL,
    "competition_level" "CompetitionLevel" NOT NULL,
    "category_name_ru" TEXT NOT NULL,
    "category_name_en" TEXT NOT NULL,
    "club_name" TEXT,
    "place" INTEGER NOT NULL,
    "medal" "Medal",
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "status" "CategoryResultStatus" NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "athlete_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_incident" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "side" "Side" NOT NULL,
    "kind" "MedicalIncidentKind" NOT NULL,
    "decision" "MedicalIncidentDecision" NOT NULL,
    "match_clock_ms" INTEGER,
    "note" TEXT,
    "recorded_by_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medical_incident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "match_result_revision_match_id_idx" ON "match_result_revision"("match_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_result_revision_match_result_id_revision_key" ON "match_result_revision"("match_result_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "category_result_category_id_key" ON "category_result"("category_id");

-- CreateIndex
CREATE INDEX "category_result_competition_id_status_idx" ON "category_result"("competition_id", "status");

-- CreateIndex
CREATE INDEX "placement_entry_id_idx" ON "placement"("entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "placement_category_result_id_entry_id_key" ON "placement"("category_result_id", "entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "athlete_result_entry_id_key" ON "athlete_result"("entry_id");

-- CreateIndex
CREATE INDEX "athlete_result_athlete_id_competition_start_date_idx" ON "athlete_result"("athlete_id", "competition_start_date" DESC);

-- CreateIndex
CREATE INDEX "athlete_result_competition_id_idx" ON "athlete_result"("competition_id");

-- CreateIndex
CREATE INDEX "medical_incident_match_id_idx" ON "medical_incident"("match_id");

-- CreateIndex
CREATE INDEX "medical_incident_entry_id_idx" ON "medical_incident"("entry_id");

-- AddForeignKey
ALTER TABLE "match_result_revision" ADD CONSTRAINT "match_result_revision_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_result_revision" ADD CONSTRAINT "match_result_revision_match_result_id_fkey" FOREIGN KEY ("match_result_id") REFERENCES "match_result"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_result_revision" ADD CONSTRAINT "match_result_revision_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_result_revision" ADD CONSTRAINT "match_result_revision_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_result" ADD CONSTRAINT "category_result_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_result" ADD CONSTRAINT "category_result_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "competition_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_result" ADD CONSTRAINT "category_result_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement" ADD CONSTRAINT "placement_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement" ADD CONSTRAINT "placement_category_result_id_fkey" FOREIGN KEY ("category_result_id") REFERENCES "category_result"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement" ADD CONSTRAINT "placement_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_result" ADD CONSTRAINT "athlete_result_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athlete_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_result" ADD CONSTRAINT "athlete_result_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_result" ADD CONSTRAINT "athlete_result_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_result" ADD CONSTRAINT "athlete_result_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "competition_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "athlete_result" ADD CONSTRAINT "athlete_result_category_result_id_fkey" FOREIGN KEY ("category_result_id") REFERENCES "category_result"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_incident" ADD CONSTRAINT "medical_incident_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_incident" ADD CONSTRAINT "medical_incident_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_incident" ADD CONSTRAINT "medical_incident_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_incident" ADD CONSTRAINT "medical_incident_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- CHECK-ограничения ----------

ALTER TABLE "placement"
  ADD CONSTRAINT "placement_numbers_ck" CHECK ("place" >= 1 AND "wins" >= 0 AND "losses" >= 0),
  -- Медаль — за 1–3 места: 1 — золото, 2 — серебро, 3 — бронза (деление мест: две бронзы).
  ADD CONSTRAINT "placement_medal_ck"
    CHECK (("place" = 1 AND "medal" = 'GOLD') OR ("place" = 2 AND "medal" = 'SILVER')
           OR ("place" = 3 AND "medal" = 'BRONZE') OR ("place" > 3 AND "medal" IS NULL));

ALTER TABLE "athlete_result"
  ADD CONSTRAINT "athlete_result_numbers_ck" CHECK ("place" >= 1 AND "wins" >= 0 AND "losses" >= 0),
  ADD CONSTRAINT "athlete_result_medal_ck"
    CHECK (("place" = 1 AND "medal" = 'GOLD') OR ("place" = 2 AND "medal" = 'SILVER')
           OR ("place" = 3 AND "medal" = 'BRONZE') OR ("place" > 3 AND "medal" IS NULL)),
  -- В историю попадают только опубликованные итоги.
  ADD CONSTRAINT "athlete_result_status_ck" CHECK ("status" IN ('PUBLISHED', 'AMENDED'));

ALTER TABLE "category_result"
  ADD CONSTRAINT "category_result_published_ck"
    CHECK ("status" = 'PROVISIONAL' OR ("published_at" IS NOT NULL AND "published_by_id" IS NOT NULL)),
  ADD CONSTRAINT "category_result_amended_ck" CHECK ("status" <> 'AMENDED' OR "amended_at" IS NOT NULL);

ALTER TABLE "match_result_revision"
  ADD CONSTRAINT "match_result_revision_ck" CHECK ("revision" >= 1 AND length(btrim("reason")) >= 5),
  ADD CONSTRAINT "match_result_revision_status_ck" CHECK ("status" <> 'PROVISIONAL');

ALTER TABLE "medical_incident"
  ADD CONSTRAINT "medical_incident_clock_ck" CHECK ("match_clock_ms" IS NULL OR "match_clock_ms" >= 0),
  -- Снять спортсмена можно только остановив схватку; помощь — схватка продолжается.
  ADD CONSTRAINT "medical_incident_decision_ck" CHECK ("kind" = 'STOPPAGE' OR "decision" = 'CONTINUE');

-- ---------- Журнал синхронизации (DATABASE.md, 7) ----------

CREATE TRIGGER "category_result_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "category_result"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "placement_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "placement"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "athlete_result_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "athlete_result"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "match_result_revision_sync_log"
  AFTER INSERT ON "match_result_revision"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "medical_incident_sync_log"
  AFTER INSERT ON "medical_incident"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');

-- ---------- Права роли приложения ----------
-- Прежние варианты результата и записи врача только дополняются (раздел 53): у роли приложения нет UPDATE,
-- DELETE и TRUNCATE. Итоги и история пересчитываются — полный набор прав.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sde_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "category_result", "placement", "athlete_result" TO sde_app;
    GRANT SELECT, INSERT ON TABLE "match_result_revision", "medical_incident" TO sde_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "match_result_revision", "medical_incident" FROM sde_app;
  END IF;
END
$$;
