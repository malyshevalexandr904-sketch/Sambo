-- Phase 8a «Табло» (ARCHITECTURE.md, 13; ADR-07): лента изменений для живых данных.
-- Каждая строка журнала синхронизации (операционные таблицы турнира, ADR-21) отправляет уведомление в канал
-- PostgreSQL `sde_live`. pg_notify внутри транзакции доставляется только после commit: откат — ничего не приходит,
-- и источник не важен (команда api, worker, сценарий seed). Ведущий узел api слушает канал и публикует
-- изменения в каналы WebSocket. В уведомлении — только идентификаторы и коды (без ПДн): турнир, таблица,
-- строка, операция; для схватки — версия и статус (оценка не меняет версию — отличаем счёт от статуса),
-- для строк схватки — её id, для ковра и категории — их id.
-- При применении пачек площадочного узла (`app.replication = on`) журнал не пишется — уведомлений нет;
-- повторная публикация состояния зала после пачки — Phase 9.5.

CREATE OR REPLACE FUNCTION "sync_log_notify"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_row jsonb := NEW."row_image";
BEGIN
  PERFORM pg_notify(
    'sde_live',
    json_build_object(
      'c', NEW."competition_id",
      't', NEW."table_name",
      'id', NEW."row_id",
      'op', NEW."op",
      'm', v_row ->> 'match_id',
      'cat', v_row ->> 'category_id',
      'mat', v_row ->> 'mat_id',
      'v', v_row ->> 'version',
      's', v_row ->> 'status'
    )::text
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER "sync_log_notify"
  AFTER INSERT ON "sync_log"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_notify"();
