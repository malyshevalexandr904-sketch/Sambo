-- Правки 09.11.2026: сроки этапов дня соревнований, быстрое взвешивание без окна и веса, ручные перестановки жеребьёвки.
ALTER TABLE "competition" ADD COLUMN "day_schedule" JSONB;

ALTER TABLE "weigh_in_attempt" ALTER COLUMN "window_id" DROP NOT NULL;
ALTER TABLE "weigh_in_attempt" ALTER COLUMN "scale_id" DROP NOT NULL;
ALTER TABLE "weigh_in_attempt" ALTER COLUMN "weight_grams" DROP NOT NULL;

ALTER TABLE "draw" ADD COLUMN "manual_swaps" JSONB NOT NULL DEFAULT '[]';
