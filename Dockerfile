FROM node:20-alpine AS base

# ---- deps: 의존성 설치 ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ---- builder: Prisma generate(코드 생성만, DB 접속 없음) + Next.js build ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# ---- runner: standalone 산출물 + DB 동기화용 entrypoint ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# standalone 산출물의 node_modules는 트레이싱된 최소 구성이라 prisma CLI가
# 빠져 있음. entrypoint에서 "prisma db push"를 실행할 수 있도록 deps 단계의
# 전체 node_modules(및 schema)를 덧씌운다 - 이미지 크기보다 안정성 우선.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# DATABASE_URL은 빌드 시점이 아니라 컨테이너 실행 시점에만 필요
# (Neon 등 서버리스 DB가 슬립 상태여도 이미지 빌드는 항상 성공함)
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
