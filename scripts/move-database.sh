#!/usr/bin/env bash
# Copies the WHOLE database from OLD_DATABASE_URL into an EMPTY NEW_DATABASE_URL (the move of the
# production database next to the API server: N. Virginia → Frankfurt). Run by the workflow
# «Перенос базы данных»; never prints a connection string.
#
# Safe to repeat: the source is only read; the target is refused unless it is empty; the restore is one
# transaction, so a failure leaves the target empty again. Every table's row count is compared at the end.
set -euo pipefail

# The repository is public and so are its workflow logs: hide database hosts in anything printed.
exec > >(sed -u -E 's#postgres(ql)?://[^ ]+#[адрес скрыт]#g; s#[a-z0-9.-]+\.neon\.tech#[адрес скрыт]#g') 2>&1

fail() { echo "ОШИБКА: $1"; exit 1; }

[ -n "${OLD_DATABASE_URL:-}" ] || fail "не задан секрет OLD_DATABASE_URL (старая база)"
[ -n "${NEW_DATABASE_URL:-}" ] || fail "не задан секрет NEW_DATABASE_URL (новая база)"
[ "$OLD_DATABASE_URL" != "$NEW_DATABASE_URL" ] || fail "старая и новая база — один и тот же адрес"

# pg_dump needs a direct connection, not Neon's pooled one.
OLD="${OLD_DATABASE_URL/-pooler./.}"
NEW="${NEW_DATABASE_URL/-pooler./.}"

sql() { psql "$1" -v ON_ERROR_STOP=1 -X -q -A -t -c "$2"; }

TABLES="select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'"
COUNTS="select table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
        from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name"

echo "1/5 Проверяю старую базу…"
[ "$(sql "$OLD" "select count(*) from information_schema.tables where table_schema = 'public' and table_name = '_prisma_migrations'")" = "1" ] \
  || fail "в OLD_DATABASE_URL нет базы ArAmir OS — секреты перепутаны местами? Ничего не изменено."

echo "2/5 Проверяю, что новая база пустая…"
[ "$(sql "$NEW" "$TABLES")" = "0" ] \
  || fail "новая база не пустая — в неё уже что-то записано. Ничего не изменено. Создайте чистую базу."

echo "3/5 Снимаю копию старой базы…"
DUMP="$(mktemp)"
trap 'rm -f "$DUMP"' EXIT
pg_dump "$OLD" --format=custom --no-owner --no-acl --file="$DUMP"

echo "4/5 Записываю копию в новую базу…"
pg_restore --dbname="$NEW" --no-owner --no-acl --single-transaction --exit-on-error "$DUMP"

echo "5/5 Сверяю число строк в каждой таблице…"
OLD_COUNTS="$(sql "$OLD" "$COUNTS")"
NEW_COUNTS="$(sql "$NEW" "$COUNTS")"
if [ "$OLD_COUNTS" != "$NEW_COUNTS" ]; then
  # Table names only — never the figures (public log).
  diff <(echo "$OLD_COUNTS") <(echo "$NEW_COUNTS") | grep '^[<>]' | sed -E 's/^[<>] //; s/=.*//' | sort -u | sed 's/^/  расходится таблица: /'
  fail "число строк не совпало — в старую базу что-то записали во время копирования? Новую базу не подключайте."
fi

echo "ГОТОВО: таблиц $(echo "$OLD_COUNTS" | wc -l), число строк совпадает во всех. Новую базу можно подключать."
