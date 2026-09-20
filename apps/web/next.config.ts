import type { NextConfig } from "next";
import { resolve } from "node:path";

/**
 * Minimal framework configuration for the scaffold.
 * Product-specific caching, security headers, and image hosts are added with
 * the implementation slice that owns them.
 */
const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: resolve(__dirname, "../.."),
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@chairly/domain", "@chairly/shared"],
  turbopack: {
    root: resolve(__dirname, "../.."),
  },
};

export default nextConfig;
