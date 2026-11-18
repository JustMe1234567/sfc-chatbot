import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { TEST_ORIGIN, useTempDatabase, warmChatbotService } from "./helpers";
import {
  CookieJar,
  enrollTotp,
  provisionStaff,
  signInWithTotp,
} from "./auth-helpers";
import {
  DEFAULT_EMBED_ALLOWLIST_ORIGIN,
  MAX_EMBED_ALLOWLIST_ORIGINS,
  isEmbedOriginAllowed,
  isStandaloneFrameNavigation,
  normalizeCandidateParentOrigin,
  normalizeEmbedOrigin,
  resolveFrameAncestors,
  validateEmbedAllowlist,
} from "../src/domain/embedAllowlist";
import { getEmbedAllowlistOrigins } from "../src/settings";
import { repoRoot } from "../src/paths";

/**
 * Ticket 76: the owner-managed embed allowlist. The widget renders only on
 * owner-approved exact HTTPS origins (plus the two fixed loopback origins
 * outside production); the loader asks before it renders anything, the
 * frame response carries the current allowlist as browser-enforced
 * frame-ancestors, and production standalone access renders nothing. The
 * same file proves the seed and persistence behavior on whichever backend
 * the suite is running (SQLite or Postgres).
 */

const OWNER_EMAIL = "embed-owner@example.edu";
const OWNER_PASSWORD = "embed-owner-cove-4x";
const EDITOR_EMAIL = "embed-editor@example.edu";
const EDITOR_PASSWORD = "embed-editor-meadow-6p";
const STAFF_EMAIL = "embed-staff@example.edu";
const STAFF_PASSWORD = "embed-staff-fable-9d";

let ownerTotp: Awaited<ReturnType<typeof enrollTotp>>;
let editorTotp: Awaited<ReturnType<typeof enrollTotp>>;
let staffTotp: Awaited<ReturnType<typeof enrollTotp>>;

const COLLEGE = "https://springfieldcollege.ca";
const OTHER_SITE = "https://alumni-foundation.example";

async function service(): Promise<Awaited<ReturnType<typeof import("../src/db/service").getChatbotService>>> {
  const { getChatbotService } = await import("../src/db/service");
  return getChatbotService();
}

async function staffJar(
  email: string,
  password: string,
  totp: Awaited<ReturnType<typeof enrollTotp>>,
): Promise<CookieJar> {
  const jar = new CookieJar();
  await signInWithTotp(jar, email, password, totp);
  return jar;
}

async function fetchEligibility(query: string | null, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const { GET } = await import("../src/app/api/v1/embed-eligibility/route");
  const url = `${TEST_ORIGIN}/api/v1/embed-eligibility${query === null ? "" : `?origin=${encodeURIComponent(query)}`}`;
  return GET(new Request(url, { headers: extraHeaders }));
}

async function eligibilityAllowed(
  query: string | null,
  extraHeaders: Record<string, string> = {},
): Promise<boolean> {
  const response = await fetchEligibility(query, extraHeaders);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { allowed: boolean };
  return body.allowed;
}

async function getAllowlist(jar: CookieJar): Promise<{ origins: string[] }> {
  const { GET } = await import("../src/app/api/staff/settings/embed-allowlist/route");
  const response = await GET(
    new Request(`${TEST_ORIGIN}/api/staff/settings/embed-allowlist`, {
      headers: { cookie: jar.header() },
    }),
  );
  return (await response.json()) as { origins: string[] };
}

async function putAllowlist(
  jar: CookieJar,
  origins: unknown,
  origin = TEST_ORIGIN,
): Promise<Response> {
  const { PUT } = await import("../src/app/api/staff/settings/embed-allowlist/route");
  return PUT(
    new Request(`${TEST_ORIGIN}/api/staff/settings/embed-allowlist`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: jar.header(), origin },
      body: JSON.stringify({ origins }),
    }),
  );
}

async function allowlistError(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: { message?: string } };
  return body.error?.message ?? "";
}

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  await provisionStaff({ email: OWNER_EMAIL, password: OWNER_PASSWORD, name: "Olive", role: "owner" });
  await provisionStaff({ email: EDITOR_EMAIL, password: EDITOR_PASSWORD, name: "Eddie", role: "editor" });
  await provisionStaff({ email: STAFF_EMAIL, password: STAFF_PASSWORD, name: "Sam" });
  ownerTotp = await enrollTotp(new CookieJar(), OWNER_EMAIL, OWNER_PASSWORD);
  editorTotp = await enrollTotp(new CookieJar(), EDITOR_EMAIL, EDITOR_PASSWORD);
  staffTotp = await enrollTotp(new CookieJar(), STAFF_EMAIL, STAFF_PASSWORD);
});

describe("origin normalization and validation", () => {
  it("reduces a pasted page address to its origin, authorizing every path", () => {
    const pasted = normalizeEmbedOrigin("https://springfieldcollege.ca/programs/example/?campaign=fall");
    expect(pasted).toEqual({ ok: true, origin: COLLEGE });
    const upper = normalizeEmbedOrigin("https://SpringfieldCollege.CA/Admissions");
    expect(upper.ok ? upper.origin : "").toBe(COLLEGE);
  });

  it("keeps a non-default port in the exact origin and drops the default one", () => {
    const ported = normalizeEmbedOrigin("https://portal.example:8443/entry");
    expect(ported.ok ? ported.origin : "").toBe("https://portal.example:8443");
    const defaulted = normalizeEmbedOrigin("https://portal.example:443/entry");
    expect(defaulted.ok ? defaulted.origin : "").toBe("https://portal.example");
  });

  it("refuses non-HTTPS websites, credentials, wildcards, and non-URLs", () => {
    expect(normalizeEmbedOrigin("http://springfieldcollege.ca")).toEqual({
      ok: false,
      reason: "not_https",
    });
    expect(normalizeEmbedOrigin("ftp://springfieldcollege.ca")).toEqual({
      ok: false,
      reason: "not_https",
    });
    expect(normalizeEmbedOrigin("https://user:secret@springfieldcollege.ca/programs")).toEqual({
      ok: false,
      reason: "credentials",
    });
    expect(normalizeEmbedOrigin("https://user@springfieldcollege.ca")).toEqual({
      ok: false,
      reason: "credentials",
    });
    expect(normalizeEmbedOrigin("https://*.springfieldcollege.ca")).toEqual({
      ok: false,
      reason: "wildcard_host",
    });
    expect(normalizeEmbedOrigin("not a url at all").ok).toBe(false);
    expect(normalizeEmbedOrigin("").ok).toBe(false);
  });

  it("loosens only for candidate parent origins so the HTTP loopback exceptions can be judged", () => {
    expect(normalizeCandidateParentOrigin("http://localhost:3000/chat")).toBe("http://localhost:3000");
    expect(normalizeCandidateParentOrigin("https://springfieldcollege.ca/a?b")).toBe(COLLEGE);
    expect(normalizeCandidateParentOrigin("http://user:pass@localhost:3000")).toBeNull();
    expect(normalizeCandidateParentOrigin("https://*.evil.example")).toBeNull();
    expect(normalizeCandidateParentOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizeCandidateParentOrigin("")).toBeNull();
  });

  it("validates whole-list writes with actionable feedback", () => {
    expect(validateEmbedAllowlist("not a list").ok).toBe(false);
    expect(validateEmbedAllowlist([42]).ok).toBe(false);
    expect(validateEmbedAllowlist([])).toEqual({ ok: true, origins: [] });

    const duplicate = validateEmbedAllowlist([COLLEGE, "https://springfieldcollege.ca/programs"]);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.error).toContain("already on the allowlist");
    }

    const ceiling = validateEmbedAllowlist(
      Array.from({ length: MAX_EMBED_ALLOWLIST_ORIGINS + 1 }, (_, i) => `https://site-${i}.example`),
    );
    expect(ceiling.ok).toBe(false);
    if (!ceiling.ok) {
      expect(ceiling.error).toContain("maximum of 20");
    }

    const twenty = validateEmbedAllowlist(
      Array.from({ length: MAX_EMBED_ALLOWLIST_ORIGINS }, (_, i) => `https://site-${i}.example/page`),
    );
    expect(twenty.ok).toBe(true);

    const http = validateEmbedAllowlist(["http://insecure.example"]);
    expect(http.ok).toBe(false);
    if (!http.ok) {
      expect(http.error).toContain("HTTPS");
    }

    const credentials = validateEmbedAllowlist(["https://admin:pw@example.com"]);
    expect(credentials.ok).toBe(false);
    if (!credentials.ok) {
      expect(credentials.error).toContain("username or password");
    }

    const wildcard = validateEmbedAllowlist(["https://*.example.com"]);
    expect(wildcard.ok).toBe(false);
    if (!wildcard.ok) {
      expect(wildcard.error).toContain("wildcard");
    }
  });
});

describe("the eligibility and enforcement decisions", () => {
  it("in production, allows exactly the stored origins and never the dev exceptions", () => {
    const stored = [COLLEGE];
    expect(isEmbedOriginAllowed(COLLEGE, stored, [], true)).toBe(true);
    expect(isEmbedOriginAllowed(OTHER_SITE, stored, [], true)).toBe(false);
    expect(isEmbedOriginAllowed("http://localhost:3000", stored, [], true)).toBe(false);
    expect(isEmbedOriginAllowed("http://127.0.0.1:3000", stored, [], true)).toBe(false);
    expect(isEmbedOriginAllowed(null, stored, [], true)).toBe(false);
  });

  it("outside production, the fixed loopback origins and the trusted app origins are automatic exceptions", () => {
    const trusted = [TEST_ORIGIN, "http://localhost:3000", "http://127.0.0.1:3000"];
    expect(isEmbedOriginAllowed("http://localhost:3000", [], trusted, false)).toBe(true);
    expect(isEmbedOriginAllowed("http://127.0.0.1:3000", [], trusted, false)).toBe(true);
    expect(isEmbedOriginAllowed(TEST_ORIGIN, [], trusted, false)).toBe(true);
    expect(isEmbedOriginAllowed(OTHER_SITE, [], trusted, false)).toBe(false);
    expect(isEmbedOriginAllowed(OTHER_SITE, [OTHER_SITE], trusted, false)).toBe(true);
    expect(isEmbedOriginAllowed(null, [], trusted, false)).toBe(false);
  });

  it("names the production allowlist exactly, and 'none' when production's list is empty", () => {
    expect(resolveFrameAncestors([COLLEGE, OTHER_SITE], [], true)).toBe(
      `frame-ancestors ${COLLEGE} ${OTHER_SITE}`,
    );
    expect(resolveFrameAncestors([], [], true)).toBe("frame-ancestors 'none'");
    // Outside production the trusted app origins stay embeddable for the
    // local embed checks, deduplicated against any stored entries.
    expect(resolveFrameAncestors([], [TEST_ORIGIN], false)).toBe(
      `frame-ancestors ${TEST_ORIGIN}`,
    );
    expect(resolveFrameAncestors([TEST_ORIGIN], [TEST_ORIGIN], false)).toBe(
      `frame-ancestors ${TEST_ORIGIN}`,
    );
    expect(resolveFrameAncestors([], [], false)).toBe("frame-ancestors 'none'");
  });

  it("refuses production standalone navigation and unverifiable destinations, never development ones", () => {
    expect(isStandaloneFrameNavigation("iframe", true)).toBe(false);
    expect(isStandaloneFrameNavigation("document", true)).toBe(true);
    expect(isStandaloneFrameNavigation("frame", true)).toBe(true);
    expect(isStandaloneFrameNavigation(null, true)).toBe(true);
    expect(isStandaloneFrameNavigation("iframe", false)).toBe(false);
    expect(isStandaloneFrameNavigation("document", false)).toBe(false);
    expect(isStandaloneFrameNavigation(null, false)).toBe(false);
  });
});

describe("the seeded allowlist setting", () => {
  it("starts a genuinely unconfigured installation with exactly the Springfield College origin", async () => {
    // Order-dependent by nature: the seed applies only while the setting has
    // never been configured, so this runs before any owner save in this file.
    const { db } = await service();
    expect(await getEmbedAllowlistOrigins(db)).toEqual([DEFAULT_EMBED_ALLOWLIST_ORIGIN]);
    const owner = await staffJar(OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    expect(await getAllowlist(owner)).toEqual({ origins: [DEFAULT_EMBED_ALLOWLIST_ORIGIN] });
  });

  it("treats a deliberately saved empty list as configuration and never reseeds it", async () => {
    const { db } = await service();
    const { setEmbedAllowlist, readEmbedAllowlist, getEmbedAllowlistOrigins, seedEmbedAllowlist } =
      await import("../src/settings");
    await setEmbedAllowlist(db, []);
    expect(await readEmbedAllowlist(db)).toEqual({ kind: "set", origins: [] });
    expect(await getEmbedAllowlistOrigins(db)).toEqual([]);
    // The boot path re-runs the seed on every start; it must not resurrect
    // the default for a deliberate empty.
    await seedEmbedAllowlist(db);
    expect(await getEmbedAllowlistOrigins(db)).toEqual([]);

    // Restore the seed for the eligibility tests below.
    await setEmbedAllowlist(db, [DEFAULT_EMBED_ALLOWLIST_ORIGIN]);
  });

  it("reads the unconfigured default and fails closed on a corrupt or smuggled row", async () => {
    const { db } = await service();
    const { setEmbedAllowlist, setSetting, getEmbedAllowlistOrigins } = await import("../src/settings");

    await setEmbedAllowlist(db, []);
    await db.run("DELETE FROM settings WHERE key = ?", "embed_allowlist");
    expect(await getEmbedAllowlistOrigins(db)).toEqual([DEFAULT_EMBED_ALLOWLIST_ORIGIN]);

    await setSetting(db, "embed_allowlist", "not json at all");
    expect(await getEmbedAllowlistOrigins(db)).toEqual([]);

    // A hand-edited row cannot smuggle a non-HTTPS origin into enforcement.
    await setSetting(db, "embed_allowlist", JSON.stringify(["http://localhost:3000", COLLEGE]));
    expect(await getEmbedAllowlistOrigins(db)).toEqual([]);

    await setEmbedAllowlist(db, [DEFAULT_EMBED_ALLOWLIST_ORIGIN]);
  });
});

describe("the public eligibility check", () => {
  it("answers boolean-only: no allowlist data ever leaves the server", async () => {
    const response = await fetchEligibility(COLLEGE);
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["allowed"]);
    expect(body.allowed).toBe(true);
    expect(typeof body.allowed).toBe("boolean");
    // The response names no origin and carries no list.
    expect(text).not.toContain("springfieldcollege");
    expect(text).not.toContain("origins");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("allows the seeded college origin and denies unknown websites", async () => {
    expect(await eligibilityAllowed(COLLEGE)).toBe(true);
    expect(await eligibilityAllowed(OTHER_SITE)).toBe(false);
    expect(await eligibilityAllowed("https://evil.example/steal")).toBe(false);
  });

  it("denies malformed, missing, and unverifiable candidates", async () => {
    expect(await eligibilityAllowed("not a url")).toBe(false);
    expect(await eligibilityAllowed("javascript:alert(1)")).toBe(false);
    expect(await eligibilityAllowed("https://user:pass@springfieldcollege.ca")).toBe(false);
    expect(await eligibilityAllowed("https://*.springfieldcollege.ca")).toBe(false);
    expect(await eligibilityAllowed("")).toBe(false);
    // No parameter and no derivable headers: denied.
    expect(await eligibilityAllowed(null)).toBe(false);
  });

  it("derives the candidate from the browser-set Origin or Referer header when the loader sends none", async () => {
    expect(await eligibilityAllowed(null, { origin: TEST_ORIGIN })).toBe(true);
    expect(await eligibilityAllowed(null, { origin: "https://evil.example" })).toBe(false);
    expect(await eligibilityAllowed(null, { referer: `${TEST_ORIGIN}/programs/example` })).toBe(true);
    expect(await eligibilityAllowed(null, { referer: "https://evil.example/page" })).toBe(false);
    expect(await eligibilityAllowed(null, { referer: "::::" })).toBe(false);
  });

  it("outside production, the fixed loopback origins are automatic exceptions that are not stored", async () => {
    expect(await eligibilityAllowed("http://localhost:3000/chat")).toBe(true);
    expect(await eligibilityAllowed("http://127.0.0.1:3000")).toBe(true);
    const owner = await staffJar(OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    expect((await getAllowlist(owner)).origins).not.toContain("http://localhost:3000");
    expect((await getAllowlist(owner)).origins).not.toContain("http://127.0.0.1:3000");
  });

  it("applies owner saves to newly loaded widgets immediately, with no redeploy", async () => {
    const owner = await staffJar(OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    expect(await eligibilityAllowed(OTHER_SITE)).toBe(false);
    const saved = await putAllowlist(owner, [DEFAULT_EMBED_ALLOWLIST_ORIGIN, `${OTHER_SITE}/donate`]);
    expect(saved.status).toBe(200);
    expect(await eligibilityAllowed(OTHER_SITE)).toBe(true);
    expect(await eligibilityAllowed(`${OTHER_SITE}`)).toBe(true);

    // Removing it denies again.
    expect((await putAllowlist(owner, [DEFAULT_EMBED_ALLOWLIST_ORIGIN])).status).toBe(200);
    expect(await eligibilityAllowed(OTHER_SITE)).toBe(false);
  });
});

describe("the owner-only allowlist API", () => {
  it("reads and writes for the owner, normalizing pasted addresses", async () => {
    const owner = await staffJar(OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    const saved = await putAllowlist(owner, [
      `${COLLEGE}/programs/example/?campaign=fall`,
      "https://Portal.Example:8443/entry",
    ]);
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { origins: string[] }).origins).toEqual([
      COLLEGE,
      "https://portal.example:8443",
    ]);
    expect((await getAllowlist(owner)).origins).toEqual([
      COLLEGE,
      "https://portal.example:8443",
    ]);
    // Restore the seeded single entry for other suites reading this file's db.
    expect((await putAllowlist(owner, [COLLEGE])).status).toBe(200);
  });

  it("refuses staff, editors, anonymous callers, and untrusted origins", async () => {
    const staff = await staffJar(STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
    const editor = await staffJar(EDITOR_EMAIL, EDITOR_PASSWORD, editorTotp);
    const owner = await staffJar(OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);

    expect((await putAllowlist(staff, [])).status).toBe(403);
    expect((await putAllowlist(editor, [])).status).toBe(403);
    expect((await putAllowlist(new CookieJar(), [])).status).toBe(401);
    expect((await putAllowlist(owner, ["https://evil.example"], "https://evil.example")).status).toBe(403);

    // Reads are equally owner-only.
    const { GET } = await import("../src/app/api/staff/settings/embed-allowlist/route");
    expect(
      (
        await GET(
          new Request(`${TEST_ORIGIN}/api/staff/settings/embed-allowlist`, {
            headers: { cookie: staff.header() },
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await GET(
          new Request(`${TEST_ORIGIN}/api/staff/settings/embed-allowlist`, {
            headers: { cookie: editor.header() },
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await GET(
          new Request(`${TEST_ORIGIN}/api/staff/settings/embed-allowlist`, {}),
        )
      ).status,
    ).toBe(401);
    // A refusal leaks nothing about the list.
    const refused = await GET(
      new Request(`${TEST_ORIGIN}/api/staff/settings/embed-allowlist`, {
        headers: { cookie: staff.header() },
      }),
    );
    expect(((await refused.json()) as Record<string, unknown>).origins).toBeUndefined();
  });

  it("rejects invalid writes with actionable validation feedback, changing nothing", async () => {
    const owner = await staffJar(OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    const before = (await getAllowlist(owner)).origins;

    const cases: [unknown, string][] = [
      ["not a list", "list of website addresses"],
      [[42], "web address"],
      [["http://insecure.example"], "HTTPS"],
      [["https://user:pass@example.com"], "username or password"],
      [["https://*.example.com"], "wildcard"],
      [[COLLEGE, "https://springfieldcollege.ca/programs"], "already on the allowlist"],
      [
        [...before, ...Array.from({ length: MAX_EMBED_ALLOWLIST_ORIGINS }, (_, i) => `https://extra-${i}.example`)],
        "maximum of 20",
      ],
    ];
    for (const [payload, expected] of cases) {
      const response = await putAllowlist(owner, payload);
      expect(response.status).toBe(400);
      expect(await allowlistError(response)).toContain(expected);
    }

    // Malformed bodies fail too.
    const { PUT } = await import("../src/app/api/staff/settings/embed-allowlist/route");
    const broken = await PUT(
      new Request(`${TEST_ORIGIN}/api/staff/settings/embed-allowlist`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie: owner.header(), origin: TEST_ORIGIN },
        body: "not json",
      }),
    );
    expect(broken.status).toBe(400);

    expect((await getAllowlist(owner)).origins).toEqual(before);
  });

  it("persists a saved empty list and reports it as empty, not as the seed", async () => {
    const owner = await staffJar(OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    expect((await putAllowlist(owner, [])).status).toBe(200);
    expect(await getAllowlist(owner)).toEqual({ origins: [] });
    expect(await eligibilityAllowed(COLLEGE)).toBe(false);
    expect((await putAllowlist(owner, [COLLEGE])).status).toBe(200);
  });
});

describe("the loader and settings surface carry the feature (source contract)", () => {
  async function read(rel: string): Promise<string> {
    return readFile(path.join(repoRoot(), rel), "utf8");
  }

  it("renders nothing until eligibility is confirmed, and leaves denied pages untouched", async () => {
    const source = await read("src/widget/loader.ts");
    // The chatbot origin comes from the script tag, captured at script
    // execution time: inside a DOMContentLoaded handler currentScript is
    // null, and a host-page fallback would aim the eligibility ask (and the
    // iframe) at the embedding site's own origin — the cert76 cross-origin
    // run caught exactly that.
    const bootStart = source.indexOf("async function boot(baseScript");
    expect(bootStart).toBeGreaterThan(0);
    const capture = source.indexOf("const bootScript = document.currentScript");
    expect(capture).toBeGreaterThan(0);
    expect(capture).toBeGreaterThan(bootStart);
    expect(source.slice(bootStart, capture)).toContain("baseScript?.src ?? document.baseURI");
    // The eligibility ask precedes any DOM creation: everything from the
    // first createElement onward lives in render(), which only the confirmed
    // path calls.
    const renderStart = source.indexOf("function render(");
    expect(renderStart).toBeGreaterThan(0);
    expect(source.slice(0, renderStart)).toContain("checkEligibility");
    expect(source.slice(0, renderStart)).not.toContain("createElement");
    // The deny path returns before render is ever called.
    const gate = source.slice(source.indexOf("if (!(await checkEligibility(base)))"));
    expect(gate).toContain("return;");
    expect(gate).toContain("render(base)");
    // The diagnostic is generic — it names no decision detail.
    expect(source).toContain("The chat widget is not available on this page.");
    // The credential-free ask: no cookies ride along.
    expect(source).toContain('credentials: "omit"');
  });

  it("ships the check in the built loader without leaking the allowlist", async () => {
    const script = await readFile(path.join(repoRoot(), "public/widget/v1.js"), "utf8");
    expect(script).toContain("/api/v1/embed-eligibility");
    // Exactly one API surface in the loader (ticket 76 narrowed the old
    // "none at all" pin): the credential-free boolean eligibility check.
    expect(script.match(/api\/v1/g)).toHaveLength(1);
    expect(script).toContain("The chat widget is not available on this page.");
    // Neither the default origin nor any allowlist data ships in public code.
    expect(script).not.toContain("springfieldcollege");
    expect(script).not.toContain("origins");
    expect(script).not.toMatch(/(?:api[_-]?key|secret|password|supabase)/i);
  });

  it("mounts the allowlist card for owners only, backed by the owner-only API", async () => {
    const page = await read("src/app/dashboard/settings/page.tsx");
    expect(page).toContain("EmbedAllowlistSettings");
    expect(page).toContain('guard.staff.role === "owner"');
    expect(page).toContain("getEmbedAllowlistOrigins");
    const card = await read("src/app/dashboard/settings/embed-allowlist-settings.tsx");
    expect(card).toContain('"/api/staff/settings/embed-allowlist"');
    expect(card).toMatch(/method: "PUT"/);
    expect(card).toContain("normalizeEmbedOrigin");
  });
});
