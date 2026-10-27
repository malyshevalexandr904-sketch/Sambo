-- Правки 27.10.2026: открытый набор судей на турнир (должности с требованиями и заявки судей) и демо-вход
-- (общая учётная запись «только просмотр»).

-- CreateEnum
CREATE TYPE "RefereeRecruitmentStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "RefereeApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "is_demo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "referee_recruitment_position" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "requirements" TEXT NOT NULL,
    "status" "RefereeRecruitmentStatus" NOT NULL DEFAULT 'OPEN',
    "created_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "referee_recruitment_position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referee_recruitment_application" (
    "id" UUID NOT NULL,
    "position_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "RefereeApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "referee_recruitment_application_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "referee_recruitment_position_competition_id_created_at_idx" ON "referee_recruitment_position"("competition_id", "created_at");

-- CreateIndex
CREATE INDEX "referee_recruitment_position_status_competition_id_idx" ON "referee_recruitment_position"("status", "competition_id");

-- CreateIndex
CREATE INDEX "referee_recruitment_application_user_id_created_at_idx" ON "referee_recruitment_application"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "referee_recruitment_application_position_id_user_id_key" ON "referee_recruitment_application"("position_id", "user_id");

-- AddForeignKey
ALTER TABLE "referee_recruitment_position" ADD CONSTRAINT "referee_recruitment_position_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referee_recruitment_position" ADD CONSTRAINT "referee_recruitment_position_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referee_recruitment_position" ADD CONSTRAINT "referee_recruitment_position_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referee_recruitment_application" ADD CONSTRAINT "referee_recruitment_application_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "referee_recruitment_position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referee_recruitment_application" ADD CONSTRAINT "referee_recruitment_application_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referee_recruitment_application" ADD CONSTRAINT "referee_recruitment_application_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "referee_recruitment_position" ADD CONSTRAINT "referee_recruitment_position_requirements_check"
  CHECK (length("requirements") <= 2000);
-- Решение по заявке всегда с автором и временем, нерассмотренная заявка — без них.
ALTER TABLE "referee_recruitment_application" ADD CONSTRAINT "referee_recruitment_application_decision_check"
  CHECK (("status" = 'PENDING') = ("decided_at" IS NULL));

-- Демо-учётная запись — одна: без email, пароля, данных человека и ролей; изменения ей запрещает сервер.
CREATE UNIQUE INDEX "user_single_demo_key" ON "user" ("is_demo") WHERE "is_demo";
INSERT INTO "user" ("id", "display_name", "status", "locale", "is_demo", "updated_at")
VALUES ('019a2f00-de00-7000-8000-000000000001', 'Гость', 'ACTIVE', 'ru', true, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sde_app') THEN
    -- Должность не удаляется — набор закрывается (status = CLOSED); заявки остаются в истории.
    GRANT SELECT, INSERT, UPDATE ON TABLE "referee_recruitment_position" TO sde_app;
    REVOKE DELETE, TRUNCATE ON TABLE "referee_recruitment_position" FROM sde_app;
    GRANT SELECT, INSERT, UPDATE ON TABLE "referee_recruitment_application" TO sde_app;
    REVOKE DELETE, TRUNCATE ON TABLE "referee_recruitment_application" FROM sde_app;
  END IF;
END
$$;
