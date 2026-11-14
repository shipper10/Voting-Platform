#!/usr/bin/env bash
# يشغّل مجموعة اختبارات قاعدة البيانات على عنقود PostgreSQL مؤقت.
# الاستخدام: bash supabase/tests/run.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
WORK="$(mktemp -d)"; chmod 755 "$WORK"
PORT="${PGPORT_TEST:-54329}"
if [ "$(id -u)" = 0 ]; then RUN="runuser -u postgres --"; chown postgres "$WORK"; else RUN=""; fi
trap '$RUN $PGBIN/pg_ctl -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
$RUN $PGBIN/initdb -D "$WORK/data" -A trust -U postgres >/dev/null
$RUN $PGBIN/pg_ctl -D "$WORK/data" -o "-p $PORT -k $WORK" -l "$WORK/log" -w start >/dev/null
export PGHOST="$WORK" PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres
psql -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -f "$f"; done
psql -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/tests.sql"
psql -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/tests_part2.sql"
bash "$ROOT/supabase/tests/concurrency.sh"
echo "DB tests: ALL PASSED"
