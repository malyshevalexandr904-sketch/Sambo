-- Phase 5a — жеребьёвка и сетки (DATABASE.md, 3.6; ARCHITECTURE.md, 14.4–14.5, 16.5; ADR-11): версия жеребьёвки,
-- её позиции, этапы и узлы сетки, схватки сетки и их стороны.
-- Часть 1 сгенерирована `prisma migrate diff` и проверена вручную; часть 2 — SQL-шаги, которые Prisma
-- не выражает (DATABASE.md, 10).
-- Уточнения к DATABASE.md: Draw.number — номер версии в категории, Draw.version — оптимистическая блокировка
-- (If-Match); у всех таблиц есть competition_id (журнал синхронизации); связь узла и схватки хранится один раз —
-- match.bracket_node_id; у схватки без соперника (BYE) номера нет; ковёр, время, состояние и результат схватки
-- добавят Phase 6–7.

-- CreateEnum
CREATE TYPE "DrawStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "BracketKind" AS ENUM ('MAIN', 'POOL', 'REPECHAGE', 'FINAL', 'PLAYOFF');

-- CreateEnum
CREATE TYPE "SlotSource" AS ENUM ('DRAW_SLOT', 'WINNER_OF', 'LOSER_OF', 'POOL_RANK', 'DYNAMIC');

-- CreateEnum
CREATE TYPE "Side" AS ENUM ('RED', 'BLUE');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'READY', 'IN_PROGRESS', 'PAUSED', 'FINISHED', 'POSTPONED', 'CANCELLED');

-- CreateTable
CREATE TABLE "draw" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "DrawStatus" NOT NULL DEFAULT 'DRAFT',
    "format" "CompetitionFormatCode" NOT NULL,
    "algorithm_version" TEXT NOT NULL,
    "random_seed" TEXT NOT NULL,
    "manual_seed" BOOLEAN NOT NULL DEFAULT false,
    "input_hash" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "separation_report" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by_id" UUID,
    "published_at" TIMESTAMPTZ(3),
    "superseded_by_id" UUID,
    "superseded_at" TIMESTAMPTZ(3),
    "supersede_reason" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "draw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draw_slot" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "draw_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "entry_id" UUID,
    "seed_number" INTEGER,
    "pool" TEXT,

    CONSTRAINT "draw_slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bracket" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "draw_id" UUID NOT NULL,
    "kind" "BracketKind" NOT NULL,
    "format" "CompetitionFormatCode" NOT NULL,
    "stage_order" INTEGER NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bracket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bracket_node" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "bracket_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "red_source" "SlotSource" NOT NULL,
    "red_source_ref" TEXT NOT NULL,
    "blue_source" "SlotSource" NOT NULL,
    "blue_source_ref" TEXT NOT NULL,
    "winner_to_node_id" UUID,
    "winner_to_side" "Side",
    "loser_to_node_id" UUID,
    "loser_to_side" "Side",
    "place_for_winner" INTEGER,
    "place_for_loser" INTEGER,

    CONSTRAINT "bracket_node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "bracket_node_id" UUID,
    "public_id" TEXT NOT NULL,
    "match_number" INTEGER,
    "round_label" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "duration_seconds" INTEGER,
    "winner_side" "Side",
    "finished_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_participant" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "side" "Side" NOT NULL,
    "entry_id" UUID,
    "is_bye" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "match_participant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "draw_competition_id_status_idx" ON "draw"("competition_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "draw_category_id_number_key" ON "draw"("category_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "draw_slot_draw_id_position_key" ON "draw_slot"("draw_id", "position");

-- CreateIndex
CREATE INDEX "bracket_category_id_idx" ON "bracket"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "bracket_draw_id_stage_order_key" ON "bracket"("draw_id", "stage_order");

-- CreateIndex
CREATE UNIQUE INDEX "bracket_node_bracket_id_round_position_key" ON "bracket_node"("bracket_id", "round", "position");

-- CreateIndex
CREATE UNIQUE INDEX "bracket_node_bracket_id_key_key" ON "bracket_node"("bracket_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "match_bracket_node_id_key" ON "match"("bracket_node_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_public_id_key" ON "match"("public_id");

-- CreateIndex
CREATE INDEX "match_competition_id_status_idx" ON "match"("competition_id", "status");

-- CreateIndex
CREATE INDEX "match_category_id_status_idx" ON "match"("category_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "match_competition_id_match_number_key" ON "match"("competition_id", "match_number");

-- CreateIndex
CREATE INDEX "match_participant_entry_id_idx" ON "match_participant"("entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_participant_match_id_side_key" ON "match_participant"("match_id", "side");

-- AddForeignKey
ALTER TABLE "draw" ADD CONSTRAINT "draw_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draw" ADD CONSTRAINT "draw_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "competition_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draw" ADD CONSTRAINT "draw_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draw" ADD CONSTRAINT "draw_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draw" ADD CONSTRAINT "draw_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draw_slot" ADD CONSTRAINT "draw_slot_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draw_slot" ADD CONSTRAINT "draw_slot_draw_id_fkey" FOREIGN KEY ("draw_id") REFERENCES "draw"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draw_slot" ADD CONSTRAINT "draw_slot_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bracket" ADD CONSTRAINT "bracket_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bracket" ADD CONSTRAINT "bracket_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "competition_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bracket" ADD CONSTRAINT "bracket_draw_id_fkey" FOREIGN KEY ("draw_id") REFERENCES "draw"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bracket_node" ADD CONSTRAINT "bracket_node_bracket_id_fkey" FOREIGN KEY ("bracket_id") REFERENCES "bracket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bracket_node" ADD CONSTRAINT "bracket_node_winner_to_node_id_fkey" FOREIGN KEY ("winner_to_node_id") REFERENCES "bracket_node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bracket_node" ADD CONSTRAINT "bracket_node_loser_to_node_id_fkey" FOREIGN KEY ("loser_to_node_id") REFERENCES "bracket_node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bracket_node" ADD CONSTRAINT "bracket_node_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match" ADD CONSTRAINT "match_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match" ADD CONSTRAINT "match_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "competition_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match" ADD CONSTRAINT "match_bracket_node_id_fkey" FOREIGN KEY ("bracket_node_id") REFERENCES "bracket_node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participant" ADD CONSTRAINT "match_participant_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participant" ADD CONSTRAINT "match_participant_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participant" ADD CONSTRAINT "match_participant_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Частичные уникальные индексы ----------

-- Опубликованная жеребьёвка категории — одна (раздел 53: нельзя тихо изменить опубликованную жеребьёвку).
CREATE UNIQUE INDEX "draw_published_uq" ON "draw" ("category_id") WHERE "status" = 'PUBLISHED';
-- Участник в жеребьёвке — один раз; номер посева — один раз.
CREATE UNIQUE INDEX "draw_slot_entry_uq" ON "draw_slot" ("draw_id", "entry_id") WHERE "entry_id" IS NOT NULL;
CREATE UNIQUE INDEX "draw_slot_seed_uq" ON "draw_slot" ("draw_id", "seed_number") WHERE "seed_number" IS NOT NULL;
CREATE INDEX "draw_slot_entry_idx" ON "draw_slot" ("entry_id") WHERE "entry_id" IS NOT NULL;

-- ---------- CHECK-ограничения ----------

ALTER TABLE "draw"
  ADD CONSTRAINT "draw_number_ck" CHECK ("number" >= 1),
  ADD CONSTRAINT "draw_seed_ck" CHECK ("random_seed" ~ '^[0-9a-f]{32}$' AND "random_seed" !~ '^0+$'),
  ADD CONSTRAINT "draw_input_hash_ck" CHECK ("input_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "draw_published_ck" CHECK ("status" = 'DRAFT' OR "published_at" IS NOT NULL),
  ADD CONSTRAINT "draw_superseded_ck"
    CHECK (("status" = 'SUPERSEDED') = ("superseded_at" IS NOT NULL) AND ("status" <> 'SUPERSEDED' OR "supersede_reason" IS NOT NULL));

ALTER TABLE "draw_slot"
  ADD CONSTRAINT "draw_slot_position_ck" CHECK ("position" >= 1),
  ADD CONSTRAINT "draw_slot_seed_ck" CHECK ("seed_number" IS NULL OR ("seed_number" >= 1 AND "entry_id" IS NOT NULL)),
  ADD CONSTRAINT "draw_slot_pool_ck" CHECK ("pool" IS NULL OR "pool" IN ('A', 'B'));

ALTER TABLE "bracket"
  ADD CONSTRAINT "bracket_stage_order_ck" CHECK ("stage_order" >= 1);

ALTER TABLE "bracket_node"
  ADD CONSTRAINT "bracket_node_round_ck" CHECK ("round" >= 1 AND "position" >= 1),
  ADD CONSTRAINT "bracket_node_winner_link_ck" CHECK (("winner_to_node_id" IS NULL) = ("winner_to_side" IS NULL)),
  ADD CONSTRAINT "bracket_node_loser_link_ck" CHECK (("loser_to_node_id" IS NULL) = ("loser_to_side" IS NULL)),
  ADD CONSTRAINT "bracket_node_places_ck"
    CHECK (("place_for_winner" IS NULL OR "place_for_winner" >= 1) AND ("place_for_loser" IS NULL OR "place_for_loser" >= 1));

ALTER TABLE "match"
  ADD CONSTRAINT "match_number_ck" CHECK ("match_number" IS NULL OR "match_number" >= 1),
  ADD CONSTRAINT "match_public_id_ck" CHECK ("public_id" ~ '^[1-9A-HJ-NP-Za-km-z]{12}$'),
  ADD CONSTRAINT "match_duration_ck" CHECK ("duration_seconds" IS NULL OR "duration_seconds" > 0),
  ADD CONSTRAINT "match_winner_ck" CHECK ("winner_side" IS NULL OR "status" = 'FINISHED'),
  ADD CONSTRAINT "match_finished_ck" CHECK ("status" <> 'FINISHED' OR "finished_at" IS NOT NULL);

-- Раздел 53: сторона схватки — участник или BYE, не одновременно.
ALTER TABLE "match_participant"
  ADD CONSTRAINT "match_participant_bye_ck" CHECK (NOT ("is_bye" AND "entry_id" IS NOT NULL));

-- ---------- Неизменяемость опубликованной жеребьёвки (ADR-11; раздел 53) ----------
-- Опубликованная и заменённая версии не меняются и не удаляются. Единственное изменение — PUBLISHED → SUPERSEDED
-- (draw.republish): статус, кто, когда и почему заменил, версия. Слоты неизменяемы, пока жеребьёвка не черновик.

CREATE OR REPLACE FUNCTION "forbid_change_published_draw"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'draw % is %, it cannot be deleted', OLD."id", OLD."status" USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF OLD."status" = 'PUBLISHED' AND NEW."status" = 'SUPERSEDED'
     AND (NEW."id", NEW."competition_id", NEW."category_id", NEW."number", NEW."format", NEW."algorithm_version",
          NEW."random_seed", NEW."manual_seed", NEW."input_hash", NEW."input", NEW."separation_report", NEW."created_by_id",
          NEW."created_at", NEW."published_by_id", NEW."published_at")
         IS NOT DISTINCT FROM
         (OLD."id", OLD."competition_id", OLD."category_id", OLD."number", OLD."format", OLD."algorithm_version",
          OLD."random_seed", OLD."manual_seed", OLD."input_hash", OLD."input", OLD."separation_report", OLD."created_by_id",
          OLD."created_at", OLD."published_by_id", OLD."published_at") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'draw % is %, it cannot be changed', OLD."id", OLD."status" USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER "draw_immutable"
  BEFORE UPDATE OR DELETE ON "draw"
  FOR EACH ROW EXECUTE FUNCTION "forbid_change_published_draw"();

CREATE OR REPLACE FUNCTION "forbid_change_published_draw_slot"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status "DrawStatus";
BEGIN
  -- Слоты меняются, добавляются и удаляются только у черновика: и у прежней жеребьёвки строки, и у новой.
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "status" INTO v_status FROM "draw" WHERE "id" = OLD."draw_id";
    IF v_status IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION 'slots of draw % are immutable', OLD."draw_id" USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "status" INTO v_status FROM "draw" WHERE "id" = NEW."draw_id";
    IF v_status IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION 'slots of draw % are immutable', NEW."draw_id" USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "draw_slot_immutable"
  BEFORE INSERT OR UPDATE OR DELETE ON "draw_slot"
  FOR EACH ROW EXECUTE FUNCTION "forbid_change_published_draw_slot"();

-- ---------- Журнал синхронизации (DATABASE.md, 7) ----------

CREATE TRIGGER "draw_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "draw"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "draw_slot_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "draw_slot"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "bracket_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "bracket"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "bracket_node_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "bracket_node"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "match_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "match"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "match_participant_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "match_participant"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');

-- ---------- Права роли приложения ----------
-- Default privileges из первой миграции покрывают новые таблицы; явный GRANT — на случай, если миграции
-- применяются другим владельцем схемы.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sde_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      "draw", "draw_slot", "bracket", "bracket_node", "match", "match_participant"
    TO sde_app;
  END IF;
END
$$;
