# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app/backoffice
COPY backoffice/package*.json ./
RUN npm ci
COPY backoffice ./
COPY app/live-poll.mjs /app/app/live-poll.mjs
COPY public/app-icon-192.png public/og.png /app/public/
RUN npm run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates gosu tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backoffice
COPY backoffice/package*.json ./
RUN npm ci --omit=dev && mkdir -p /run/clubiq-backoffice
COPY backoffice/*.mjs ./
COPY backoffice/migrations ./migrations
COPY app/monthly-cash-manager-report.ts /app/app/monthly-cash-manager-report.ts
COPY backoffice/entrypoint.sh /usr/local/bin/clubiq-backoffice-entrypoint
COPY --from=build /app/backoffice/dist ./dist
RUN chmod 0755 /usr/local/bin/clubiq-backoffice-entrypoint
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8092
EXPOSE 8092
ENTRYPOINT ["/usr/bin/tini","--","/usr/local/bin/clubiq-backoffice-entrypoint"]
CMD ["node","--experimental-strip-types","server.mjs"]
