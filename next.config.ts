import type { NextConfig } from "next";
import { trustedOrigins } from "./src/config";

/**
 * The frame-ancestors list for /widget/frame (ticket 21): the CORS trust
 * list from src/config — the configured chatbot origin itself plus, outside
 * production, both loopback spellings the local embed checks use. The
 * widget must stay embeddable from those origins, so it names them
 * explicitly instead of locking to 'self' and never gets X-Frame-Options.
 */
function widgetFrameAncestors(): string {
  return trustedOrigins()
    .map((origin) => new URL(origin).origin)
    .join(" ");
}

const nextConfig: NextConfig = {
  // The widget iframe is embedded cross-origin from a college-site origin,
  // and local checks load the app via 127.0.0.1 while the dev server is
  // started on localhost; allow the loopback host so dev client resources
  // (HMR) are not blocked in that setup.
  allowedDevOrigins: ["127.0.0.1"],

  // Clickjacking guards (ticket 21): staff dashboard and visitor return
  // pages have no reason to be framed, so they lock to 'self' (plus
  // X-Frame-Options DENY for older browsers). The widget frame is the one
  // surface that must remain cross-origin embeddable.
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
      {
        source: "/widget/frame",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${widgetFrameAncestors()}`,
          },
        ],
      },
    ];
  },

  // The widget loader is a versioned public asset committed at
  // public/widget/v1.js; it must stay a stable, cacheable URL for WordPress
  // embeds, so it is built by `npm run build:widget` rather than bundled.
};

export default nextConfig;
