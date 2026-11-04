#!/usr/bin/env bash
set -euo pipefail
if [[ "${NODE_ENV:-development}" == "production" ]]; then
  echo "Local database setup is development-only." >&2
  exit 1
fi
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
DB_DIRECTORY="${TAPCART_PG_DIRECTORY:-/private/tmp/tapcart-postgres}"
DB_PORT="${TAPCART_PG_PORT:-55435}"
if [[ ! -x "$PG_BIN/pg_ctl" ]]; then
  echo "Set PG_BIN to PostgreSQL 16+ bin directory, or use docker compose." >&2
  exit 1
fi
mkdir -p "$DB_DIRECTORY"
if [[ ! -f "$DB_DIRECTORY/data/PG_VERSION" ]]; then
  "$PG_BIN/initdb" -D "$DB_DIRECTORY/data" -A trust -U tapcart --no-locale -E UTF8
fi
if ! "$PG_BIN/pg_ctl" -D "$DB_DIRECTORY/data" status >/dev/null 2>&1; then
  "$PG_BIN/pg_ctl" -D "$DB_DIRECTORY/data" -l "$DB_DIRECTORY/server.log" -o "-p $DB_PORT -h 127.0.0.1 -k $DB_DIRECTORY" start
fi
for database in tapcart tapcart_test; do
  if ! "$PG_BIN/psql" -h 127.0.0.1 -p "$DB_PORT" -U tapcart -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$database'" | rg -q 1; then
    "$PG_BIN/createdb" -h 127.0.0.1 -p "$DB_PORT" -U tapcart "$database"
  fi
done
printf 'Development DATABASE_URL=postgres://tapcart@127.0.0.1:%s/tapcart\n' "$DB_PORT"
printf 'TEST_DATABASE_URL=postgres://tapcart@127.0.0.1:%s/tapcart_test\n' "$DB_PORT"
echo 'Local trust authentication is confined to this development cluster. Do not expose its port.'
