import type { NextConfig } from "next";

/**
 * Static export for GitHub Pages: no Node server, the browser talks to Supabase directly
 * (data protected by RLS). NEXT_PUBLIC_BASE_PATH is the repository path on Pages
 * (e.g. "/finance-plan"); empty locally.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
