# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14-alpine AS deps
RUN apk add --no-cache bash curl build-base python3 vips-dev
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.14-alpine AS runtime
RUN apk add --no-cache vips-dev ffmpeg python3 py3-pip curl ca-certificates aria2 fontconfig font-dejavu
RUN python3 -m venv /opt/yt-dlp-venv \
    && /opt/yt-dlp-venv/bin/pip install -U --pre --no-cache-dir "yt-dlp[default,curl-cffi]" \
    && ln -s /opt/yt-dlp-venv/bin/yt-dlp /usr/local/bin/yt-dlp \
    && /opt/yt-dlp-venv/bin/pip install -U --no-cache-dir yt-dlp-ejs \
    && ln -s /opt/yt-dlp-venv/bin/yt-dlp-ejs /usr/local/bin/yt-dlp-ejs
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
# Copies src (TypeScript + prompt .md files), package.json, bun.lock and the
# optional cookies.txt the release workflow creates. .dockerignore keeps the
# image free of tests, docs, dist, tooling config and local junk.
COPY . .
ENV NODE_ENV=production
EXPOSE 5000
CMD ["bun", "src/index.ts"]
