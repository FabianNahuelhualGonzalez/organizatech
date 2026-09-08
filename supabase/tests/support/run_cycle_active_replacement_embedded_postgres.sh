#!/bin/sh
set -eu

SECURITY_ORDER=${1:-chronological}
case "$SECURITY_ORDER" in
  chronological|qa-upgrade|prod-upgrade) ;;
  *) echo "usage: $0 [chronological|qa-upgrade|prod-upgrade]" >&2; exit 2 ;;
esac

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
RUNTIME_DIR=$(mktemp -d /tmp/organizatech-cycle-pg.XXXXXX)
JAR="$RUNTIME_DIR/postgres.jar"
PGTAP_ZIP="$RUNTIME_DIR/pgtap.zip"
PORT=55439
PG_URL="https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-darwin-arm64v8/17.5.0/embedded-postgres-binaries-darwin-arm64v8-17.5.0.jar"
PG_SHA256="e9d3398e10c2ec926395498b03e75ad1a24eeaed82895e756a7e173b202cf6de"
PGTAP_URL="https://api.pgxn.org/dist/pgtap/1.3.4/pgtap-1.3.4.zip"
PGTAP_SHA256="2570574a9321082e82433768feb5bffe472ef2ced6b22608a86bfd25f2b88e40"

cleanup() {
  if test -x "$RUNTIME_DIR/bin/pg_ctl" && test -d "$RUNTIME_DIR/data"; then
    "$RUNTIME_DIR/bin/pg_ctl" -D "$RUNTIME_DIR/data" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf -- "$RUNTIME_DIR"
}
trap cleanup EXIT INT TERM

curl -fsSL "$PG_URL" -o "$JAR"
test "$(shasum -a 256 "$JAR" | awk '{print $1}')" = "$PG_SHA256"
unzip -p "$JAR" postgres-darwin-arm_64.txz | tar -xJ -C "$RUNTIME_DIR"
curl -fsSL "$PGTAP_URL" -o "$PGTAP_ZIP"
test "$(shasum -a 256 "$PGTAP_ZIP" | awk '{print $1}')" = "$PGTAP_SHA256"
mkdir "$RUNTIME_DIR/pgtap"
unzip -q "$PGTAP_ZIP" -d "$RUNTIME_DIR/pgtap"
PGTAP_SRC=$(find "$RUNTIME_DIR/pgtap" -mindepth 1 -maxdepth 1 -type d | head -1)
sed -e 's/MODULE_PATHNAME/pgtap/g' -e 's/__OS__/darwin/g' -e 's/__VERSION__/1.3/g' \
  "$PGTAP_SRC/sql/pgtap.sql.in" > "$RUNTIME_DIR/share/postgresql/extension/pgtap--1.3.4.sql"
cp "$PGTAP_SRC/pgtap.control" "$RUNTIME_DIR/share/postgresql/extension/pgtap.control"

mkdir "$RUNTIME_DIR/socket"
"$RUNTIME_DIR/bin/initdb" -D "$RUNTIME_DIR/data" -A trust -U postgres >/dev/null
"$RUNTIME_DIR/bin/pg_ctl" -D "$RUNTIME_DIR/data" \
  -o "-h 127.0.0.1 -k $RUNTIME_DIR/socket -p $PORT" -w start >/dev/null
DB_URL="postgresql://postgres:postgres@127.0.0.1:$PORT/postgres?sslmode=disable"

query_file() {
  node "$ROOT_DIR/supabase/tests/support/run-sql-file.mjs" "$DB_URL" "$1"
}

apply_security_migrations() {
  echo "APPLY_EXACT=20260902163716_sec_training_rpc_resource_bounds.sql"
  query_file "$ROOT_DIR/supabase/migrations/20260902163716_sec_training_rpc_resource_bounds.sql" >/dev/null
  echo "APPLY_EXACT=20260902183335_sec_training_integer_cast_fix.sql"
  query_file "$ROOT_DIR/supabase/migrations/20260902183335_sec_training_integer_cast_fix.sql" >/dev/null
}

echo "MIGRATION_ORDER=$SECURITY_ORDER"
query_file "$ROOT_DIR/supabase/tests/support/cycle_active_replacement_embedded_bootstrap.sql"
# Load the real legacy RPC whose existing signature is re-granted by SEC-TRAIN.
# Extract its complete definition from the historical migration, not a stub.
awk '/^create or replace function public[.]create_training_cycle_with_plan\(/,/^\$\$;/' \
  "$ROOT_DIR/supabase/migrations/20260610000001_training_exercise_lineage.sql" \
  > "$RUNTIME_DIR/legacy-create-cycle.sql"
test "$(grep -Ec '^create or replace function ' "$RUNTIME_DIR/legacy-create-cycle.sql")" = "1"
test "$(tail -1 "$RUNTIME_DIR/legacy-create-cycle.sql")" = '$$;'
echo "APPLY_BASELINE=create_training_cycle_with_plan (20260610000001)"
query_file "$RUNTIME_DIR/legacy-create-cycle.sql" >/dev/null
if test "$SECURITY_ORDER" = "prod-upgrade"; then apply_security_migrations; fi
echo "APPLY_EXACT=20260829200846_cycle_redesign_schema.sql"
query_file "$ROOT_DIR/supabase/migrations/20260829200846_cycle_redesign_schema.sql" >/dev/null
echo "APPLY_EXACT=20260829200847_cycle_redesign_api.sql"
query_file "$ROOT_DIR/supabase/migrations/20260829200847_cycle_redesign_api.sql" >/dev/null
if test "$SECURITY_ORDER" = "qa-upgrade"; then apply_security_migrations; fi
echo "APPLY_EXACT=20260831213114_cycle_active_replacement.sql"
query_file "$ROOT_DIR/supabase/migrations/20260831213114_cycle_active_replacement.sql" >/dev/null
echo "APPLY_EXACT=20260831230440_cycle_active_atomic_replacement.sql"
query_file "$ROOT_DIR/supabase/migrations/20260831230440_cycle_active_atomic_replacement.sql" >/dev/null
echo "APPLY_EXACT=20260831233757_cycle_active_replacement_snapshot_response.sql"
query_file "$ROOT_DIR/supabase/migrations/20260831233757_cycle_active_replacement_snapshot_response.sql" >/dev/null
echo "APPLY_EXACT=20260901002250_cycle_active_replacement_exercise_descriptors.sql"
query_file "$ROOT_DIR/supabase/migrations/20260901002250_cycle_active_replacement_exercise_descriptors.sql" >/dev/null
if test "$SECURITY_ORDER" = "chronological"; then apply_security_migrations; fi
echo "SEED_HISTORICAL=cycle_legacy_youtube_backfill_fixture.sql"
query_file "$ROOT_DIR/supabase/tests/support/cycle_legacy_youtube_backfill_fixture.sql" >/dev/null
echo "APPLY_EXACT=20260905201420_cycle_legacy_compatibility_expiry_youtube.sql"
query_file "$ROOT_DIR/supabase/migrations/20260905201420_cycle_legacy_compatibility_expiry_youtube.sql" >/dev/null
echo "APPLY_SUPPORT=pgtap-1.3.4"
printf '%s\n' 'create extension pgtap with schema extensions;' > "$RUNTIME_DIR/create-pgtap.sql"
query_file "$RUNTIME_DIR/create-pgtap.sql" >/dev/null
echo "RUN_PGTAP=20260831213114_cycle_active_replacement_test.sql"
PGTAP_OUTPUT=$(query_file "$ROOT_DIR/supabase/tests/20260831213114_cycle_active_replacement_test.sql")
printf '%s\n' "$PGTAP_OUTPUT"
if printf '%s\n' "$PGTAP_OUTPUT" | grep -Eq '^(not ok|Bail out!)'; then
  echo "EMBEDDED_POSTGRES_ACTIVE_REPLACEMENT=FAIL" >&2
  exit 1
fi
printf '%s\n' "$PGTAP_OUTPUT" | grep -Fq '1..25'
test "$(printf '%s\n' "$PGTAP_OUTPUT" | grep -Ec '^ok [0-9]+')" = "25"
echo "EMBEDDED_POSTGRES_ACTIVE_REPLACEMENT=PASS"
echo "RUN_PGTAP=20260905201420_cycle_legacy_compatibility_expiry_youtube_test.sql"
LEGACY_OUTPUT=$(query_file "$ROOT_DIR/supabase/tests/20260905201420_cycle_legacy_compatibility_expiry_youtube_test.sql")
printf '%s\n' "$LEGACY_OUTPUT"
if printf '%s\n' "$LEGACY_OUTPUT" | grep -Eq '^(not ok|Bail out!)'; then
  echo "EMBEDDED_POSTGRES_LEGACY_COMPATIBILITY=FAIL" >&2
  exit 1
fi
printf '%s\n' "$LEGACY_OUTPUT" | grep -Fq '1..42'
test "$(printf '%s\n' "$LEGACY_OUTPUT" | grep -Ec '^ok [0-9]+')" = "42"
echo "EMBEDDED_POSTGRES_LEGACY_COMPATIBILITY=PASS"
echo "RUN_PGTAP=20260905201420_cycle_dispatch_authorization_test.sql"
DISPATCH_OUTPUT=$(query_file "$ROOT_DIR/supabase/tests/20260905201420_cycle_dispatch_authorization_test.sql")
printf '%s\n' "$DISPATCH_OUTPUT"
if printf '%s\n' "$DISPATCH_OUTPUT" | grep -Eq '^(not ok|Bail out!)'; then
  echo "EMBEDDED_POSTGRES_DISPATCH_AUTHORIZATION=FAIL" >&2
  exit 1
fi
printf '%s\n' "$DISPATCH_OUTPUT" | grep -Fq '1..28'
test "$(printf '%s\n' "$DISPATCH_OUTPUT" | grep -Ec '^ok [0-9]+')" = "28"
echo "EMBEDDED_POSTGRES_DISPATCH_AUTHORIZATION=PASS"
