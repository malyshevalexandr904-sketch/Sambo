-- Снятие с публикации всех турниров (правки 07.11.2026, п. 5: все турниры на сайте тестовые).
-- Запускается из unpublish-test-tournaments.sh: psql -v apply=false|true. Без apply — только отчёт, база не меняется.
--
-- Турнир не стирается, а удаляется мягко, так же как удаление черновика в приложении (CompetitionsService.remove):
-- deleted_at = now(), персонал турнира теряет роли (членство ENDED), в журнал пишется competition.deleted.
-- Удалённый турнир пропадает из публичного списка, поиска и кабинетов, но его строки остаются в базе — при
-- необходимости всё возвращается из резервной копии. Спортсмены, клубы, учётные записи, документы и тестовые
-- спортсмены «Тестового клуба» не трогаются.
\set ON_ERROR_STOP on
\set QUIET on
\set VERBOSITY terse
SET client_min_messages = notice;

BEGIN;
SELECT set_config('unpub.apply', :'apply', true) \g /dev/null

CREATE TEMP TABLE unpub_target ON COMMIT DROP AS
SELECT id, slug, name, status::text AS status, organizer_organization_id
FROM competition
WHERE deleted_at IS NULL;

DO $$
DECLARE
  r record;
  n bigint;
  staff bigint;
  entries bigint;
BEGIN
  SELECT count(*) INTO n FROM unpub_target;
  IF n = 0 THEN
    RAISE NOTICE 'Опубликованных и черновых турниров нет — снимать нечего.';
    RETURN;
  END IF;

  RAISE NOTICE 'Турниры (%):', n;
  FOR r IN SELECT * FROM unpub_target ORDER BY name LOOP
    RAISE NOTICE '  • % [%] /%', r.name, r.status, r.slug;
  END LOOP;

  SELECT count(*) INTO staff FROM competition_membership m
  JOIN unpub_target t ON t.id = m.competition_id
  WHERE m.status IN ('INVITED', 'ACTIVE', 'SUSPENDED');
  SELECT count(*) INTO entries FROM entry e JOIN unpub_target t ON t.id = e.competition_id;
  RAISE NOTICE 'Персонал турниров, который потеряет роли: %', staff;
  RAISE NOTICE 'Заявок спортсменов в этих турнирах: % (остаются в базе, спортсмены не меняются)', entries;

  IF current_setting('unpub.apply') <> 'true' THEN
    RETURN;
  END IF;

  WITH ended AS (
    UPDATE competition_membership m
    SET status = 'ENDED', version = m.version + 1
    FROM unpub_target t
    WHERE t.id = m.competition_id AND m.status IN ('INVITED', 'ACTIVE', 'SUSPENDED')
    RETURNING m.user_id
  )
  UPDATE "user" u SET permissions_version = u.permissions_version + 1
  WHERE u.id IN (SELECT user_id FROM ended WHERE user_id IS NOT NULL);

  UPDATE competition c SET deleted_at = now(), version = c.version + 1
  FROM unpub_target t WHERE t.id = c.id;

  INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, competition_id, organization_id, before,
                         reason, platform_intervention)
  SELECT gen_random_uuid(), 'SYSTEM', 'competition.deleted', 'Competition', t.id, t.id, t.organizer_organization_id,
         jsonb_build_object('status', t.status, 'slug', t.slug),
         'Правки 07.11.2026: тестовые турниры сняты с публикации (unpublish-test-tournaments.sh)', true
  FROM unpub_target t;

  RAISE NOTICE 'Снято с публикации турниров: %', n;
END $$;

COMMIT;
