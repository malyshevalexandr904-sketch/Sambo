-- Рейтинг, фаза 13 (docs/RATING_ARCHITECTURE.md, 9): изменения рейтинга в живых каналах. Расчёт рейтинга по
-- схватке стал действующим (COMPLETED) или заменён новым (SUPERSEDED, изменённый результат) — уведомление в канал
-- `sde_live` в формате журнала синхронизации (турнир, таблица, строка, операция, схватка, статус). Рейтинг считается
-- в облаке (worker) и в журнал синхронизации площадки не пишется, поэтому уведомляет собственный триггер таблицы.
-- pg_notify внутри транзакции доставляется только после commit: откат расчёта — ничего не приходит.

CREATE OR REPLACE FUNCTION "rating_calculation_notify"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" NOT IN ('COMPLETED', 'SUPERSEDED') THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" = NEW."status" THEN
    RETURN NULL;
  END IF;
  PERFORM pg_notify(
    'sde_live',
    json_build_object(
      'c', NEW."competition_id",
      't', 'rating_calculation',
      'id', NEW."id",
      'op', TG_OP,
      'm', NEW."match_id",
      'cat', NULL,
      'mat', NULL,
      'v', NULL,
      's', NEW."status"
    )::text
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER "rating_calculation_notify"
  AFTER INSERT OR UPDATE OF "status" ON "rating_calculation"
  FOR EACH ROW EXECUTE FUNCTION "rating_calculation_notify"();
