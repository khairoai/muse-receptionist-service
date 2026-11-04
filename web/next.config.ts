import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Static files only (web/out): the repo's demo server (src/demo/server.ts) serves them next to the call's WebSocket,
// so the page has no server of its own and no credentials.
const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  // This repo's root (its own pnpm workspace), not a parent folder's
  turbopack: { root: fileURLToPath(new URL("..", import.meta.url)) },
};

export default nextConfig;
