#!/usr/bin/env sh
set -eu

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=migrator_password="$CFI_MIGRATOR_PASSWORD" \
  --set=runtime_password="$CFI_RUNTIME_PASSWORD" \
  --set=test_password="$CFI_TEST_PASSWORD" \
  --file=/workspace/scripts/database/bootstrap-roles.sql
