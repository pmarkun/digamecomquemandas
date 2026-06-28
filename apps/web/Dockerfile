FROM node:22-alpine

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate && pnpm install --filter ./apps/web

COPY apps/web ./apps/web

WORKDIR /app/apps/web
RUN pnpm build

EXPOSE 3000
CMD ["sh", "-c", "pnpm exec next start -p ${PORT:-3000}"]
