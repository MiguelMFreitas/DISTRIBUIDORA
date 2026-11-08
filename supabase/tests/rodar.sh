#!/usr/bin/env bash
# Roda os testes do banco num Postgres local (porta 5433). Uso: bash supabase/tests/rodar.sh
set -e
cd "$(dirname "$0")/.."
P="psql -h ${PGHOST:-/var/tmp} -p ${PGPORT:-5433} -U postgres -q"
$P -c "drop database if exists teste" 2>/dev/null
$P -c "create database teste"
$P -d teste -v ON_ERROR_STOP=1 -f tests/stub_supabase.sql $(ls migrations/*.sql | sed 's/^/-f /') >/dev/null
$P -d teste -f tests/testes.sql 2>&1 >/dev/null | sed 's/^psql:[^ ]* NOTICE:  //'
