// Postgres-mode files must not multiply at the cluster's connection ceiling.
process.env.PG_POOL_MAX = process.env.PG_POOL_MAX ?? "2";

import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CHATHEAD_DEFAULTS,
  chatheadDerivedSize,
  chatheadFitRequirement,
  chatheadForeground,
  isValidBrandedImage,
  isValidChatheadConfig,
  normalizeHexColor,
  parseBrandingImageDataUrl,
  resolveChatheadConfig,
  sniffImageType,
} from "../src/domain/branding";
import {
  CookieJar,
  enrollTotp,
  provisionStaff,
  signInWithTotp,
} from "./auth-helpers";
import { repoRoot } from "../src/paths";
import { TEST_ORIGIN, useTempDatabase, warmChatbotService } from "./helpers";

beforeAll(async () => {
  // The staff PUTs carry TEST_ORIGIN as their Origin header; the CSRF guard
  // trusts it only when it is the configured base URL (house pattern).
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  useTempDatabase();
  await warmChatbotService();
});

/** The bundled crest doubles as a real, valid PNG upload in these tests. */
async function bundledPngBytes(): Promise<Uint8Array> {
  return new Uint8Array(
    await readFile(path.join(repoRoot(), "public/brand/cropped-SFC-Final-Logo-Single.png")),
  );
}

function pngDataUrl(bytes: Uint8Array, declaredType = "image/png"): string {
  const base64 = Buffer.from(bytes).toString("base64");
  return `data:${declaredType};base64,${base64}`;
}

function svgDataUrl(): string {
  return `data:image/svg+xml;base64,${Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>',
  ).toString("base64")}`;
}

function webPBytes(): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  return bytes;
}

/**
 * Provisions the staff member, enrolls their second factor, and leaves the
 * jar holding a dashboard session (the house provisioning sequence).
 */
async function signInAs(role: "owner" | "staff" | "editor", label: string): Promise<CookieJar> {
  const jar = new CookieJar();
  const email = `${label}-${role}@example.edu`;
  await provisionStaff({ email, password: "Branding2026!", name: `Branding ${role}`, role });
  const totp = await enrollTotp(jar, email, "Branding2026!");
  await signInWithTotp(jar, email, "Branding2026!", totp);
  return jar;
}

// The HTTP seam: staff routes, public reads, and the asset bytes — driven
// directly at the route handlers, the way analytics-report drives its PUTs
// (cookie + trusted-origin headers on a constructed Request).
function staffPut(route: string, jar: CookieJar | null, body: unknown): Promise<Response> {
  return import(`../src/app/api/staff/settings/branding/${route}/route`).then(
    ({ PUT }) =>
      PUT(
        new Request(`${TEST_ORIGIN}/api/staff/settings/branding/${route}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            origin: TEST_ORIGIN,
            ...(jar ? { cookie: jar.header() } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      ),
  );
}

async function publicBranding(): Promise<{
  chatbotIconUrl: string;
  chathead: Record<string, unknown>;
}> {
  const { GET } = await import("../src/app/api/v1/branding/route");
  const response = await GET(
    new Request(`${TEST_ORIGIN}/api/v1/branding`, { headers: { "x-forwarded-for": "10.70.0.1" } }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    chatbotIconUrl: string;
    chathead: Record<string, unknown>;
  };
}

describe("branding domain (ticket 70)", () => {
  it("sniffs the three accepted types by content and rejects everything else", async () => {
    expect(sniffImageType(await bundledPngBytes())).toBe("image/png");
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))).toBe("image/jpeg");
    expect(sniffImageType(webPBytes())).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("<svg xmlns='x'></svg>"))).toBeNull();
    expect(sniffImageType(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });

  it("enforces the 500 KB ceiling on raw bytes", async () => {
    const png = await bundledPngBytes();
    expect(isValidBrandedImage(png)).toBe(true);
    const oversized = new Uint8Array(500 * 1024 + 1);
    oversized.set(png.slice(0, 8), 0);
    expect(isValidBrandedImage(oversized)).toBe(false);
    expect(isValidBrandedImage(new Uint8Array())).toBe(false);
  });

  it("normalizes hex colors and rejects everything that is not one", () => {
    expect(normalizeHexColor("#013C78")).toBe("#013c78");
    expect(normalizeHexColor("#ABC")).toBe("#aabbcc");
    expect(normalizeHexColor(" #013c78 ")).toBe("#013c78");
    expect(normalizeHexColor("013C78")).toBeNull();
    expect(normalizeHexColor("#013C7")).toBeNull();
    expect(normalizeHexColor("blue")).toBeNull();
    expect(normalizeHexColor(42)).toBeNull();
  });

  it("bounds the chathead config and resolves corrupt rows to the defaults", () => {
    expect(
      isValidChatheadConfig({ backgroundColor: "#013C78", iconSize: 48, padding: 4 }),
    ).toBe(true);
    // Ticket 71: dimensions are optional (legacy rows) but bounded 44-96
    // when present.
    expect(
      isValidChatheadConfig({ backgroundColor: "#013C78", iconSize: 48, padding: 4, width: 64, height: 64 }),
    ).toBe(true);
    expect(
      isValidChatheadConfig({ backgroundColor: "#013C78", iconSize: 48, padding: 4, width: 43, height: 64 }),
    ).toBe(false);
    expect(
      isValidChatheadConfig({ backgroundColor: "#013C78", iconSize: 48, padding: 4, width: 97, height: 64 }),
    ).toBe(false);
    expect(
      isValidChatheadConfig({ backgroundColor: "#013C78", iconSize: 48, padding: 4, width: 64.5, height: 64 }),
    ).toBe(false);
    expect(
      isValidChatheadConfig({ backgroundColor: "#013C78", iconSize: 31, padding: 4 }),
    ).toBe(false);
    expect(
      isValidChatheadConfig({ backgroundColor: "#013C78", iconSize: 65, padding: 4 }),
    ).toBe(false);
    expect(
      isValidChatheadConfig({ backgroundColor: "#013C78", iconSize: 48, padding: 13 }),
    ).toBe(false);
    expect(
      isValidChatheadConfig({ backgroundColor: "#013C78", iconSize: 48.5, padding: 4 }),
    ).toBe(false);
    expect(resolveChatheadConfig(undefined)).toEqual({
      backgroundColor: "#013c78",
      foreground: undefined,
      iconSize: 48,
      padding: 4,
      width: 64,
      height: 64,
    });
    expect(resolveChatheadConfig({ backgroundColor: "junk", iconSize: 999, padding: -3 })).toEqual({
      backgroundColor: "#013c78",
      foreground: undefined,
      iconSize: 48,
      padding: 4,
      width: 64,
      height: 64,
    });
    expect(chatheadDerivedSize(CHATHEAD_DEFAULTS)).toBe(56);
  });

  it("derives legacy dimensions and refuses fit-broken rows on read (ticket 71)", () => {
    // A pre-71 row: no dimensions — they resolve from icon + padding so the
    // deployed chathead does not resize.
    const legacy = resolveChatheadConfig({ backgroundColor: "#7A0030", iconSize: 40, padding: 6 });
    expect(legacy.width).toBe(52);
    expect(legacy.height).toBe(52);
    // Out-of-range dimensions fall back to the defaults.
    const outOfRange = resolveChatheadConfig({
      backgroundColor: "#7A0030",
      iconSize: 40,
      padding: 6,
      width: 200,
      height: 52,
    });
    expect(outOfRange.width).toBe(64);
    expect(outOfRange.height).toBe(64);
    expect(outOfRange.backgroundColor).toBe("#013c78");
    // A hand-edited row whose dimensions cannot hold the icon: safe fallback.
    const fitBroken = resolveChatheadConfig({
      backgroundColor: "#7A0030",
      iconSize: 64,
      padding: 12,
      width: 44,
      height: 96,
    });
    expect(fitBroken.width).toBe(64);
    expect(fitBroken.height).toBe(64);
  });

  it("states the required minimum when the icon and padding do not fit (ticket 71)", () => {
    // 48 + 2×4 = 56: needs at least 56 × 56.
    expect(chatheadFitRequirement({ backgroundColor: "#013c78", iconSize: 48, padding: 4, width: 44, height: 96 })).toBe(56);
    expect(chatheadFitRequirement({ backgroundColor: "#013c78", iconSize: 48, padding: 4, width: 96, height: 44 })).toBe(56);
    // Fitting configurations answer null, square or rectangular.
    expect(chatheadFitRequirement({ backgroundColor: "#013c78", iconSize: 48, padding: 4, width: 56, height: 56 })).toBeNull();
    expect(chatheadFitRequirement({ backgroundColor: "#013c78", iconSize: 64, padding: 12, width: 88, height: 96 })).toBeNull();
  });

  it("chooses the readable foreground automatically", () => {
    expect(chatheadForeground("#013C78")).toBe("#ffffff");
    expect(chatheadForeground("#7a0030")).toBe("#ffffff");
    expect(chatheadForeground("#ffffff")).toBe("#1f2933");
    expect(chatheadForeground("#f5f5f5")).toBe("#1f2933");
  });

  it("parses data URLs by decoded content, not the declared prefix", async () => {
    const png = await bundledPngBytes();
    // A browser that reports the wrong MIME still stores as the sniffed type.
    const parsed = parseBrandingImageDataUrl(pngDataUrl(png, "image/svg+xml"));
    expect(parsed?.type).toBe("image/png");
    expect(parsed?.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(parseBrandingImageDataUrl(svgDataUrl())).toBeNull();
    expect(parseBrandingImageDataUrl("data:image/png;base64,####")).toBeNull();
    expect(parseBrandingImageDataUrl("data:image/png;base64")).toBeNull();
    expect(parseBrandingImageDataUrl(42)).toBeNull();
    const oversized = new Uint8Array(500 * 1024 + 10);
    oversized.set(png.slice(0, 8), 0);
    expect(parseBrandingImageDataUrl(pngDataUrl(oversized))).toBeNull();
  });
});

// The HTTP seam: staff routes, public reads, and the asset bytes.
describe("branding settings API (ticket 70)", () => {
  it("serves the bundled defaults while nothing is configured", async () => {
    const body = await publicBranding();
    expect(Object.keys(body).sort()).toEqual(["chatbotIconUrl", "chathead"]);
    expect(Object.keys(body.chathead).sort()).toEqual([
      "backgroundColor",
      "foreground",
      "height",
      "iconSize",
      "padding",
      "width",
    ]);
    expect(body.chathead.backgroundColor).toBe("#013c78");
    expect(body.chathead.iconSize).toBe(48);
    expect(body.chathead.padding).toBe(4);
    // Ticket 71's default configuration is 64 × 64.
    expect(body.chathead.width).toBe(64);
    expect(body.chathead.height).toBe(64);
    expect(body.chathead.foreground).toBe("#ffffff");
    expect(body.chatbotIconUrl).toBe("/api/branding/chatbot-icon?v=default");
  });

  it("serves the bundled crest bytes until an upload lands", async () => {
    const { GET } = await import("../src/app/api/branding/chatbot-icon/route");
    const asset = await GET();
    expect(asset.status).toBe(200);
    expect(asset.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await asset.arrayBuffer())).toEqual(await bundledPngBytes());
  });

  it("rejects unauthenticated writes", async () => {
    const put = await staffPut("chatbot-icon", null, { image: svgDataUrl() });
    expect(put.status).toBe(401);
  });

  it("accepts a valid upload from every dashboard role", async () => {
    const png = await bundledPngBytes();
    for (const role of ["owner", "staff", "editor"] as const) {
      const jar = await signInAs(role, "matrix");
      const put = await staffPut("chatbot-icon", jar, { image: pngDataUrl(png) });
      expect(put.status, `${role} upload`).toBe(200);
      expect(((await put.json()) as { ok?: boolean }).ok).toBe(true);
    }
  });

  it("rejects SVG, disguised, oversized, and corrupt uploads without saving", async () => {
    const jar = await signInAs("owner", "validator");
    const attempts: [string, unknown][] = [
      ["svg", { image: svgDataUrl() }],
      ["corrupt base64", { image: "data:image/png;base64,####" }],
      ["not base64", { image: "data:image/png,hello" }],
      ["missing image key", { wrong: true }],
      ["non-string", { image: 42 }],
    ];
    for (const [label, body] of attempts) {
      const put = await staffPut("chatbot-icon", jar, body);
      expect(put.status, label).toBe(400);
      expect(((await put.json()) as { error: { code: string } }).error.code).toBe(
        label === "missing image key" ? "invalid_request" : "invalid_image",
      );
    }
    const png = await bundledPngBytes();
    const oversized = new Uint8Array(500 * 1024 + 10);
    oversized.set(png.slice(0, 8), 0);
    const tooBig = await staffPut("chatbot-icon", jar, { image: pngDataUrl(oversized) });
    expect(tooBig.status).toBe(400);

    // None of the refusals changed the served asset.
    const { GET } = await import("../src/app/api/branding/chatbot-icon/route");
    expect(new Uint8Array(await (await GET()).arrayBuffer())).toEqual(png);
  });

  it("applies an accepted upload to the public read and asset route", async () => {
    const jar = await signInAs("staff", "apply");
    const png = await bundledPngBytes();
    const put = await staffPut("chatbot-icon", jar, { image: pngDataUrl(png) });
    expect(put.status).toBe(200);
    const version = ((await put.json()) as { version: string }).version;
    expect(version).not.toBe("default");

    const body = await publicBranding();
    expect(body.chatbotIconUrl).toBe(`/api/branding/chatbot-icon?v=${encodeURIComponent(version)}`);

    const { GET } = await import("../src/app/api/branding/chatbot-icon/route");
    expect(new Uint8Array(await (await GET()).arrayBuffer())).toEqual(png);

    // A second save yields a fresh version (the row's new updated_at) even
    // on Postgres, where the camelCase alias must survive the round trip.
    const second = await staffPut("chatbot-icon", jar, { image: pngDataUrl(png) });
    expect(second.status).toBe(200);
    const secondVersion = ((await second.json()) as { version: string }).version;
    expect(secondVersion).not.toBe(version);
  });

  it("keeps the two images independent on reset", async () => {
    const jar = await signInAs("editor", "independent");
    const png = await bundledPngBytes();
    await staffPut("chatbot-icon", jar, { image: pngDataUrl(png) });
    await staffPut("dashboard-favicon", jar, { image: pngDataUrl(png) });

    const reset = await staffPut("dashboard-favicon", jar, { image: null });
    expect(reset.status).toBe(200);

    // The favicon is back to the bundled bytes; the icon keeps the upload…
    const { GET: getFavicon } = await import("../src/app/api/branding/dashboard-favicon/route");
    expect(new Uint8Array(await (await getFavicon()).arrayBuffer())).toEqual(
      await bundledPngBytes(),
    );
    const { GET: getIcon } = await import("../src/app/api/branding/chatbot-icon/route");
    expect(new Uint8Array(await (await getIcon()).arrayBuffer())).toEqual(png);

    // …until the icon itself is reset, which leaves the favicon alone.
    const iconReset = await staffPut("chatbot-icon", jar, { image: null });
    expect(iconReset.status).toBe(200);
    expect(new Uint8Array(await (await getFavicon()).arrayBuffer())).toEqual(
      await bundledPngBytes(),
    );
  });

  it("validates the chathead config, blocks saves that do not fit, and resets (ticket 71)", async () => {
    const jar = await signInAs("staff", "chathead");

    // A pre-71-shaped body (no dimensions) stays valid: the public read
    // derives the outer size, preserving deployed chatheads.
    const legacyPut = await staffPut("chathead", jar, {
      chathead: { backgroundColor: "#7A0030", iconSize: 40, padding: 6 },
    });
    expect(legacyPut.status).toBe(200);

    const legacyRead = await publicBranding();
    expect(legacyRead.chathead.backgroundColor).toBe("#7a0030");
    expect(legacyRead.chathead.width).toBe(52);
    expect(legacyRead.chathead.height).toBe(52);
    expect(legacyRead.chathead.foreground).toBe("#ffffff");

    for (const [label, bad] of [
      ["bad hex", { chathead: { backgroundColor: "junk", iconSize: 40, padding: 6 } }],
      ["icon below floor", { chathead: { backgroundColor: "#7A0030", iconSize: 20, padding: 6 } }],
      ["padding over ceiling", { chathead: { backgroundColor: "#7A0030", iconSize: 40, padding: 99 } }],
      ["fractional size", { chathead: { backgroundColor: "#7A0030", iconSize: 40.5, padding: 6 } }],
      ["width below band", { chathead: { backgroundColor: "#7A0030", iconSize: 40, padding: 6, width: 40, height: 52 } }],
      ["height over band", { chathead: { backgroundColor: "#7A0030", iconSize: 40, padding: 6, width: 52, height: 97 } }],
      ["missing chathead", {}],
    ] as [string, unknown][]) {
      const rejected = await staffPut("chathead", jar, bad);
      expect(rejected.status, label).toBe(400);
    }

    // The fit rule: 64 + 2×12 = 88 needed, dimensions offer 44 — refused
    // with the required minimum in the message, stored values untouched.
    const noFit = await staffPut("chathead", jar, {
      chathead: { backgroundColor: "#7A0030", iconSize: 64, padding: 12, width: 44, height: 96 },
    });
    expect(noFit.status).toBe(400);
    const noFitBody = (await noFit.json()) as { error: { code: string; message: string } };
    expect(noFitBody.error.code).toBe("chathead_does_not_fit");
    expect(noFitBody.error.message).toContain("88 × 88");
    const afterRefusal = await publicBranding();
    expect(afterRefusal.chathead.backgroundColor).toBe("#7a0030");
    expect(afterRefusal.chathead.iconSize).toBe(40);
    expect(afterRefusal.chathead.width).toBe(52);

    // A rectangular configuration that fits saves and propagates: icon 32
    // with no padding needs only 32 × 32, so 96 × 44 is legal.
    const rectangular = await staffPut("chathead", jar, {
      chathead: { backgroundColor: "#7A0030", iconSize: 32, padding: 0, width: 96, height: 44 },
    });
    expect(rectangular.status).toBe(200);
    const rectangularRead = await publicBranding();
    expect(rectangularRead.chathead.width).toBe(96);
    expect(rectangularRead.chathead.height).toBe(44);

    const reset = await staffPut("chathead", jar, null);
    expect(reset.status).toBe(200);
    const after = await publicBranding();
    expect(after.chathead.backgroundColor).toBe("#013c78");
    expect(after.chathead.width).toBe(64);
    expect(after.chathead.height).toBe(64);
  });

  it("falls back to the defaults when a stored row is hand-edited junk", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();
    await db.run(
      "UPDATE settings SET value = ? WHERE key = ?",
      "data:image/png;base64,not-really",
      "branding_chatbot_icon",
    );
    await db.run(
      "INSERT INTO settings (key, value, updated_at) VALUES ('branding_chathead', '{\"backgroundColor\":', '2026-01-01T00:00:00.000Z') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );

    const { GET } = await import("../src/app/api/branding/chatbot-icon/route");
    expect(new Uint8Array(await (await GET()).arrayBuffer())).toEqual(await bundledPngBytes());

    const body = await publicBranding();
    expect(body.chatbotIconUrl.endsWith("v=default")).toBe(true);
    expect(body.chathead).toEqual({
      backgroundColor: "#013c78",
      foreground: "#ffffff",
      height: 64,
      iconSize: 48,
      padding: 4,
      width: 64,
    });
  });

  it("preserves pre-71 chatheads by deriving their dimensions (ticket 71)", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();
    // Exactly the shape ticket 70 wrote: no width or height keys.
    await db.run(
      "INSERT INTO settings (key, value, updated_at) VALUES ('branding_chathead', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      JSON.stringify({ backgroundColor: "#7A0030", iconSize: 40, padding: 6 }),
      new Date().toISOString(),
    );

    const body = await publicBranding();
    expect(body.chathead.backgroundColor).toBe("#7a0030");
    expect(body.chathead.iconSize).toBe(40);
    expect(body.chathead.padding).toBe(6);
    // Derived outer size, not the 64 × 64 default: deployed chatheads do
    // not resize when this ticket ships.
    expect(body.chathead.width).toBe(52);
    expect(body.chathead.height).toBe(52);
  });

  it("pins the dashboard-only favicon scope and the icon placements", async () => {
    const layout = await readFile(path.join(repoRoot(), "src/app/dashboard/layout.tsx"), "utf8");
    expect(layout).toContain("/api/branding/dashboard-favicon");
    // The public demo page never references the branding routes.
    const demo = await readFile(
      path.join(repoRoot(), "public/demo/wordpress-test-page.html"),
      "utf8",
    );
    expect(demo).not.toContain("/api/branding");
    // The frame reads branding once and falls back to the bundled crest on
    // all three surfaces (fresh header, conversation header, greeting); it
    // forwards the public config to the launcher, because the loader makes
    // no API calls of its own. (Ticket 33 moved the read into the frame's
    // published-content hook; the pin follows the code.)
    const content = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/hooks/usePublishedContent.ts"),
      "utf8",
    );
    expect(content).toContain('fetch("/api/v1/branding")');
    expect(content).toContain('chatbotIconUrl ?? "/brand/cropped-SFC-Final-Logo-Single.png"');
    expect(content).toContain('postMessage({ type: "sfcw:branding", config }, "*")');
    // The loader applies branding only from the frame's forwarded message —
    // branding itself never calls the API from the college page context —
    // and sizes the launcher from the resolved width and height, with the
    // corner radius at 25% of the smaller dimension (ticket 71) and the
    // frame hanging above the configured height. (Ticket 76 narrows the
    // loader's "no API calls" property to exactly one credential-free
    // pre-render ask — the eligibility check — so the pin counts that one
    // path instead of forbidding the prefix.)
    const loader = await readFile(path.join(repoRoot(), "src/widget/loader.ts"), "utf8");
    expect(loader).toContain("/api/v1/embed-eligibility");
    expect(loader.match(/api\/v1\//g)).toHaveLength(1);
    expect(loader).toContain('type === "sfcw:branding"');
    expect(loader).toContain("width:var(--sfcw-w,64px);height:var(--sfcw-h,64px)");
    expect(loader).toContain("border-radius:calc(min(var(--sfcw-w,64px),var(--sfcw-h,64px)) * .25)");
    expect(loader).toContain("bottom:calc(16px + var(--sfcw-h,64px) + 4px)");
    expect(loader).not.toContain("--sfcw-outer");
    // The sidebar crest is untouched by branding (ticket 70's out-of-scope).
    const header = await readFile(path.join(repoRoot(), "src/app/dashboard/header.tsx"), "utf8");
    expect(header).toContain("/brand/cropped-SFC-Final-Logo-Single.png");
    expect(header).toContain('area: "settings"');
    expect(header).toContain('label: "Settings"');
    expect(header).toContain('roles: ["owner", "staff", "editor"]');
  });
});
