import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to this project so Next.js doesn't get confused by stray
  // package-lock.json files higher up the tree (e.g., in $HOME).
  outputFileTracingRoot: path.join(__dirname),
  // Tell Next.js NOT to bundle these — the Post Builder render route
  // requires the full puppeteer-core + @sparticuz/chromium-min packages
  // straight from node_modules at runtime so the chromium binary launcher
  // can locate its companion shared libraries (libnss3.so, etc).
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium-min"],
  experimental: {
    // why: Server Actions default to a 1MB request-body cap. Template/post
    // saves carry a schema JSON plus an inline preview image, which can edge
    // past 1MB. Previews are downscaled client-side, but raise the ceiling so
    // a large schema or preview degrades gracefully instead of failing the
    // whole action with an opaque "Server Components render" error.
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
