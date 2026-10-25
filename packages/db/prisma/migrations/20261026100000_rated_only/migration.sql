-- Переход на рейтинговую систему (docs/RATED_ONLY.md): заявки организаций на проведение турнира (турнир создаёт
-- только платформа) и дивизионы спортсменов по возрасту (границы задаёт администратор платформы).

-- CreateEnum
CREATE TYPE "CompetitionRequestStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "competition_request" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "submitted_by_id" UUID,
    "status" "CompetitionRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "proposal" JSONB NOT NULL,
    "expected_participants" INTEGER,
    "comment" TEXT,
    "decision_reason" TEXT,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "competition_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "competition_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "division" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "min_age" INTEGER,
    "max_age" INTEGER,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "division_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "competition_request_competition_id_key" ON "competition_request"("competition_id");

-- CreateIndex
CREATE INDEX "competition_request_status_id_idx" ON "competition_request"("status", "id");

-- CreateIndex
CREATE INDEX "competition_request_organization_id_id_idx" ON "competition_request"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "competition_request" ADD CONSTRAINT "competition_request_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_request" ADD CONSTRAINT "competition_request_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_request" ADD CONSTRAINT "competition_request_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competition_request" ADD CONSTRAINT "competition_request_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "competition_request" ADD CONSTRAINT "competition_request_dates_check" CHECK ("end_date" >= "start_date");
ALTER TABLE "competition_request" ADD CONSTRAINT "competition_request_participants_check"
  CHECK ("expected_participants" IS NULL OR "expected_participants" > 0);
-- Одобренная заявка всегда ссылается на созданный турнир, неодобренная — нет.
ALTER TABLE "competition_request" ADD CONSTRAINT "competition_request_competition_check"
  CHECK (("status" = 'APPROVED') = ("competition_id" IS NOT NULL));

ALTER TABLE "division" ADD CONSTRAINT "division_ages_check"
  CHECK (("min_age" IS NULL OR "min_age" >= 0) AND ("max_age" IS NULL OR "max_age" >= 0)
    AND ("min_age" IS NULL OR "max_age" IS NULL OR "min_age" <= "max_age"));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sde_app') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE "competition_request" TO sde_app;
    REVOKE DELETE, TRUNCATE ON TABLE "competition_request" FROM sde_app;
    -- Дивизион удаляется мягко (deleted_at).
    GRANT SELECT, INSERT, UPDATE ON TABLE "division" TO sde_app;
    REVOKE DELETE, TRUNCATE ON TABLE "division" FROM sde_app;
  END IF;
END
$$;
