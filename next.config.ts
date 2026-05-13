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
};

export default nextConfig;
