import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import nextConfig from "../next.config";
import { repoRoot } from "../src/paths";

/**
 * Ticket 21: response-header guards against clickjacking. The suite has no
 * HTTP-server harness, so this pins the next.config headers() contract —
 * the build-level surface the deployed server serves from.
 *
 * Ticket 76 moved the widget frame's policy off this build-time surface:
 * its frame-ancestors value is now the owner-managed embed allowlist,
 * computed per request in src/proxy.ts, so the config pin below proves the
 * static header is gone (a stale second header would intersect with the
 * dynamic one) and the proxy pins prove where the dynamic decision lives.
 */
describe("frame-ancestors embed guards (tickets 21 and 76)", () => {
  async function headerRoute(source: string) {
    const routes = (await nextConfig.headers?.()) ?? [];
    const route = routes.find((entry) => entry.source === source);
    expect(route, `headers() entry for ${source}`).toBeDefined();
    return route!;
  }

  function headerValue(route: { headers: { key: string; value: string }[] }, key: string) {
    const header = route.headers.find((entry) => entry.key === key);
    expect(header, `${key} on ${route.headers}`).toBeDefined();
    return header!.value;
  }

  it("locks dashboard responses to self-framing only", async () => {
    const route = await headerRoute("/dashboard/:path*");
    expect(headerValue(route, "Content-Security-Policy")).toBe(
      "frame-ancestors 'self'",
    );
    expect(headerValue(route, "X-Frame-Options")).toBe("DENY");
  });

  it("gives the visitor return page the same guard as the dashboard", async () => {
    const route = await headerRoute("/return");
    expect(headerValue(route, "Content-Security-Policy")).toBe(
      "frame-ancestors 'self'",
    );
    expect(headerValue(route, "X-Frame-Options")).toBe("DENY");
  });

  it("leaves the widget frame to the proxy's dynamic allowlist policy, not a build-time header", async () => {
    const routes = (await nextConfig.headers?.()) ?? [];
    // No static frame header may remain: two Content-Security-Policy
    // headers are both enforced (intersection), so a build-time list would
    // silently override the owner's live allowlist.
    expect(routes.find((entry) => entry.source === "/widget/frame")).toBeUndefined();

    const proxy = await readFile(path.join(repoRoot(), "src/proxy.ts"), "utf8");
    // The frame request is matched and guarded before rendering.
    expect(proxy).toContain('"/widget/frame"');
    expect(proxy).toContain("widgetFrameResponse");
    // The decision is the domain's, not ad-hoc string building here.
    expect(proxy).toContain("resolveFrameAncestors");
    expect(proxy).toContain("isStandaloneFrameNavigation");
    expect(proxy).toContain("getEmbedAllowlistOrigins");
    // Production standalone navigation is refused outright.
    expect(proxy).toContain("status: 404");
    // The policy rides the response as its own header, always fresh.
    expect(proxy).toContain('"Content-Security-Policy"');
    expect(proxy).toContain('"Cache-Control", "private, no-store"');
  });
});
