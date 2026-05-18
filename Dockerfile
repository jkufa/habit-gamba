FROM oven/bun:1.3.8-slim AS runtime

WORKDIR /app

COPY package.json bun.lock turbo.json tsconfig.base.json .oxlintrc.json .oxfmtrc.json ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile
RUN bun run build

ENV NODE_ENV=production
CMD ["bun", "--filter", "@habit-gamba/server", "start"]
