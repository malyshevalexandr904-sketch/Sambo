-- Рейтинг спортсменов, фаза 6 (docs/RATING_ARCHITECTURE.md, 3.1, 6.4; 12 — M4, часть M3): тип турнира и закреплённая
-- версия правил расчёта — по ним потребитель решает, считать ли схватку; корректировки при изменённом результате.
-- Защита типа турнира от изменения (триггер) и права администраторов — фаза 8.
-- CreateEnum
CREATE TYPE "CompetitionType" AS ENUM ('NON_RATED', 'RATED');

-- CreateEnum
CREATE TYPE "RatingCorrectionKind" AS ENUM ('RESULT_AMENDED', 'MANUAL');

-- AlterTable: существующие турниры — нерейтинговые, без пересчёта.
ALTER TABLE "competition" ADD COLUMN     "competition_type" "CompetitionType" NOT NULL DEFAULT 'NON_RATED';

-- CreateTable
CREATE TABLE "competition_rating_config" (
    "competition_id" UUID NOT NULL,
    "rule_set_id" UUID NOT NULL,
    "public_deltas" BOOLEAN NOT NULL DEFAULT true,
    "enabled_by_id" UUID,
    "enabled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "competition_rating_config_pkey" PRIMARY KEY ("competition_id")
);

-- CreateTable
CREATE TABLE "rating_correction" (
    "id" UUID NOT NULL,
    "athlete_id" UUID NOT NULL,
    "kind" "RatingCorrectionKind" NOT NULL,
    "calculation_id" UUID,
    "superseded_calculation_id" UUID,
    "rating_before" INTEGER NOT NULL,
    "rating_after" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rating_correction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "competition_rating_config_rule_set_id_idx" ON "competition_rating_config"("rule_set_id");

-- CreateIndex
CREATE INDEX "rating_correction_athlete_id_created_at_idx" ON "rating_correction"("athlete_id", "created_at");

-- AddForeignKey
ALTER TABLE "competition_rating_config" ADD CONSTRAINT "competition_rating_config_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_rating_config" ADD CONSTRAINT "competition_rating_config_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "rating_rule_set"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_rating_config" ADD CONSTRAINT "competition_rating_config_enabled_by_id_fkey" FOREIGN KEY ("enabled_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_correction" ADD CONSTRAINT "rating_correction_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athlete_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_correction" ADD CONSTRAINT "rating_correction_calculation_id_fkey" FOREIGN KEY ("calculation_id") REFERENCES "rating_calculation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_correction" ADD CONSTRAINT "rating_correction_superseded_calculation_id_fkey" FOREIGN KEY ("superseded_calculation_id") REFERENCES "rating_calculation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_correction" ADD CONSTRAINT "rating_correction_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Инварианты, которые Prisma не выражает.
ALTER TABLE "rating_correction"
  ADD CONSTRAINT "rating_correction_delta_check" CHECK ("delta" = "rating_after" - "rating_before"),
  ADD CONSTRAINT "rating_correction_source_check" CHECK ("kind" <> 'RESULT_AMENDED' OR ("calculation_id" IS NOT NULL AND "superseded_calculation_id" IS NOT NULL));

-- Ожидающие расчёты по спортсмену: после расчёта схватки отпускаются его следующие (порядок схваток, 6.2 п. 5).
CREATE INDEX "rating_calculation_pending_athletes_idx" ON "rating_calculation" USING GIN (("input" -> 'corners') jsonb_path_ops) WHERE "status" = 'PENDING';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sde_app') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE "competition_rating_config" TO sde_app;
    REVOKE DELETE, TRUNCATE ON TABLE "competition_rating_config" FROM sde_app;
    -- Корректировки только дополняются.
    GRANT SELECT, INSERT ON TABLE "rating_correction" TO sde_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "rating_correction" FROM sde_app;
  END IF;
END
$$;
