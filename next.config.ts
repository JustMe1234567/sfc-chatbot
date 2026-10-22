import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The widget iframe is embedded cross-origin from a college-site origin,
  // and local checks load the app via 127.0.0.1 while the dev server is
  // started on localhost; allow the loopback host so dev client resources
  // (HMR) are not blocked in that setup.
  allowedDevOrigins: ["127.0.0.1"],

  // The widget loader is a versioned public asset committed at
  // public/widget/v1.js; it must stay a stable, cacheable URL for WordPress
  // embeds, so it is built by `npm run build:widget` rather than bundled.
};

export default nextConfig;
