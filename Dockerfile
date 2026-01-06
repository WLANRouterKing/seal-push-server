# Build stage
FROM oven/bun:1 AS builder
WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

COPY . .

# Production stage
FROM oven/bun:1-slim AS runner
WORKDIR /app

# Create non-root user
RUN groupadd --system --gid 1001 seal && \
    useradd --system --uid 1001 --gid seal --no-create-home seal

COPY --from=builder --chown=seal:seal /app/node_modules ./node_modules
COPY --from=builder --chown=seal:seal /app/src ./src
COPY --from=builder --chown=seal:seal /app/package.json ./

# Create data directory with correct permissions
RUN mkdir -p /app/data && chown seal:seal /app/data

USER seal

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

CMD ["bun", "run", "src/index.ts"]