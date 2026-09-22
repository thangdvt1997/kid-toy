-- Enables Postgres's built-in `unaccent` contrib extension, shipped with
-- the official postgres:17-alpine image. Required for diacritic-insensitive
-- product-name search on the public catalog (CATALOG-07) — e.g. a visitor
-- searching "do choi" must find "Đồ chơi...". Idempotent: safe to re-run
-- via `prisma migrate deploy` on an environment where it already exists.
CREATE EXTENSION IF NOT EXISTS "unaccent";
