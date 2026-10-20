-- Роль кабинета «Персонал турнира» (TOURNAMENT_STAFF) упразднена: руководитель турнира и секретарь действуют в роли
-- «Судья» (REFEREE). Сохранённый выбор сессий и последняя выбранная роль переходят в REFEREE.

UPDATE "session_role" SET "role" = 'REFEREE', "rev" = "rev" + 1 WHERE "role" = 'TOURNAMENT_STAFF';
UPDATE "user" SET "preferred_role" = 'REFEREE' WHERE "preferred_role" = 'TOURNAMENT_STAFF';

ALTER TABLE "session_role" DROP CONSTRAINT "session_role_role_check";
ALTER TABLE "session_role" ADD CONSTRAINT "session_role_role_check" CHECK ("role" IS NULL OR "role" IN (
  'ADMIN', 'ORGANIZATION_HEAD', 'REFEREE', 'MEDICAL', 'COACH', 'ATHLETE', 'GUARDIAN'
));

ALTER TABLE "user" DROP CONSTRAINT "user_preferred_role_check";
ALTER TABLE "user" ADD CONSTRAINT "user_preferred_role_check" CHECK ("preferred_role" IS NULL OR "preferred_role" IN (
  'ADMIN', 'ORGANIZATION_HEAD', 'REFEREE', 'MEDICAL', 'COACH', 'ATHLETE', 'GUARDIAN'
));
