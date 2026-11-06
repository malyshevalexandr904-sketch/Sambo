-- «Мои документы» спортсмена (правки 05.11.2026): полис ОМС и справка из школы с фотографией (вместе со свидетельством
-- о рождении — документ, удостоверяющий личность, младше 14 лет). Справочник — packages/db/scripts/reference-data.ts.
INSERT INTO "document_type" ("code", "name_ru", "name_en", "sensitivity", "allowed_mime", "max_size_bytes", "retention_days") VALUES
  ('OMS_POLICY', 'Полис ОМС', 'Compulsory health insurance policy', 'IDENTITY'::"Sensitivity", 'application/pdf,image/jpeg,image/png', 10485760, 400),
  ('SCHOOL_CERTIFICATE', 'Справка из школы с фотографией', 'School certificate with a photo', 'IDENTITY'::"Sensitivity", 'application/pdf,image/jpeg,image/png', 10485760, 400)
ON CONFLICT ("code") DO NOTHING;
