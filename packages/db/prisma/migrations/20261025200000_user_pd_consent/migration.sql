-- Согласие на обработку ПДн при регистрации — отдельно от условий использования (152-ФЗ, ст. 9, ч. 1, с 01.09.2025).
-- Время принятия условий, время согласия и редакция текста согласия, который видел человек.
ALTER TABLE "user" ADD COLUMN "terms_accepted_at" TIMESTAMPTZ(3);
ALTER TABLE "user" ADD COLUMN "pd_consent_at" TIMESTAMPTZ(3);
ALTER TABLE "user" ADD COLUMN "pd_consent_version" TEXT;

-- Согласие без времени не бывает: версия записывается только вместе с ним.
ALTER TABLE "user" ADD CONSTRAINT "user_pd_consent_check" CHECK ("pd_consent_version" IS NULL OR "pd_consent_at" IS NOT NULL);
