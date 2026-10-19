-- Рейтинг спортсменов, фаза 8 (docs/RATING_ARCHITECTURE.md, 3.1): тип турнира защищён.
-- После публикации турнира тип меняется только административной процедурой (она включает настройку
-- `sde.rating_type_change` в своей транзакции), а после первого расчёта рейтинга по турниру — не меняется вовсе:
-- начисленный рейтинг исправляется корректировками, а не сменой типа.
CREATE OR REPLACE FUNCTION forbid_competition_type_change() RETURNS trigger AS $$
BEGIN
  IF NEW.competition_type IS DISTINCT FROM OLD.competition_type THEN
    IF EXISTS (SELECT 1 FROM rating_calculation WHERE competition_id = OLD.id) THEN
      RAISE EXCEPTION 'competition % type is immutable: rating calculations exist', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.published_at IS NOT NULL AND coalesce(current_setting('sde.rating_type_change', true), '') <> 'on' THEN
      RAISE EXCEPTION 'competition % type is immutable after publication', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER competition_type_guard
  BEFORE UPDATE OF competition_type ON competition
  FOR EACH ROW EXECUTE FUNCTION forbid_competition_type_change();
