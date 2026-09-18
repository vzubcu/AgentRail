FROM node:22-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts --config.minimum-release-age=0

COPY tsconfig.json ./
COPY vite.config.mjs ./
COPY knexfile.cjs ./
COPY migrations ./migrations
COPY src ./src
COPY scripts ./scripts

RUN pnpm --config.minimum-release-age=0 run build

ENV PORT=42424
ENV HOST=0.0.0.0
ENV AGENTRAIL_SAAS=1

EXPOSE 42424

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
