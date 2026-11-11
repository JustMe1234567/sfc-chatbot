import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { trustedOrigins } from "../src/config";

/**
 * Ticket 21: response-header guards against clickjacking. The suite has no
 * HTTP-server harness, so this pins the next.config headers() contract —
 * the build-level surface the deployed server serves from.
 */
describe("frame-ancestors embed guards (ticket 21)", () => {
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

  it("keeps the widget frame embeddable from the trusted origins, never DENY", async () => {
    const route = await headerRoute("/widget/frame");
    // The configured CORS trust list (src/config) names the origins the
    // widget is embedded from, instead of the dashboard's 'self' lock.
    const ancestors = headerValue(route, "Content-Security-Policy");
    expect(ancestors).toMatch(/^frame-ancestors /);
    for (const origin of trustedOrigins()) {
      expect(ancestors).toContain(new URL(origin).origin);
    }
    // Older browsers treat X-Frame-Options before CSP, so the embeddable
    // frame must not carry DENY in any form.
    expect(route.headers.some((entry) => entry.key === "X-Frame-Options")).toBe(
      false,
    );
  });
});
