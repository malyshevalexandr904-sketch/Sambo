-- Правки 07.11.2026.
-- п. 10: стаж судьи (год начала практики) и оценки судей организаторами турниров (1–5 звёзд).
-- AlterTable
ALTER TABLE "referee_profile" ADD COLUMN     "referee_since_year" INTEGER;

-- CreateTable
CREATE TABLE "referee_rating" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "referee_user_id" UUID NOT NULL,
    "rated_by_id" UUID NOT NULL,
    "stars" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "referee_rating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "referee_rating_referee_user_id_idx" ON "referee_rating"("referee_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "referee_rating_competition_id_referee_user_id_key" ON "referee_rating"("competition_id", "referee_user_id");

-- AddForeignKey
ALTER TABLE "referee_rating" ADD CONSTRAINT "referee_rating_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referee_rating" ADD CONSTRAINT "referee_rating_referee_user_id_fkey" FOREIGN KEY ("referee_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referee_rating" ADD CONSTRAINT "referee_rating_rated_by_id_fkey" FOREIGN KEY ("rated_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "referee_rating" ADD CONSTRAINT "referee_rating_stars_check" CHECK ("stars" BETWEEN 1 AND 5);
ALTER TABLE "referee_profile" ADD CONSTRAINT "referee_profile_since_year_check"
    CHECK ("referee_since_year" IS NULL OR "referee_since_year" BETWEEN 1950 AND 2100);

-- п. 4: «Отображаемого имени» больше нет — имя пользователя всегда равно ФИО его записи «человек» (если она есть).
-- Триггеры держат его в актуальном состоянии при привязке записи и при исправлении ФИО, где бы это ни произошло.
CREATE OR REPLACE FUNCTION sde_person_full_name(p_last text, p_first text, p_middle text) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$
    SELECT concat_ws(' ', nullif(btrim(p_last), ''), nullif(btrim(p_first), ''), nullif(btrim(p_middle), ''))
$$;

CREATE OR REPLACE FUNCTION sde_user_display_name_from_person() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."person_id" IS NOT NULL THEN
        SELECT sde_person_full_name(p."last_name", p."first_name", p."middle_name")
          INTO NEW."display_name"
          FROM "person" p
         WHERE p."id" = NEW."person_id";
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER "user_display_name_from_person"
    BEFORE INSERT OR UPDATE OF "person_id", "display_name" ON "user"
    FOR EACH ROW EXECUTE FUNCTION sde_user_display_name_from_person();

CREATE OR REPLACE FUNCTION sde_person_name_to_user() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    UPDATE "user"
       SET "display_name" = sde_person_full_name(NEW."last_name", NEW."first_name", NEW."middle_name")
     WHERE "person_id" = NEW."id";
    RETURN NEW;
END
$$;

CREATE TRIGGER "person_name_to_user"
    AFTER UPDATE OF "last_name", "first_name", "middle_name" ON "person"
    FOR EACH ROW EXECUTE FUNCTION sde_person_name_to_user();

UPDATE "user" u
   SET "display_name" = sde_person_full_name(p."last_name", p."first_name", p."middle_name")
  FROM "person" p
 WHERE p."id" = u."person_id";

-- п. 2: выбора языка больше нет — интерфейс и письма на русском.
UPDATE "user" SET "locale" = 'ru' WHERE "locale" <> 'ru';
