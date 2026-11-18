import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The widget iframe is embedded cross-origin from a college-site origin,
  // and local checks load the app via 127.0.0.1 while the dev server is
  // started on localhost; allow the loopback host so dev client resources
  // (HMR) are not blocked in that setup.
  allowedDevOrigins: ["127.0.0.1"],

  // Clickjacking guards (ticket 21): staff dashboard and visitor return
  // pages have no reason to be framed, so they lock to 'self' (plus
  // X-Frame-Options DENY for older browsers).
  //
  // The widget frame is NOT listed here (ticket 76): its frame-ancestors
  // policy is the owner-managed embed allowlist, which must track saves
  // immediately, so src/proxy.ts computes it per request from the stored
  // setting instead of a build-time header.
  async headers() {
    const selfOnly = [
      { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
      { key: "X-Frame-Options", value: "DENY" },
    ];
    return [
      {
        source: "/dashboard/:path*",
        headers: selfOnly,
      },
      {
        source: "/return",
        headers: selfOnly,
      },
    ];
  },

  // The widget loader is a versioned public asset committed at
  // public/widget/v1.js; it must stay a stable, cacheable URL for WordPress
  // embeds, so it is built by `npm run build:widget` rather than bundled.
};

export default nextConfig;
