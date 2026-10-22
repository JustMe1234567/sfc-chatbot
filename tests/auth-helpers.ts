import { TOTP, URI } from "otpauth";
import { useTempDatabase, TEST_ORIGIN } from "./helpers";

/**
 * Cookie jar + request helpers for driving the real better-auth HTTP handler
 * the way a browser dashboard would (cookie-authenticated), so flows are
 * tested at the HTTP seam rather than through server-internal APIs.
 */
export class CookieJar {
  private cookies = new Map<string, string>();

  update(response: Response): void {
    for (const setCookie of response.headers.getSetCookie()) {
      const [rawPair] = setCookie.split(";");
      const pair = rawPair ?? "";
      const separator = pair.indexOf("=");
      if (separator === -1) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (value === "") {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

let requestCounter = 0;

export async function authRequest(
  jar: CookieJar | null,
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown; ip?: string } = {},
): Promise<Response> {
  const { POST, GET } = await import("../src/app/api/auth/[...all]/route");
  const method = options.method ?? "POST";
  // Rotate client IPs unless a test pins one: the app rate-limits sign-in
  // per IP, and sequential flow tests act as different clients.
  const ip = options.ip ?? `10.99.${Math.floor(requestCounter / 250) % 250}.${(++requestCounter) % 250}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-forwarded-for": ip,
    origin: TEST_ORIGIN,
  };
  const cookie = jar?.header();
  if (cookie) {
    headers.cookie = cookie;
  }
  const request = new Request(`${TEST_ORIGIN}${path}`, {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const response = method === "POST" ? await POST(request) : await GET(request);
  jar?.update(response);
  return response;
}

export async function staffApiRequest(
  jar: CookieJar,
  path: string,
): Promise<Response> {
  const cookie = jar.header();
  const request = new Request(`${TEST_ORIGIN}${path}`, {
    headers: { ...(cookie ? { cookie } : {}) },
  });
  const match = path.match(/^\/api\/staff\/conversations\/([^/]+)$/);
  if (match?.[1]) {
    const { GET } = await import("../src/app/api/staff/conversations/[id]/route");
    return GET(request, { params: Promise.resolve({ id: match[1] }) });
  }
  const { GET } = await import("../src/app/api/staff/conversations/route");
  return GET(request);
}

export async function provisionStaff(input: {
  email: string;
  password: string;
  name: string;
  role?: "owner" | "staff" | "editor";
}): Promise<{ userId: string; email: string; role: string }> {
  const { getChatbotService } = await import("../src/db/service");
  const { auth, db } = await getChatbotService();
  const { provisionStaffMember } = await import("../src/auth/provision");
  return provisionStaffMember(auth, db, {
    email: input.email,
    password: input.password,
    name: input.name,
    role: input.role ?? "staff",
  });
}

/** Full second-factor enrollment for a provisioned, verified staff member. */
export async function enrollTotp(
  jar: CookieJar,
  email: string,
  password: string,
): Promise<TOTP> {
  const signIn = await authRequest(jar, "/api/auth/sign-in/email", {
    body: { email, password },
  });
  if (!signIn.ok) {
    throw new Error(`enroll sign-in failed: ${signIn.status} ${await signIn.text()}`);
  }
  const enable = await authRequest(jar, "/api/auth/two-factor/enable", {
    body: { password, method: "totp", issuer: "Example College chat" },
  });
  const enabled = (await enable.json()) as { totpURI?: string };
  if (!enable.ok || !enabled.totpURI) {
    throw new Error(`totp enable failed: ${enable.status} ${JSON.stringify(enabled)}`);
  }
  const totp = URI.parse(enabled.totpURI) as TOTP;
  const verify = await authRequest(jar, "/api/auth/two-factor/verify-totp", {
    body: { code: totp.generate() },
  });
  if (!verify.ok) {
    throw new Error(`totp verify failed: ${verify.status} ${await verify.text()}`);
  }
  await authRequest(jar, "/api/auth/sign-out");
  return totp;
}

/** Password + TOTP sign-in, leaving the jar holding a dashboard session. */
export async function signInWithTotp(
  jar: CookieJar,
  email: string,
  password: string,
  totp: TOTP,
): Promise<void> {
  const signIn = await authRequest(jar, "/api/auth/sign-in/email", {
    body: { email, password },
  });
  const result = (await signIn.json()) as { twoFactorRedirect?: boolean; twoFactor?: boolean };
  if (!signIn.ok || !(result.twoFactorRedirect || result.twoFactor)) {
    throw new Error(`expected two-factor challenge: ${signIn.status} ${JSON.stringify(result)}`);
  }
  const verify = await authRequest(jar, "/api/auth/two-factor/verify-totp", {
    body: { code: totp.generate() },
  });
  if (!verify.ok) {
    throw new Error(`totp sign-in failed: ${verify.status} ${await verify.text()}`);
  }
}

export async function latestOutboxMail(): Promise<{ to: string; subject: string; body: string }> {
  const { getChatbotService } = await import("../src/db/service");
  const { db } = await getChatbotService();
  const row = db
    .prepare("SELECT to_address, subject, body FROM mail_outbox ORDER BY rowid DESC LIMIT 1")
    .get() as { to_address: string; subject: string; body: string };
  if (!row) {
    throw new Error("outbox is empty");
  }
  return { to: row.to_address, subject: row.subject, body: row.body };
}

export { useTempDatabase };
