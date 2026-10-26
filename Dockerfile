# syntax=docker/dockerfile:1
# One image for the three Railway services (web, worker, collab); each service picks its process
# with its start command. See docs/deploy.md and D-042.

FROM node:24-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Dependencies first, so source changes reuse this layer.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# next build (standalone output) and the esbuild bundles for worker, collab, migrate and seed.
FROM deps AS build
COPY . .
RUN npm run build

# Runtime: no source and no dev dependencies; only Next's traced node_modules. The base image
# ships npm, but nothing here runs it.
FROM base AS runtime
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/data/standards ./data/standards
# Next.js writes its cache under .next; everything else stays read-only for the app user.
RUN chown -R node:node .next
USER node
EXPOSE 3000

# web. The worker runs `node dist/worker/main.mjs`, collab `node dist/collab/main.mjs`,
# migrations `node dist/db/migrate_cli.mjs` and the seed `node dist/db/seed/seed_cli.mjs`.
CMD ["node", "server.js"]
