# Build stage
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache curl build-base python3 vips-dev bash

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash \
    && ln -s /root/.bun/bin/bun /usr/local/bin/bun

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install

# Copy project files
COPY . .

# Build TypeScript
RUN bun run tsc

# Copy markdown prompt files to dist
RUN mkdir -p dist/app/commands/prompts && \
    cp src/app/commands/prompts/*.md dist/app/commands/prompts/ || true

# Production stage
FROM node:20-alpine

# Install runtime dependencies only
RUN apk add --no-cache vips-dev ffmpeg python3 py3-pip curl ca-certificates aria2

# Install yt-dlp with default dependencies
RUN python3 -m venv /opt/yt-dlp-venv \
    && /opt/yt-dlp-venv/bin/pip install -U --pre --no-cache-dir "yt-dlp[default,curl-cffi]" \
    && ln -s /opt/yt-dlp-venv/bin/yt-dlp /usr/local/bin/yt-dlp \
    && /opt/yt-dlp-venv/bin/pip install -U --no-cache-dir yt-dlp-ejs \
    && ln -s /opt/yt-dlp-venv/bin/yt-dlp-ejs /usr/local/bin/yt-dlp-ejs

WORKDIR /app

# Copy built files and dependencies from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Set environment variables
ENV NODE_ENV=production

# Start the application using Node.js
CMD ["node", "dist/index.js"]
