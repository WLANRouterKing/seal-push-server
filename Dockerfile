# Build stage
FROM oven/bun:1 AS builder
WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

COPY . .

# Production stage
FROM oven/bun:1-slim AS runner
WORKDIR /app

# Create non-root user (UID/GID 1000 = default first user on Linux hosts)
RUN useradd --system --uid 1000 --gid 1000 --no-create-home seal || true

COPY --from=builder --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=builder --chown=1000:1000 /app/src ./src
COPY --from=builder --chown=1000:1000 /app/package.json ./

# Create data directory with correct permissions
RUN mkdir -p /app/data && chown 1000:1000 /app/data

USER 1000

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

CMD ["bun", "run", "src/index.ts"]