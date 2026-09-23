#!/bin/sh
# Инициализация локальной БД (docker compose): владелец схемы и роль приложения (DATABASE.md, 10).
# В production роли создаёт эксплуатация у managed-провайдера (DEPLOYMENT.md).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE sde_app LOGIN PASSWORD '${SDE_APP_PASSWORD}';
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE DATABASE sde_test OWNER ${POSTGRES_USER};
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname sde_test <<SQL
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL
