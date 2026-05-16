# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the AllianceAnalytics Reel render worker.
#
# Day 2 update (2026-05-16): runtime stage now uses Microsoft's official
# Playwright image which ships Chromium + every system dep Playwright
# needs (libnss3, libatk-bridge, libxcomposite, the works). Without it,
# we'd be hunting `apt-get install` flags for two hours. The build stage
# stays on node:22-bookworm-slim — it doesn't need Chromium, just tsc.
#
# why we kept the multi-stage shape: build artifacts are isolated from
# the Playwright base image's larger surface area. The final image is
# ~2.5 GB which is large but Fly.io VMs handle it fine and the alternative
# (installing Chromium ourselves) is fragile.
#
# why bookworm-slim and not alpine on build: glibc lines up cleanly with
# the Playwright base, and the build deps (typescript/tsx) are 1MB total
# in either base. Saves a `musl-dev` quirk later.

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
COPY render-page ./render-page
RUN npm run build

# ---------- Stage 2: runtime ----------
# why mcr.microsoft.com/playwright:v1.48.0-jammy: this image ships
# Chromium + every system dep Playwright requires. Pinning to v1.48.0
# matches the playwright npm package version in package.json — when we
# bump the npm dep, bump this tag in lockstep. Mismatched versions cause
# subtle "browser unexpectedly closed" errors.
FROM mcr.microsoft.com/playwright:v1.48.0-jammy AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
# why PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: the base image already has the
# browser binaries. Without this, `npm install` would try to re-download
# them and fail (the base image's NPM cache is read-only).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# why PLAYWRIGHT_BROWSERS_PATH: tell Playwright where to find the
# pre-installed browsers in the base image. /ms-playwright is the
# standard location for the official image.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY --from=build /app/dist ./dist
# why copy the render-page directory into runtime: the frame renderer's
# Playwright instance loads a static HTML page that has Fabric.js + our
# frame-rendering bridge. The page is small (~10 KB total) but it's a
# runtime artifact, not a build output.
COPY --from=build /app/render-page ./render-page

# curl for HEALTHCHECK. The Playwright base image already has it; this is
# a no-op when not installing, fast when it is.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD curl --fail --silent --show-error http://localhost:8080/health || exit 1

CMD ["node", "dist/server.js"]
