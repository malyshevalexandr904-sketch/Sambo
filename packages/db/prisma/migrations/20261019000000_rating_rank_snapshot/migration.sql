-- Рейтинг спортсменов, фаза 7 (docs/RATING_ARCHITECTURE.md, 10; 12 — M7): ежедневный снимок мест таблицы рейтинга
-- для «изменения позиции». Пишет и чистит (старше года) worker.
-- CreateTable
CREATE TABLE "rating_rank_snapshot" (
    "snapshot_date" DATE NOT NULL,
    "athlete_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rating_rank_snapshot_pkey" PRIMARY KEY ("snapshot_date","athlete_id")
);

-- CreateIndex
CREATE INDEX "rating_rank_snapshot_athlete_id_snapshot_date_idx" ON "rating_rank_snapshot"("athlete_id", "snapshot_date");

-- AddForeignKey
ALTER TABLE "rating_rank_snapshot" ADD CONSTRAINT "rating_rank_snapshot_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athlete_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rating_rank_snapshot" ADD CONSTRAINT "rating_rank_snapshot_rank_check" CHECK ("rank" >= 1);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sde_app') THEN
    GRANT SELECT, INSERT, DELETE ON TABLE "rating_rank_snapshot" TO sde_app;
    REVOKE UPDATE, TRUNCATE ON TABLE "rating_rank_snapshot" FROM sde_app;
  END IF;
END
$$;
