-- Рейтинг спортсменов, фаза 2 (docs/RATING_ARCHITECTURE.md, 4, 12 — M1): версии правил расчёта рейтинга.
-- Уровни хранятся порогами в `parameters.levelRules` (отдельная таблица уровней не нужна: уровень — функция рейтинга).
CREATE TYPE "RatingRuleSetStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

CREATE TABLE "rating_rule_set" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "parameters" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "status" "RatingRuleSetStatus" NOT NULL DEFAULT 'DRAFT',
    "active_from" TIMESTAMPTZ(3),
    "active_to" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rating_rule_set_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rating_rule_set_version_check" CHECK ("version" > 0),
    CONSTRAINT "rating_rule_set_active_from_check" CHECK ("status" = 'DRAFT' OR "active_from" IS NOT NULL),
    CONSTRAINT "rating_rule_set_active_to_check" CHECK (("status" = 'RETIRED') = ("active_to" IS NOT NULL))
);

CREATE UNIQUE INDEX "rating_rule_set_code_version_key" ON "rating_rule_set"("code", "version");
-- Новые рейтинговые турниры закрепляют действующую версию: у кода она одна.
CREATE UNIQUE INDEX "rating_rule_set_one_active_key" ON "rating_rule_set"("code") WHERE "status" = 'ACTIVE';

-- Действующая и выведенная версии не меняются и не удаляются; допустим только вывод из обращения
-- (ACTIVE → RETIRED с датой окончания) без изменения содержимого.
CREATE OR REPLACE FUNCTION "forbid_update_active_rating_rule_set"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'rating_rule_set % is active and immutable', OLD."id" USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF OLD."status" = 'ACTIVE' AND NEW."status" = 'RETIRED'
     AND NEW."code" = OLD."code" AND NEW."version" = OLD."version" AND NEW."name" = OLD."name"
     AND NEW."schema_version" = OLD."schema_version" AND NEW."parameters" = OLD."parameters"
     AND NEW."checksum" = OLD."checksum" AND NEW."engine_version" = OLD."engine_version"
     AND NEW."active_from" IS NOT DISTINCT FROM OLD."active_from" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'rating_rule_set % is active and immutable', OLD."id" USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "rating_rule_set_immutable"
  BEFORE UPDATE OR DELETE ON "rating_rule_set"
  FOR EACH ROW EXECUTE FUNCTION "forbid_update_active_rating_rule_set"();

-- sambo-elo@1 — решения заказчика 2026-10-18 (docs/RATING_RULES.md, 8): Приложение 5 (K 60/30/10, симметричная
-- таблица S), исходы по правилам вида спорта «самбо» (приказ Минспорта № 892). Параметры — канонический JSON
-- SAMBO_ELO_V1 (apps/api/src/modules/rating/domain/rules.ts); совпадение проверяет rating.e2e.test.ts.
INSERT INTO "rating_rule_set" (
  "id", "code", "version", "name", "schema_version", "parameters", "checksum", "engine_version", "status",
  "active_from", "updated_at"
) VALUES (
  '0199f6a0-0000-7000-8000-000000000001', 'sambo-elo', 1, 'Рейтинг самбо (Приложение 5)', 1,
  '{"initialRating":200,"kFactorRules":[{"k":60,"maxRating":100},{"k":30,"maxRating":300},{"k":10,"maxRating":null}],"levelRules":[{"from":null,"level":1},{"from":400,"level":2},{"from":600,"level":3},{"from":800,"level":4},{"from":1000,"level":5},{"from":1200,"level":6},{"from":1400,"level":7},{"from":1600,"level":8},{"from":1800,"level":9},{"from":2000,"level":10}],"outcomeRules":[{"kind":"CLEAN","method":"TOTAL_VICTORY"},{"kind":"CLEAN","method":"SUPERIORITY"},{"kind":"CLEAN","method":"DISQUALIFICATION"},{"kind":"CLEAN","method":"NO_SHOW"},{"kind":"CLEAN","method":"WITHDRAWAL"},{"kind":"CLEAN","method":"INJURY"},{"kind":"POINTS","method":"POINTS","methodDetail":null},{"kind":"SMALL_ADVANTAGE","method":"POINTS","methodDetail":"TECHNICAL_POINTS"},{"kind":"SMALL_ADVANTAGE","method":"POINTS","methodDetail":"MORE_HIGH_SCORES"},{"kind":"MINIMAL_ADVANTAGE","method":"POINTS","methodDetail":"LAST_TECHNICAL_ACTION"},{"kind":"MINIMAL_ADVANTAGE","method":"POINTS","methodDetail":"FEWER_PENALTIES"},{"kind":"MINIMAL_ADVANTAGE","method":"POINTS","methodDetail":"LAST_PENALTY"},{"kind":"MINIMAL_ADVANTAGE","method":"DECISION"}],"roundingRule":"INTEGER_HALF_UP","scoreRules":{"CLEAN_LOSS":"0","CLEAN_WIN":"1","LOSS_MINIMAL_ADVANTAGE":"0.4","LOSS_ON_POINTS":"0.1","LOSS_SMALL_ADVANTAGE":"0.3","WIN_MINIMAL_ADVANTAGE":"0.6","WIN_ON_POINTS":"0.9","WIN_SMALL_ADVANTAGE":"0.7"}}'::jsonb,
  'ba3d3ba64447cf4a983ed99da4c551c2f273373876e3c8b3067a24333bc38793', 'elo-1', 'ACTIVE',
  '2026-10-18T00:00:00.000Z', CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sde_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "rating_rule_set" TO sde_app;
  END IF;
END
$$;
