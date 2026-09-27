FROM node:20-alpine

# docker-cli: 호스트 도커 소켓을 통해 다른 컨테이너 제어
# git, rsync, bash: deploy.sh 실행에 필요
# curl: docker-compose 바이너리 설치용 (설치 후에도 컨테이너 정리 용도로 유지)
RUN apk add --no-cache docker-cli git rsync bash openssl curl \
  && curl -SL https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-x86_64 \
     -o /usr/local/bin/docker-compose \
  && chmod +x /usr/local/bin/docker-compose

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY deploy.sh ./
COPY public ./public
RUN chmod +x deploy.sh

EXPOSE 3102
CMD ["node", "server.js"]
