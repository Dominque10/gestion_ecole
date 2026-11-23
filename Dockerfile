# syntax=docker/dockerfile:1
# Images de production (mise en service, sous-étape Sa) :
#   --target app     → l'application Next.js (aussi utilisée pour les migrations et les scripts)
#   --target worker  → le worker des tâches de fond, avec Chromium pour les PDF
# Construites et vérifiées par la CI (job « docker »).

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@12.11.2 && npm cache clean --force
WORKDIR /app

# --- Dépendances (couche en cache tant que le fichier de verrouillage ne change pas) ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# --- Construction ---
FROM deps AS build
COPY . .
RUN pnpm build && pnpm prune --prod

# --- Application ---
FROM base AS app
ENV NODE_ENV=production \
    PORT=3000 \
    STORAGE_DIR=/app/storage
COPY --from=build --chown=node:node /app/package.json /app/next.config.ts /app/tsconfig.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/drizzle ./drizzle
# Dossier des fichiers envoyés : appartient à « node » pour que le volume monté ici en hérite.
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]

# --- Worker : même code, plus Chromium et ses bibliothèques système ---
FROM app AS worker
USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN node_modules/.bin/playwright-core install --with-deps chromium \
    && chmod -R a+rX /ms-playwright \
    && rm -rf /var/lib/apt/lists/*
USER node
CMD ["node", "--import", "tsx", "--conditions=react-server", "src/worker/index.ts"]
