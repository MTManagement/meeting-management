#!/bin/sh
set -e

echo "[debug] DATABASE_URL length: ${#DATABASE_URL}"
echo "[debug] DATABASE_URL prefix: $(echo "$DATABASE_URL" | cut -c1-20)..."
echo "[debug] cwd: $(pwd), prisma.config.ts exists: $([ -f ./prisma.config.ts ] && echo yes || echo no)"

echo "[entrypoint] prisma db push (DB 스키마 동기화)"

# Neon 등 서버리스 DB가 슬립 상태일 때 첫 접속이 실패할 수 있어 재시도한다.
# 무한 재시도는 하지 않음 - 실제 설정 문제일 수도 있으므로 정해진 횟수만 시도.
MAX_ATTEMPTS=5
RETRY_DELAY=5
attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  echo "[entrypoint] db push 시도 $attempt/$MAX_ATTEMPTS..."
  if node node_modules/prisma/build/index.js db push --accept-data-loss; then
    echo "[entrypoint] db push 성공"
    break
  fi

  if [ "$attempt" -eq "$MAX_ATTEMPTS" ]; then
    echo "[entrypoint] db push $MAX_ATTEMPTS회 모두 실패, 종료합니다."
    exit 1
  fi

  echo "[entrypoint] db push 실패, ${RETRY_DELAY}초 후 재시도..."
  sleep "$RETRY_DELAY"
  attempt=$((attempt + 1))
done

echo "[entrypoint] starting server"
exec "$@"
