import type { NextConfig } from "next";

/**
 * Minimal framework configuration for the scaffold.
 * Product-specific caching, security headers, and image hosts are added with
 * the implementation slice that owns them.
 */
const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    "@chairly/database",
    "@chairly/domain",
    "@chairly/shared",
  ],
};

export default nextConfig;
