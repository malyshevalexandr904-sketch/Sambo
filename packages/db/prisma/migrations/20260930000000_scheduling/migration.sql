-- Phase 6 — расписание (DATABASE.md, 3.7 — новый раздел; ARCHITECTURE.md, 14.6, 16.6): ковры, сессии,
-- расписание турнира (одно на турнир), место схватки в расписании и судейские бригады ковра.
-- Часть 1 сгенерирована `prisma migrate diff` (--from-url на живую базу main, --to-schema-datamodel) и
-- проверена вручную; часть 2 — SQL-шаги, которые Prisma не выражает (DATABASE.md, 10): отложенное уникальное
-- ограничение порядка на ковре, CHECK, журнал синхронизации, права роли приложения.
-- Диф против живой базы попутно показал шум по `name_norm`/`last_name_norm`/`first_name_norm` (колонки,
-- которые ведёт триггер, а не Prisma) — эти несвязанные строки в миграцию не включены.

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "MatCrewRole" AS ENUM ('MAT_CHIEF', 'REFEREE', 'SIDE_JUDGE', 'TECHNICAL_SECRETARY', 'SCOREBOARD_OPERATOR', 'TIMEKEEPER');

-- CreateTable
CREATE TABLE "mat" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'DRAFT',
    "mat_changeover_seconds" INTEGER NOT NULL DEFAULT 60,
    "version" INTEGER NOT NULL DEFAULT 1,
    "published_by_id" UUID,
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_schedule" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "mat_id" UUID NOT NULL,
    "order_in_mat" INTEGER NOT NULL,
    "planned_at" TIMESTAMPTZ(3) NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "match_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mat_assignment" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "mat_id" UUID NOT NULL,
    "role" "MatCrewRole" NOT NULL,
    "user_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mat_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mat_competition_id_number_key" ON "mat"("competition_id", "number");

-- CreateIndex
CREATE INDEX "session_competition_id_starts_at_idx" ON "session"("competition_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_competition_id_key" ON "schedule"("competition_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_schedule_match_id_key" ON "match_schedule"("match_id");

-- CreateIndex
CREATE INDEX "match_schedule_session_id_mat_id_order_in_mat_idx" ON "match_schedule"("session_id", "mat_id", "order_in_mat");

-- CreateIndex
CREATE INDEX "match_schedule_competition_id_idx" ON "match_schedule"("competition_id");

-- CreateIndex
CREATE INDEX "mat_assignment_session_id_user_id_idx" ON "mat_assignment"("session_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mat_assignment_session_id_mat_id_role_key" ON "mat_assignment"("session_id", "mat_id", "role");

-- AddForeignKey
ALTER TABLE "mat" ADD CONSTRAINT "mat_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_schedule" ADD CONSTRAINT "match_schedule_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_schedule" ADD CONSTRAINT "match_schedule_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_schedule" ADD CONSTRAINT "match_schedule_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_schedule" ADD CONSTRAINT "match_schedule_mat_id_fkey" FOREIGN KEY ("mat_id") REFERENCES "mat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mat_assignment" ADD CONSTRAINT "mat_assignment_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mat_assignment" ADD CONSTRAINT "mat_assignment_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mat_assignment" ADD CONSTRAINT "mat_assignment_mat_id_fkey" FOREIGN KEY ("mat_id") REFERENCES "mat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mat_assignment" ADD CONSTRAINT "mat_assignment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Отложенное уникальное ограничение (раздел 47: перестановки одной транзакцией) ----------
-- Порядок на ковре в пределах сессии. DEFERRABLE INITIALLY DEFERRED: пакет перемещений может на мгновение
-- нарушить уникальность внутри транзакции (два места меняются местами) — проверка идёт только на COMMIT.
-- Prisma не умеет объявлять отложенные ограничения — обычный @@index в схеме даёт скорость чтения,
-- а уникальность здесь даёт это ограничение.

ALTER TABLE "match_schedule"
  ADD CONSTRAINT "match_schedule_session_id_mat_id_order_in_mat_key"
  UNIQUE ("session_id", "mat_id", "order_in_mat")
  DEFERRABLE INITIALLY DEFERRED;

-- ---------- CHECK-ограничения ----------

ALTER TABLE "mat"
  ADD CONSTRAINT "mat_number_ck" CHECK ("number" >= 1);

ALTER TABLE "session"
  ADD CONSTRAINT "session_time_ck" CHECK ("starts_at" < "ends_at");

ALTER TABLE "schedule"
  ADD CONSTRAINT "schedule_changeover_ck" CHECK ("mat_changeover_seconds" >= 0),
  ADD CONSTRAINT "schedule_published_ck" CHECK ("status" = 'DRAFT' OR "published_at" IS NOT NULL);

ALTER TABLE "match_schedule"
  ADD CONSTRAINT "match_schedule_order_ck" CHECK ("order_in_mat" >= 1);

-- ---------- Журнал синхронизации (DATABASE.md, 7) ----------

CREATE TRIGGER "mat_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "mat"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "session_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "session"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "schedule_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "schedule"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "match_schedule_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "match_schedule"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');
CREATE TRIGGER "mat_assignment_sync_log"
  AFTER INSERT OR UPDATE OR DELETE ON "mat_assignment"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_capture"('competition_id');

-- ---------- Права роли приложения ----------
-- Default privileges из первой миграции покрывают новые таблицы; явный GRANT — на случай, если миграции
-- применяются другим владельцем схемы.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sde_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      "mat", "session", "schedule", "match_schedule", "mat_assignment"
    TO sde_app;
  END IF;
END
$$;
