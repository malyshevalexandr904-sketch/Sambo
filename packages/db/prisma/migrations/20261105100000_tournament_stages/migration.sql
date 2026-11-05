-- Стадии проведения турнира (правки 05.11.2026): «Опубликован» до начала регистрации, черновики заявок на
-- проведение, подписка на начало регистрации, шаблон афиши и медиа завершённого турнира.
ALTER TYPE "CompetitionStatus" ADD VALUE IF NOT EXISTS 'PUBLISHED' BEFORE 'REGISTRATION_OPEN';
ALTER TYPE "CompetitionRequestStatus" ADD VALUE IF NOT EXISTS 'DRAFT' BEFORE 'SUBMITTED';
ALTER TYPE "FollowTarget" ADD VALUE IF NOT EXISTS 'COMPETITION';

-- AlterTable
ALTER TABLE "competition" ADD COLUMN "poster_template" TEXT NOT NULL DEFAULT 'classic',
  ADD COLUMN "live_stream_url" TEXT;
ALTER TABLE "competition_request" ADD COLUMN "draft" JSONB;

-- CreateEnum
CREATE TYPE "CompetitionMediaKind" AS ENUM ('PHOTO', 'VIDEO');

-- CreateTable
CREATE TABLE "competition_media" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "kind" "CompetitionMediaKind" NOT NULL,
    "file_id" UUID,
    "url" TEXT,
    "caption" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competition_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "competition_media_competition_id_created_at_idx" ON "competition_media"("competition_id", "created_at");

-- AddForeignKey
ALTER TABLE "competition_media" ADD CONSTRAINT "competition_media_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "competition_media" ADD CONSTRAINT "competition_media_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "competition_media" ADD CONSTRAINT "competition_media_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Фото — файл, видео — ссылка на ролик.
ALTER TABLE "competition_media" ADD CONSTRAINT "competition_media_source_check"
  CHECK (("kind" = 'PHOTO' AND "file_id" IS NOT NULL) OR ("kind" = 'VIDEO' AND "url" IS NOT NULL));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sde_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "competition_media" TO sde_app;
  END IF;
END
$$;
