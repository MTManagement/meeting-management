#!/bin/sh
set -e

echo "[debug] DATABASE_URL length: ${#DATABASE_URL}"
echo "[debug] DATABASE_URL prefix: $(echo "$DATABASE_URL" | cut -c1-20)..."
echo "[debug] cwd: $(pwd), prisma.config.ts exists: $([ -f ./prisma.config.ts ] && echo yes || echo no)"

echo "[entrypoint] prisma db push (DB 스키마 동기화)"
node node_modules/prisma/build/index.js db push --accept-data-loss

echo "[entrypoint] starting server"
exec "$@"
