FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
ENV ONNXRUNTIME_NODE_INSTALL=skip
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM dependencies AS production-dependencies
ENV NODE_ENV=production
RUN npm prune --omit=dev --no-audit --no-fund

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
COPY --from=builder /app/src/lib/database-path.mjs ./src/lib/database-path.mjs
COPY --from=builder /app/src/lib/workbench-retry.mjs ./src/lib/workbench-retry.mjs

RUN mkdir -p /app/data /app/.next/cache \
    && chown -R node:node /app/data /app/.next

USER node
EXPOSE 3000
CMD ["node", "scripts/next.mjs", "start", "--hostname", "0.0.0.0", "--port", "3000"]
