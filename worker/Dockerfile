# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the AllianceAnalytics Reel render worker.
#
# why bookworm-slim and not alpine: Day 2 adds ffmpeg + Playwright /
# headless Chromium, both of which ship glibc-based prebuilt binaries
# and have well-known footguns on Alpine's musl libc. Choosing Debian
# now saves a refactor next session.
#
# why multi-stage: keeps the runtime image small. The build stage has
# the TypeScript compiler + dev deps; the runtime stage has only what
# `node dist/server.js` actually needs.
#
# Image tag pinning: use the exact node:22-bookworm-slim digest in CI
# when we ship a real release pipeline. Day 1 the floating tag is OK.

# ---------- Stage 1: build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install deps first so layer cache survives source-only changes.
COPY package.json package-lock.json* ./
# why npm ci falls back to npm install: package-lock.json may not exist
# on the very first `docker build` before anyone runs `npm install`
# locally. Once a lockfile exists, `npm ci` is faster and reproducible.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- Stage 2: runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# why ENV NODE_ENV=production: Express enables some prod-only fast-paths
# (view cache etc.) under this flag, and any future dep that branches
# on it gets the leaner code path.
ENV NODE_ENV=production
ENV PORT=8080

# Pull in only the compiled output + production node_modules from the
# build stage. We re-install with --omit=dev to drop tsx/typescript and
# their transitive deps, shrinking the final image considerably.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY --from=build /app/dist ./dist

# why curl in runtime: HEALTHCHECK needs a real HTTP client. wget is
# present in slim images too but curl is the universal default and is
# only ~1 MB. Install + clean up apt cache in one layer.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

EXPOSE 8080

# why HEALTHCHECK on a relative URL: the worker only ever binds 8080
# inside the container; the public hostname is Fly's concern. The
# 30s/3s/3 retry shape is the Docker default — generous enough to
# tolerate brief GC pauses, strict enough to catch a real hang.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl --fail --silent --show-error http://localhost:8080/health || exit 1

CMD ["node", "dist/server.js"]
