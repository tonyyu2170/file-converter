import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  trailingSlash: false,
  // COOP/COEP are set in two places:
  //   - vercel.json    — production (static export bypasses this file's
  //                      headers() entirely)
  //   - next.config.ts — dev-server only (the conditional spread below)
  // Keep the two aligned. The dev rule is what makes
  // `crossOriginIsolated === true` under `pnpm dev`, which is what lets
  // @ffmpeg/core-mt load locally.
  //
  // The spread (vs. an inside-function guard) is required because Next.js
  // detects the `headers` property statically and warns under
  // `output: "export"` if it exists at all — even if the function would
  // return []. Omitting the key entirely silences the warning.
  ...(process.env.NODE_ENV !== "production" && {
    async headers() {
      return [
        {
          source: "/:path*",
          headers: [
            { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
            { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          ],
        },
      ];
    },
  }),
  images: {
    unoptimized: true, // required for static export
  },
  typedRoutes: true,
};

export default nextConfig;
