import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // A second dev server (e.g. a fixtures-only demo) needs its own build folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Routes that existed before the case workspace; keep old links working.
  async redirects() {
    return [
      { source: "/review/:id", destination: "/case/:id?tab=review", permanent: false },
      { source: "/report/:id", destination: "/case/:id?tab=report", permanent: false },
      {
        source: "/case/:id/shortlist",
        destination: "/case/:id?tab=findings&curated=1",
        permanent: false,
      },
      {
        source: "/case/:id/investigate/:fid",
        destination: "/case/:id?tab=findings&finding=:fid",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
