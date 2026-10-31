#!/usr/bin/env bash
# Creates one database per service and applies its SQL files in numeric order
# (001_schema.sql, 002_seed.sql, ...). Owner: Erona (task A-04).
#
# Used in two places, so local and CI databases are built the same way:
#   1. Docker Compose: mounted as /docker-entrypoint-initdb.d/00-init-databases.sh. Postgres runs
#      it once, when the data volume is empty. Reset with `docker compose down -v`.
#   2. CI (.github/workflows/ci.yml): run directly against the Postgres 16 service container,
#      with RERUN_SEEDS=1 to prove every seed is safe to run twice.
#
# Each folder database/<service>/ becomes the database named by <SERVICE>_DB_NAME
# (for example AUTH_DB_NAME), defaulting to <service>_db. Every folder gets a database, even
# before it has SQL files, so each service can connect from day one.
set -euo pipefail

DATABASE_DIR="${DATABASE_DIR:-/database}"
RERUN_SEEDS="${RERUN_SEEDS:-0}"

run_psql() {
  psql -v ON_ERROR_STOP=1 --quiet --no-psqlrc --username "${POSTGRES_USER:-postgres}" "$@"
}

for dir in "$DATABASE_DIR"/*/; do
  service="$(basename "$dir")"
  name_var="${service^^}_DB_NAME"
  database="${!name_var:-${service}_db}"

  echo "init-databases: creating $database"
  run_psql --dbname postgres --command "CREATE DATABASE \"$database\""

  mapfile -t files < <(find "$dir" -maxdepth 1 -name '[0-9]*.sql' | sort)
  if [ "${#files[@]}" -eq 0 ]; then
    echo "init-databases: $database is empty (no SQL files in $service/ yet)"
    continue
  fi

  for file in "${files[@]}"; do
    echo "init-databases: $database <- $(basename "$file")"
    run_psql --dbname "$database" --file "$file"
  done

  if [ "$RERUN_SEEDS" = "1" ]; then
    for file in "${files[@]}"; do
      [[ "$file" == *_seed.sql ]] || continue
      echo "init-databases: $database <- $(basename "$file") (second run)"
      run_psql --dbname "$database" --file "$file"
    done
  fi
done
