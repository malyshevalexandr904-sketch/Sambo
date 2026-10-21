-- Удаление учебных (вымышленных) данных, которые install.sh загрузил из packages/db/seed и seed-schedule.ts.
-- Запускается из remove-demo-data.sh: psql -v apply=false|true. Без apply — только отчёт, база не меняется.
--
-- Что считается учебным: строки с id из блока seed «01920000-0000-7000-…» (настоящие записи получают uuid v7 с
-- текущим временем) и всё, что на них ссылается по внешним ключам (жеребьёвки, схватки, сессии, журналы действий
-- учебных пользователей и т. д.), плюс строки без внешнего ключа с competition_id учебного турнира (sync_log,
-- outbox). Журналы audit_log и data_access_log по турнирам не трогаются — только записи учебных пользователей.
-- Остаются: учётная запись администратора платформы из seed (admin@sambo.local) — ею входит владелец сайта — и
-- справочники платформы из seed (набор правил, возрастные группы, весовые категории, шаблон категорий, тексты
-- согласий): без них не создать настоящий турнир и не зарегистрировать спортсмена.
--
-- Удаление идёт с session_replication_role = replica (без триггеров неизменяемости и sync_log), поэтому после него
-- проверяется каждый внешний ключ базы: висячая ссылка — ошибка и откат всей транзакции.
\set ON_ERROR_STOP on
\set QUIET on
\set VERBOSITY terse
SET client_min_messages = notice;

BEGIN;
SET LOCAL session_replication_role = replica;
SELECT set_config('demo.apply', :'apply', true) \g /dev/null

CREATE TEMP TABLE demo_keep (id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO demo_keep VALUES
  ('01920000-0000-7000-8001-000000000001'),  -- admin@sambo.local
  ('01920000-0000-7000-8002-000000000001'),  -- его вход по паролю
  ('01920000-0000-7000-8003-000000000001'),  -- его карточка человека
  ('01920000-0000-7000-8004-000000000001');  -- роль SUPER_ADMIN

-- Помеченные к удалению строки: таблица верхнего уровня, раздел (для audit_log) и ctid.
CREATE TEMP TABLE demo_row (rel regclass, part oid, tid tid, PRIMARY KEY (rel, part, tid)) ON COMMIT DROP;

-- Строки, которые остаются при любом раскладе: настоящие турниры и организации и всё, на что они ссылаются
-- (например, учебный оргкомитет или площадка, к которым привязан настоящий турнир).
CREATE TEMP TABLE demo_hold (rel regclass, part oid, tid tid, PRIMARY KEY (rel, part, tid)) ON COMMIT DROP;

CREATE TEMP TABLE demo_real_user (email text, rel text, n bigint) ON COMMIT DROP;

CREATE TEMP TABLE demo_fk ON COMMIT DROP AS
SELECT c.conrelid::regclass AS child, a.attname AS child_col, c.confrelid::regclass AS parent, af.attname AS parent_col,
       cardinality(c.conkey) AS width
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
WHERE c.contype = 'f' AND c.conparentid = 0 AND c.connamespace = 'public'::regnamespace;

DO $$
DECLARE
  r record;
  added bigint;
  total bigint;
  real_users bigint := 0;
  conflicts bigint := 0;
  prefix constant text := '01920000-0000-7000-%';
BEGIN
  IF EXISTS (SELECT 1 FROM demo_fk WHERE width <> 1) THEN
    RAISE EXCEPTION 'В базе есть составные внешние ключи — скрипт рассчитан только на простые. Ничего не удалено.';
  END IF;

  -- 0. Настоящие турниры и организации и то, на что они ссылаются, — не трогаются.
  INSERT INTO demo_hold SELECT 'competition'::regclass, t.tableoid, t.ctid FROM competition t WHERE t.id::text NOT LIKE prefix;
  INSERT INTO demo_hold SELECT 'organization'::regclass, t.tableoid, t.ctid FROM organization t WHERE t.id::text NOT LIKE prefix;
  LOOP
    total := 0;
    -- Ссылки на пользователей («кто создал») не держат учебную учётную запись: их забирает администратор.
    FOR r IN SELECT * FROM demo_fk WHERE child IN (SELECT DISTINCT rel FROM demo_hold) AND parent <> '"user"'::regclass LOOP
      EXECUTE format(
        'INSERT INTO demo_hold SELECT %3$L::regclass, p.tableoid, p.ctid FROM %3$s p
         WHERE p.%4$I IN (SELECT c.%2$I FROM %1$s c JOIN demo_hold h
                          ON h.rel = %1$L::regclass AND h.part = c.tableoid AND h.tid = c.ctid)
         ON CONFLICT DO NOTHING', r.child, r.child_col, r.parent, r.parent_col);
      GET DIAGNOSTICS added = ROW_COUNT;
      total := total + added;
    END LOOP;
    EXIT WHEN total = 0;
  END LOOP;

  -- 1. Строки seed во всех таблицах с uuid-колонкой id.
  FOR r IN
    SELECT c.oid::regclass AS rel
    FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'id' AND a.atttypid = 'uuid'::regtype
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND c.relname NOT IN ('rule_set', 'rule_set_version', 'age_group', 'weight_category', 'category_template',
                            'category_template_item', 'consent_template')
  LOOP
    EXECUTE format(
      'INSERT INTO demo_row SELECT %1$L::regclass, t.tableoid, t.ctid FROM %1$s t
       WHERE t.id::text LIKE %2$L AND t.id NOT IN (SELECT id FROM demo_keep)
         AND NOT EXISTS (SELECT 1 FROM demo_hold h WHERE h.rel = %1$L::regclass AND h.part = t.tableoid AND h.tid = t.ctid)',
      r.rel, prefix);
  END LOOP;

  -- 2. Строки без внешнего ключа на турнир (sync_log, outbox_event, уведомления…), кроме журналов аудита.
  FOR r IN
    SELECT c.oid::regclass AS rel
    FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'competition_id' AND NOT a.attisdropped
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND c.relname NOT IN ('audit_log', 'data_access_log')
      AND NOT EXISTS (SELECT 1 FROM demo_fk f WHERE f.child = c.oid::regclass AND f.child_col = 'competition_id')
  LOOP
    EXECUTE format(
      'INSERT INTO demo_row SELECT %1$L::regclass, t.tableoid, t.ctid FROM %1$s t
       WHERE t.competition_id::text LIKE %2$L ON CONFLICT DO NOTHING', r.rel, prefix);
  END LOOP;

  -- 3. Всё, что ссылается на помеченные строки, — до тех пор, пока набор растёт.
  LOOP
    total := 0;
    FOR r IN SELECT * FROM demo_fk WHERE parent IN (SELECT DISTINCT rel FROM demo_row) LOOP
      EXECUTE format(
        'INSERT INTO demo_row SELECT %1$L::regclass, c.tableoid, c.ctid FROM %1$s c
         WHERE c.%2$I IN (SELECT p.%4$I FROM %3$s p JOIN demo_row d
                          ON d.rel = %3$L::regclass AND d.part = p.tableoid AND d.tid = p.ctid)
           AND NOT EXISTS (SELECT 1 FROM demo_hold h WHERE h.rel = %1$L::regclass AND h.part = c.tableoid AND h.tid = c.ctid)
         ON CONFLICT DO NOTHING', r.child, r.child_col, r.parent, r.parent_col);
      GET DIAGNOSTICS added = ROW_COUNT;
      total := total + added;
    END LOOP;
    EXIT WHEN total = 0;
  END LOOP;

  -- Отчёт: что именно будет удалено.
  RAISE NOTICE '';
  RAISE NOTICE '=== Учебные турниры ===';
  FOR r IN SELECT t.name FROM competition t JOIN demo_row d ON d.rel = 'competition'::regclass AND d.tid = t.ctid ORDER BY 1 LOOP
    RAISE NOTICE '  %', r.name;
  END LOOP;
  RAISE NOTICE '=== Учебные учётные записи ===';
  FOR r IN SELECT t.email, t.display_name FROM "user" t JOIN demo_row d ON d.rel = 'user'::regclass AND d.tid = t.ctid ORDER BY 1 LOOP
    RAISE NOTICE '  % — %', rpad(r.email::text, 26), r.display_name;
  END LOOP;
  RAISE NOTICE '=== Учебные организации ===';
  FOR r IN SELECT t.name FROM organization t JOIN demo_row d ON d.rel = 'organization'::regclass AND d.tid = t.ctid ORDER BY 1 LOOP
    RAISE NOTICE '  %', r.name;
  END LOOP;
  SELECT count(*) INTO total FROM athlete_profile t JOIN demo_row d ON d.rel = 'athlete_profile'::regclass AND d.tid = t.ctid;
  RAISE NOTICE '=== Учебные спортсмены: % ===', total;
  SELECT count(*) INTO total FROM demo_hold h JOIN organization t ON h.rel = 'organization'::regclass AND h.tid = t.ctid
  WHERE t.id::text LIKE prefix;
  IF total > 0 THEN
    RAISE NOTICE '=== Учебные организации остаются: к ним привязаны ваши настоящие турниры или организации ===';
    FOR r IN SELECT t.name FROM organization t JOIN demo_hold h ON h.rel = 'organization'::regclass AND h.tid = t.ctid
             WHERE t.id::text LIKE prefix ORDER BY 1 LOOP
      RAISE NOTICE '  %', r.name;
    END LOOP;
  END IF;
  FOR r IN SELECT t.name FROM venue t JOIN demo_hold h ON h.rel = 'venue'::regclass AND h.tid = t.ctid
           WHERE t.id::text LIKE prefix ORDER BY 1 LOOP
    RAISE NOTICE '  учебная площадка «%» остаётся: её выбрали в настоящем турнире', r.name;
  END LOOP;
  RAISE NOTICE '=== Всего строк по таблицам ===';
  FOR r IN SELECT rel::text AS rel, count(*) AS n FROM demo_row GROUP BY 1 ORDER BY 2 DESC, 1 LOOP
    RAISE NOTICE '  % %', rpad(r.rel, 34), r.n;
  END LOOP;

  -- Настоящие пользователи, чьи записи уйдут вместе с учебными (роль в учебном турнире, действия в нём).
  FOR r IN SELECT * FROM demo_fk WHERE parent = '"user"'::regclass AND child IN (SELECT DISTINCT rel FROM demo_row) LOOP
    EXECUTE format(
      'INSERT INTO demo_real_user SELECT u.email, %1$L, count(*) FROM %1$s c
       JOIN demo_row d ON d.rel = %1$L::regclass AND d.part = c.tableoid AND d.tid = c.ctid
       JOIN "user" u ON u.id = c.%2$I
       WHERE u.id::text NOT LIKE %3$L GROUP BY u.email', r.child, r.child_col, prefix);
  END LOOP;
  SELECT count(*) INTO real_users FROM demo_real_user;
  IF real_users > 0 THEN
    RAISE NOTICE '=== Настоящие пользователи: их записи в учебных турнирах тоже удалятся (сами учётные записи остаются) ===';
    FOR r IN SELECT email, string_agg(rel || ' ' || n, ', ' ORDER BY rel) AS what FROM demo_real_user GROUP BY 1 ORDER BY 1 LOOP
      RAISE NOTICE '  %: %', r.email, r.what;
    END LOOP;
  END IF;

  -- Защита настоящих данных: настоящий турнир, организация, человек, спортсмен или пользователь не может попасть
  -- в удаление, и ничто удаляемое не может принадлежать настоящему турниру, организации, человеку или спортсмену.
  FOR r IN
    SELECT d.rel::text AS rel, count(*) AS n FROM demo_row d
    WHERE d.rel IN ('competition'::regclass, 'organization'::regclass, 'person'::regclass,
                    'athlete_profile'::regclass, '"user"'::regclass)
    GROUP BY 1
  LOOP
    EXECUTE format('SELECT count(*) FROM %1$s t JOIN demo_row d ON d.rel = %1$L::regclass AND d.tid = t.ctid
                    WHERE t.id::text NOT LIKE %2$L', r.rel, prefix) INTO total;
    IF total > 0 THEN
      conflicts := conflicts + total;
      RAISE NOTICE 'ВНИМАНИЕ: % настоящих записей в таблице % связаны с учебными данными', total, r.rel;
    END IF;
  END LOOP;
  FOR r IN
    SELECT * FROM demo_fk
    WHERE parent IN ('competition'::regclass, 'organization'::regclass, 'person'::regclass, 'athlete_profile'::regclass)
      AND child IN (SELECT DISTINCT rel FROM demo_row)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %1$s c JOIN demo_row d ON d.rel = %1$L::regclass AND d.part = c.tableoid AND d.tid = c.ctid
       JOIN %3$s p ON p.%4$I = c.%2$I WHERE p.id::text NOT LIKE %5$L',
      r.child, r.child_col, r.parent, r.parent_col, prefix) INTO total;
    IF total > 0 THEN
      conflicts := conflicts + total;
      RAISE NOTICE 'ВНИМАНИЕ: % строк % принадлежат настоящей записи % — они не учебные', total, r.child, r.parent;
    END IF;
  END LOOP;
  IF conflicts > 0 AND current_setting('demo.apply')::boolean THEN
    RAISE EXCEPTION 'Настоящие данные связаны с учебными — удаление остановлено, база не изменена. Пришлите этот отчёт.';
  END IF;

  -- Удаление и проверка: ни одна оставшаяся строка не ссылается на удалённую.
  FOR r IN SELECT DISTINCT rel FROM demo_row LOOP
    EXECUTE format('DELETE FROM %1$s t USING demo_row d WHERE d.rel = %1$L::regclass AND d.part = t.tableoid AND d.tid = t.ctid', r.rel);
  END LOOP;
  -- Настоящим пользователям, у которых ушла роль в учебном турнире, — пересчёт прав без ожидания кэша.
  UPDATE "user" u SET permissions_version = permissions_version + 1 FROM (SELECT DISTINCT email FROM demo_real_user) x
  WHERE u.email = x.email;
  -- Оставшиеся строки, созданные учебной учётной записью (например, учебная площадка настоящего турнира), —
  -- теперь за администратором платформы.
  FOR r IN SELECT * FROM demo_fk WHERE parent = '"user"'::regclass LOOP
    EXECUTE format('UPDATE %1$s c SET %2$I = %3$L WHERE c.%2$I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = c.%2$I)',
                   r.child, r.child_col, '01920000-0000-7000-8001-000000000001');
  END LOOP;
  FOR r IN SELECT * FROM demo_fk LOOP
    EXECUTE format('SELECT count(*) FROM %1$s c WHERE c.%2$I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %3$s p WHERE p.%4$I = c.%2$I)',
                   r.child, r.child_col, r.parent, r.parent_col) INTO total;
    IF total > 0 THEN
      RAISE EXCEPTION 'Проверка не прошла: % строк % ссылаются на удалённые строки % — база не изменена.', total, r.child, r.parent;
    END IF;
  END LOOP;

  RAISE NOTICE '';
  IF conflicts > 0 THEN
    RAISE NOTICE 'Итог: есть настоящие данные, связанные с учебными (см. ВНИМАНИЕ выше) — удалять нельзя, пришлите отчёт.';
  ELSIF current_setting('demo.apply')::boolean THEN
    RAISE NOTICE 'Итог: учебные данные удалены.';
  ELSE
    RAISE NOTICE 'Итог: это предпросмотр, база не изменена. Проверка удаления прошла успешно.';
  END IF;
END $$;

\if :apply
COMMIT;
\else
ROLLBACK;
\endif
