-- Рейтинг, фаза 10 (ТЗ 26–29; docs/RATED_TOURNAMENT_FORMAT.md, 2, 6): посев рейтингового формата по рейтингу на момент
-- жеребьёвки, подгруппы A–H в слотах жеребьёвки, у каждой подгруппы — свой этап сетки.

-- CreateTable
CREATE TABLE "tournament_seed" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "draw_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "athlete_id" UUID NOT NULL,
    "seed_number" INTEGER NOT NULL,
    "rating_at_draw" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_seed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tournament_seed_athlete_id_idx" ON "tournament_seed"("athlete_id");
CREATE UNIQUE INDEX "tournament_seed_draw_id_entry_id_key" ON "tournament_seed"("draw_id", "entry_id");
CREATE UNIQUE INDEX "tournament_seed_draw_id_seed_number_key" ON "tournament_seed"("draw_id", "seed_number");

-- AddForeignKey
ALTER TABLE "tournament_seed" ADD CONSTRAINT "tournament_seed_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tournament_seed" ADD CONSTRAINT "tournament_seed_draw_id_fkey" FOREIGN KEY ("draw_id") REFERENCES "draw"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tournament_seed" ADD CONSTRAINT "tournament_seed_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tournament_seed" ADD CONSTRAINT "tournament_seed_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "athlete_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tournament_seed"
  ADD CONSTRAINT "tournament_seed_seed_ck" CHECK ("seed_number" >= 1),
  ADD CONSTRAINT "tournament_seed_rating_ck" CHECK ("rating_at_draw" >= 0);

-- Посев пишется вместе со слотами черновика и не меняется (ТЗ 28): ни обычным UPDATE, ни удалением, ни добавлением
-- к опубликованной версии. Другой посев — новая версия жеребьёвки.
CREATE OR REPLACE FUNCTION "forbid_change_tournament_seed"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status "DrawStatus";
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'tournament seed % is immutable', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  SELECT "status" INTO v_status FROM "draw" WHERE "id" = NEW."draw_id";
  IF v_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'seeds of draw % are immutable', NEW."draw_id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tournament_seed_immutable"
  BEFORE INSERT OR UPDATE OR DELETE ON "tournament_seed"
  FOR EACH ROW EXECUTE FUNCTION "forbid_change_tournament_seed"();

-- Подгруппы рейтингового формата: A–H.
ALTER TABLE "draw_slot" DROP CONSTRAINT "draw_slot_pool_ck";
ALTER TABLE "draw_slot"
  ADD CONSTRAINT "draw_slot_pool_ck" CHECK ("pool" IS NULL OR "pool" IN ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sde_app') THEN
    GRANT SELECT, INSERT ON TABLE "tournament_seed" TO sde_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "tournament_seed" FROM sde_app;
  END IF;
END
$$;
