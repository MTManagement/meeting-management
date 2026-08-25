#!/bin/bash
set -euo pipefail

git config --global --add safe.directory /volume1/docker/mtmanagement/repo

REPO_DIR="${REPO_DIR:-/volume1/docker/mtmanagement/repo}"
SERVER_DIR="${SERVER_DIR:-/volume1/docker/mtmanagement/server}"
GITEA_HOST="${GITEA_HOST:-git.snaphy.co.kr}"
REPO_SLUG="${REPO_SLUG:-MTManagement/meeting-management}"
BRANCH="${BRANCH:-main}"

# 인증: GITEA_TOKEN(권장) 또는 GITEA_USERNAME+GITEA_PASSWORD, 둘 다 없으면 익명(공개 저장소용)
if [ -n "${GITEA_TOKEN:-}" ]; then
  REPO_URL="https://${GITEA_TOKEN}@${GITEA_HOST}/${REPO_SLUG}.git"
elif [ -n "${GITEA_USERNAME:-}" ] && [ -n "${GITEA_PASSWORD:-}" ]; then
  REPO_URL="https://${GITEA_USERNAME}:${GITEA_PASSWORD}@${GITEA_HOST}/${REPO_SLUG}.git"
else
  REPO_URL="https://${GITEA_HOST}/${REPO_SLUG}.git"
fi

log() { echo "[deploy $(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "배포 시작 (branch=$BRANCH, repo=$GITEA_HOST/$REPO_SLUG)"
if [ -n "${GITEA_TOKEN:-}" ]; then
  log "인증: GITEA_TOKEN 사용 (길이 ${#GITEA_TOKEN}자)"
elif [ -n "${GITEA_USERNAME:-}" ] && [ -n "${GITEA_PASSWORD:-}" ]; then
  log "인증: GITEA_USERNAME/GITEA_PASSWORD 사용 (user=$GITEA_USERNAME)"
else
  log "인증: 없음 (익명 접근 - private 저장소면 여기서 실패함)"
fi

if [ ! -d "$REPO_DIR/.git" ]; then
  log "저장소 최초 clone"
  git clone --branch "$BRANCH" "$REPO_URL" "$REPO_DIR"
else
  log "저장소 pull"
  cd "$REPO_DIR"
  git remote set-url origin "$REPO_URL"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git reset --hard "origin/$BRANCH"
fi

log "rsync: repo -> server (.git, node_modules, .next, .env, server-control 제외)"
mkdir -p "$SERVER_DIR"
rsync -a --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude ".next" \
  --exclude ".env" \
  --exclude "server-control" \
  "$REPO_DIR/" "$SERVER_DIR/"

if [ ! -f "$SERVER_DIR/.env" ]; then
  log "오류: $SERVER_DIR/.env 파일이 없습니다. DATABASE_URL 등을 설정한 .env를 먼저 만들어주세요."
  exit 1
fi

log "기존 컨테이너/이미지 정리"
docker rm -f mtmanagement-server >/dev/null 2>&1 || true
docker rmi mtmanagement-server:latest >/dev/null 2>&1 || true

cd "$SERVER_DIR"

log "docker-compose build"
docker-compose build

log "docker-compose up -d"
docker-compose up -d

log "배포 완료"
