#!/bin/sh
set -e

echo "[entrypoint] prisma db push (DB 스키마 동기화)"
node node_modules/prisma/build/index.js db push --accept-data-loss --skip-generate

echo "[entrypoint] starting server"
exec "$@"
