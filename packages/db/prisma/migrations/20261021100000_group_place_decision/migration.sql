-- Рейтинг, фаза 12: решение главного судьи об общем месте в подгруппе рейтингового формата (ТЗ 31). Критерии мест
-- не разделили участников, от места которых зависит выход в финальную часть или пара в ней; порядок задают люди,
-- с причиной. Строки только дополняются: другое решение — новая строка, действует последняя.

-- CreateTable
CREATE TABLE "group_place_decision" (
    "id" UUID NOT NULL,
    "competition_id" UUID NOT NULL,
    "draw_id" UUID NOT NULL,
    "group_letter" TEXT NOT NULL,
    "tiers" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "decided_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_place_decision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_place_decision_draw_id_group_letter_created_at_idx" ON "group_place_decision"("draw_id", "group_letter", "created_at");

-- AddForeignKey
ALTER TABLE "group_place_decision" ADD CONSTRAINT "group_place_decision_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_place_decision" ADD CONSTRAINT "group_place_decision_draw_id_fkey" FOREIGN KEY ("draw_id") REFERENCES "draw"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_place_decision" ADD CONSTRAINT "group_place_decision_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "group_place_decision"
  ADD CONSTRAINT "group_place_decision_group_ck" CHECK ("group_letter" IN ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H')),
  ADD CONSTRAINT "group_place_decision_tiers_ck" CHECK (jsonb_typeof("tiers") = 'array' AND jsonb_array_length("tiers") >= 1),
  ADD CONSTRAINT "group_place_decision_reason_ck" CHECK (length(btrim("reason")) > 0);

CREATE OR REPLACE FUNCTION "forbid_change_group_place_decision"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'group place decision % is immutable', OLD."id" USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER "group_place_decision_immutable"
  BEFORE UPDATE OR DELETE ON "group_place_decision"
  FOR EACH ROW EXECUTE FUNCTION "forbid_change_group_place_decision"();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sde_app') THEN
    GRANT SELECT, INSERT ON TABLE "group_place_decision" TO sde_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "group_place_decision" FROM sde_app;
  END IF;
END
$$;
