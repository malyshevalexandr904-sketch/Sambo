-- Корректирующие операции платформы с рейтингом (docs/RATING_ARCHITECTURE.md, 6.5, 8; ТЗ 18, 65–67; фаза 14):
-- ручная корректировка со ссылкой на схватку и применённая пересборка — новые строки rating_correction, история не
-- переписывается.
-- AlterEnum
ALTER TYPE "RatingCorrectionKind" ADD VALUE 'REBUILD';

-- AlterTable
ALTER TABLE "rating_correction" ADD COLUMN "related_match_id" UUID;

-- AddForeignKey
ALTER TABLE "rating_correction" ADD CONSTRAINT "rating_correction_related_match_id_fkey" FOREIGN KEY ("related_match_id") REFERENCES "match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Корректировка администратора (не изменённый результат) — всегда с причиной и автором (ТЗ 66).
ALTER TABLE "rating_correction"
  ADD CONSTRAINT "rating_correction_actor_check" CHECK (
    "kind" = 'RESULT_AMENDED' OR ("created_by_id" IS NOT NULL AND length(btrim(coalesce("reason", ''))) > 0));
