-- Phase 7a — схватки и судейство (DATABASE.md, 3.6; ARCHITECTURE.md, 14.6, 16.6; ADR-06): фактический ковёр,
-- проекция счёта и отметки времени схватки, «спортсмен на ковре» у участия, журнал событий схватки (только
-- дополняется) и результат схватки (предварительный и подтверждённый; ревизии и AMENDED — Phase 7b).
-- Часть 1 сгенерирована `prisma migrate diff` (из применённых миграций в schema.prisma) и проверена вручную: из неё
-- убраны изменения, которые diff показывает для конструкций, объявленных только SQL-шагами прошлых миграций
-- (генерируемые колонки *_norm, trgm-индексы, частичные и отложенные ограничения). Часть 2 — SQL-шаги, которые
-- Prisma не выражает (DATABASE.md, 10), и миграция данных.

-- CreateEnum
CREATE TYPE "MatchEventType" AS ENUM ('CLOCK_STARTED', 'CLOCK_STOPPED', 'SCORE', 'HOLD_STARTED', 'HOLD_ENDED', 'PENALTY', 'EVENT_VOIDED');

-- CreateEnum
CREATE TYPE "MatchResultStatus" AS ENUM ('PROVISIONAL', 'CONFIRMED', 'PUBLISHED', 'AMENDED');

-- CreateEnum
CREATE TYPE "WinMethod" AS ENUM ('TOTAL_VICTORY', 'SUPERIORITY', 'POINTS', 'DECISION', 'NO_SHOW', 'WITHDRAWAL', 'INJURY', 'DISQUALIFICATION', 'BYE');

-- AlterTable
ALTER TABLE "entry" ADD COLUMN     "active_match_id" UUID;

-- AlterTable
ALTER TABLE "match" ADD COLUMN     "mat_id" UUID,
ADD COLUMN     "ready_at" TIMESTAMPTZ(3),
ADD COLUMN     "started_at" TIMESTAMPTZ(3),
ADD COLUMN     "state" JSONB,
ADD COLUMN     "state_seq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "match_event" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" "MatchEventType" NOT NULL,
    "side" "Side",
    "action_code" TEXT,
    "value" INTEGER,
    "match_clock_ms" INTEGER NOT NULL,
    "device_time" TIMESTAMPTZ(3) NOT NULL,
    "server_time" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voids_event_id" UUID,
    "idempotency_key" UUID NOT NULL,
    "recorded_by_id" UUID,
    "device_id" TEXT,
    "payload" JSONB,

    CONSTRAINT "match_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_result" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "status" "MatchResultStatus" NOT NULL DEFAULT 'PROVISIONAL',
    "winner_side" "Side",
    "method" "WinMethod" NOT NULL,
    "method_detail" TEXT,
    "red_score" INTEGER,
    "blue_score" INTEGER,
    "duration_ms" INTEGER,
    "based_on_seq" INTEGER,
    "reason" TEXT,
    "proposed_by_id" UUID,
    "proposed_at" TIMESTAMPTZ(3),
    "confirmed_by_id" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "match_result_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "match_event_match_id_seq_key" ON "match_event"("match_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "match_event_match_id_idempotency_key_key" ON "match_event"("match_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "match_result_match_id_key" ON "match_result"("match_id");

-- CreateIndex
CREATE INDEX "match_result_competition_id_status_idx" ON "match_result"("competition_id", "status");

-- CreateIndex
CREATE INDEX "entry_active_match_id_idx" ON "entry"("active_match_id");

-- CreateIndex
CREATE INDEX "match_mat_id_status_idx" ON "match"("mat_id", "status");

-- AddForeignKey
ALTER TABLE "entry" ADD CONSTRAINT "entry_active_match_id_fkey" FOREIGN KEY ("active_match_id") REFERENCES "match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match" ADD CONSTRAINT "match_mat_id_fkey" FOREIGN KEY ("mat_id") REFERENCES "mat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_event" ADD CONSTRAINT "match_event_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_event" ADD CONSTRAINT "match_event_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_event" ADD CONSTRAINT "match_event_voids_event_id_fkey" FOREIGN KEY ("voids_event_id") REFERENCES "match_event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_event" ADD CONSTRAINT "match_event_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_result" ADD CONSTRAINT "match_result_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_result" ADD CONSTRAINT "match_result_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_result" ADD CONSTRAINT "match_result_proposed_by_id_fkey" FOREIGN KEY ("proposed_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_result" ADD CONSTRAINT "match_result_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- CHECK-ограничения ----------

ALTER TABLE "match"
  ADD CONSTRAINT "match_state_seq_ck" CHECK ("state_seq" >= 0),
  ADD CONSTRAINT "match_ready_ck" CHECK ("status" <> 'READY' OR "ready_at" IS NOT NULL),
  -- Идущая схватка — на фактическом ковре и со временем старта.
  ADD CONSTRAINT "match_started_ck"
    CHECK ("status" NOT IN ('IN_PROGRESS', 'PAUSED') OR ("started_at" IS NOT NULL AND "mat_id" IS NOT NULL));

ALTER TABLE "match_event"
  ADD CONSTRAINT "match_event_seq_ck" CHECK ("seq" >= 1),
  ADD CONSTRAINT "match_event_clock_ck" CHECK ("match_clock_ms" >= 0 AND ("value" IS NULL OR "value" >= 0)),
  -- Отмена ссылается на отменяемое событие; другие события — нет.
  ADD CONSTRAINT "match_event_void_ck" CHECK (("type" = 'EVENT_VOIDED') = ("voids_event_id" IS NOT NULL)),
  -- Оценка, наказание и удержание — со стороной; оценка — с кодом действия правил.
  ADD CONSTRAINT "match_event_side_ck"
    CHECK ("type" IN ('CLOCK_STARTED', 'CLOCK_STOPPED', 'EVENT_VOIDED') OR "side" IS NOT NULL),
  ADD CONSTRAINT "match_event_action_ck" CHECK ("type" <> 'SCORE' OR "action_code" IS NOT NULL);

ALTER TABLE "match_result"
  -- Раздел 53: подтверждённый результат — с тем, кто подтвердил; без человека система подтверждает только исходы
  -- без судьи: BYE (соперника нет) и неявку снятого после жеребьёвки участника.
  ADD CONSTRAINT "match_result_confirmed_ck"
    CHECK ("status" = 'PROVISIONAL'
           OR ("confirmed_at" IS NOT NULL AND ("confirmed_by_id" IS NOT NULL OR "method" IN ('BYE', 'NO_SHOW')))),
  -- Победитель обязателен, кроме неявки обоих (оба проигравшие).
  ADD CONSTRAINT "match_result_winner_ck" CHECK ("winner_side" IS NOT NULL OR "method" = 'NO_SHOW'),
  ADD CONSTRAINT "match_result_numbers_ck"
    CHECK (("red_score" IS NULL OR "red_score" >= 0) AND ("blue_score" IS NULL OR "blue_score" >= 0)
           AND ("duration_ms" IS NULL OR "duration_ms" >= 0) AND "revision" >= 1);

-- ---------- Журнал синхронизации (DATABASE.md, 7) ----------

CREATE TRIGGER "match_event_sync_log"
  AFTER INSERT ON "match_event"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "match_result_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "match_result"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');

-- ---------- Права роли приложения ----------
-- Журнал событий схватки только дополняется (ADR-06; раздел 53): у роли приложения нет UPDATE, DELETE и TRUNCATE.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sde_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "match_result" TO sde_app;
    GRANT SELECT, INSERT ON TABLE "match_event" TO sde_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "match_event" FROM sde_app;
  END IF;
END
$$;

-- ---------- Миграция данных: схватки, решённые без соперника ----------
-- Схватки сетки, решённые при жеребьёвке или продвижении без соперника (FINISHED, одна сторона — BYE), получают
-- результат «без соперника», подтверждённый системой (план Phase 7a, §6). Строки пишутся после триггеров —
-- изменения попадают в журнал синхронизации.

INSERT INTO "match_result" ("id", "competition_id", "match_id", "status", "winner_side", "method",
                            "confirmed_at", "created_at", "updated_at")
SELECT gen_random_uuid(), m."competition_id", m."id", 'CONFIRMED', m."winner_side", 'BYE',
       COALESCE(m."finished_at", now()), now(), now()
FROM "match" m
WHERE m."status" = 'FINISHED'
  AND m."winner_side" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "match_participant" p WHERE p."match_id" = m."id" AND p."entry_id" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "match_result" r WHERE r."match_id" = m."id");
