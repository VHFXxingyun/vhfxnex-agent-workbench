FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS production-dependencies
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/scripts/next.mjs ./scripts/next.mjs
COPY --from=builder /app/scripts/process-supervisor.mjs ./scripts/process-supervisor.mjs
COPY --from=builder /app/scripts/workbench-worker.mjs ./scripts/workbench-worker.mjs

RUN mkdir -p /app/data /app/.next/cache \
    && chown -R node:node /app/data /app/.next

USER node
EXPOSE 3000
CMD ["node", "scripts/next.mjs", "start", "--hostname", "0.0.0.0", "--port", "3000"]
