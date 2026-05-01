import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  trailingSlash: false,
  // Note: `headers()` does NOT run with `output: 'export'`.
  // Security headers are configured in vercel.json (Task 11).
  images: {
    unoptimized: true, // required for static export
  },
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
