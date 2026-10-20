-- Сезоны рейтинга (docs/RATING_ARCHITECTURE.md, 5, 10; ТЗ 68; фаза 15): сезон — отдельное представление единого
-- рейтинга за период, Elo при смене сезона не сбрасывается. Границы — календарные даты (по Москве), включительно;
-- сезоны не пересекаются. Заводит администратор платформы.
-- CreateTable
CREATE TABLE "rating_season" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rating_season_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rating_season_code_key" ON "rating_season"("code");

-- AddForeignKey
ALTER TABLE "rating_season" ADD CONSTRAINT "rating_season_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rating_season" ADD CONSTRAINT "rating_season_dates_check" CHECK ("ends_on" >= "starts_on");
ALTER TABLE "rating_season" ADD CONSTRAINT "rating_season_no_overlap"
  EXCLUDE USING gist (daterange("starts_on", "ends_on", '[]') WITH &&);

-- Сезонная таблица читает историю за период по времени схватки.
CREATE INDEX "rating_history_match_finished_at_idx" ON "rating_history"("match_finished_at");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sde_app') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE "rating_season" TO sde_app;
    REVOKE DELETE, TRUNCATE ON TABLE "rating_season" FROM sde_app;
  END IF;
END
$$;
