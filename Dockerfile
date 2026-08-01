# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM --platform=$BUILDPLATFORM dependencies AS builder
COPY . .
ENV NODE_ENV=production \
    VEREINSKASSE_RUNTIME=raspberry
RUN npm run build:raspberry

FROM --platform=$TARGETPLATFORM node:22-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

FROM node:22-bookworm-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/RianFlow/vereinskasse" \
      org.opencontainers.image.title="Clubiq Ledger" \
      org.opencontainers.image.description="Vereinskasse für Raspberry Pi und PostgreSQL"

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl gnupg \
    && install -d -m 0755 /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install --yes --no-install-recommends \
      gosu jq postgresql-client-17 restic tini \
    && apt-get purge --auto-remove --yes gnupg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/vinext ./node_modules/vinext
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/postgres ./postgres
COPY --from=builder /app/raspberry ./raspberry
COPY --from=builder /app/deploy/docker ./deploy/docker
COPY --from=builder /app/deploy/raspberry/backup.sh ./deploy/raspberry/backup.sh

RUN mkdir -p /data/objects /backups/local /var/cache/restic \
    && chown -R node:node /data /app /var/cache/restic \
    && chmod 0755 /app/deploy/docker/*.sh /app/deploy/docker/clubiq

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    VEREINSKASSE_APP_DIR=/app \
    VEREINSKASSE_DATA_DIR=/data \
    VEREINSKASSE_BACKUP_DIR=/data/objects \
    VEREINSKASSE_DATABASE_PROVIDER=postgres

EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "/app/deploy/docker/app-entrypoint.sh"]
