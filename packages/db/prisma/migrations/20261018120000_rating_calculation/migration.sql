-- Рейтинг спортсменов, фазы 3–5 (docs/RATING_ARCHITECTURE.md, 5, 6; 12 — M2, M3): текущий рейтинг, расчёты по
-- схваткам и история. Корректировки (rating_correction) — фаза 14.
-- CreateEnum
CREATE TYPE "RatingStatus" AS ENUM ('ACTIVE', 'FROZEN', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RatingCalculationStatus" AS ENUM ('PENDING', 'COMPLETED', 'SKIPPED', 'FAILED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "athlete_rating" (
    "athlete_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "peak_rating" INTEGER NOT NULL,
    "lowest_rating" INTEGER NOT NULL,
    "rated_matches" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "status" "RatingStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_rated_match_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "athlete_rating_pkey" PRIMARY KEY ("athlete_id")
);

-- CreateTable
CREATE TABLE "rating_calculation" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "rule_set_id" UUID NOT NULL,
    "calculation_version" TEXT NOT NULL,
    "match_result_revision" INTEGER NOT NULL,
    "status" "RatingCalculationStatus" NOT NULL,
    "status_reason" TEXT,
    "input" JSONB NOT NULL,
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rating_calculation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rating_history" (
    "id" UUID NOT NULL,
    "calculation_id" UUID NOT NULL,
    "athlete_id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "rating_before" INTEGER NOT NULL,
    "rating_after" INTEGER NOT NULL,
    "rating_delta" INTEGER NOT NULL,
    "rating_after_exact" DECIMAL(14,6) NOT NULL,
    "level_before" INTEGER NOT NULL,
    "level_after" INTEGER NOT NULL,
    "opponent_athlete_id" UUID NOT NULL,
    "opponent_rating_before" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "actual_score" DECIMAL(5,4) NOT NULL,
    "expected_score" DECIMAL(12,10) NOT NULL,
    "coefficient_k" INTEGER NOT NULL,
    "calculation_version" TEXT NOT NULL,
    "match_finished_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rating_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rating_calculation_competition_id_status_idx" ON "rating_calculation"("competition_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rating_calculation_match_id_calculation_version_match_resul_key" ON "rating_calculation"("match_id", "calculation_version", "match_result_revision");

-- CreateIndex
CREATE INDEX "rating_history_athlete_id_match_finished_at_id_idx" ON "rating_history"("athlete_id", "match_finished_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "rating_history_calculation_id_athlete_id_key" ON "rating_history"("calculation_id", "athlete_id");

-- AddForeignKey
ALTER TABLE "athlete_rating" ADD CONSTRAINT "athlete_rating_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athlete_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_calculation" ADD CONSTRAINT "rating_calculation_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_calculation" ADD CONSTRAINT "rating_calculation_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_calculation" ADD CONSTRAINT "rating_calculation_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "rating_rule_set"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_calculation_id_fkey" FOREIGN KEY ("calculation_id") REFERENCES "rating_calculation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athlete_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_opponent_athlete_id_fkey" FOREIGN KEY ("opponent_athlete_id") REFERENCES "athlete_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Инварианты, которые Prisma не выражает.
ALTER TABLE "athlete_rating"
  ADD CONSTRAINT "athlete_rating_counts_check" CHECK ("rated_matches" >= 0 AND "wins" >= 0 AND "losses" >= 0 AND "wins" + "losses" <= "rated_matches"),
  ADD CONSTRAINT "athlete_rating_bounds_check" CHECK ("lowest_rating" <= "rating" AND "rating" <= "peak_rating");
ALTER TABLE "rating_history"
  ADD CONSTRAINT "rating_history_delta_check" CHECK ("rating_delta" = "rating_after" - "rating_before"),
  ADD CONSTRAINT "rating_history_opponent_check" CHECK ("opponent_athlete_id" <> "athlete_id");

-- Лидерборд: действующие спортсмены по убыванию рейтинга.
CREATE INDEX "athlete_rating_leaderboard_idx" ON "athlete_rating"("status", "rating" DESC, "athlete_id");
-- У схватки один завершённый расчёт: изменённый результат переводит прежний в SUPERSEDED (фаза 6).
CREATE UNIQUE INDEX "rating_calculation_one_completed_key" ON "rating_calculation"("match_id") WHERE "status" = 'COMPLETED';
CREATE INDEX "rating_calculation_unfinished_idx" ON "rating_calculation"("status") WHERE "status" IN ('PENDING', 'FAILED');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sde_app') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE "athlete_rating", "rating_calculation" TO sde_app;
    REVOKE DELETE, TRUNCATE ON TABLE "athlete_rating", "rating_calculation" FROM sde_app;
    -- История только дополняется.
    GRANT SELECT, INSERT ON TABLE "rating_history" TO sde_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "rating_history" FROM sde_app;
  END IF;
END
$$;
