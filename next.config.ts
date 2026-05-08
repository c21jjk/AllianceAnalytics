import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to this project so Next.js doesn't get confused by stray
  // package-lock.json files higher up the tree (e.g., in $HOME).
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
