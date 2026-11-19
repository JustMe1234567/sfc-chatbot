import { randomUUID } from "node:crypto";
import { countQuery, TEST_ORIGIN, useTempDatabase } from "./helpers";
import { registerFakeStaff } from "./fake-auth-provider";

/**
 * Cookie jar + request helpers for driving the authentication provider HTTP seam
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
  options: { method?: "GET" | "POST"; body?: unknown; ip?: string; userAgent?: string } = {},
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
    // The login log captures the browser's user agent (ticket 81); a fixed
    // synthetic value keeps those assertions deterministic, overridable per
    // request when a test proves the pass-through.
    "user-agent": options.userAgent ?? "sfc-test-suite/1",
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
  const { db } = await getChatbotService();
  const userId = randomUUID();
  const authUserId = randomUUID();
  const username = input.email.split("@")[0]!.toLowerCase();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO staff_members
     ("id", "name", "email", "username", "emailVerified", "createdAt", "updatedAt", "role",
      "banned", "supabaseUserId", "invitationStatus")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId,
    input.name,
    `${userId}@staff.invalid`,
    username,
    true,
    now,
    now,
    input.role ?? "staff",
    false,
    authUserId,
    "accepted",
  );
  registerFakeStaff({
    userId: authUserId,
    username,
    name: input.name,
    password: input.password,
  });
  return { userId, email: input.email, role: input.role ?? "staff" };
}

/** Password-only sign-in, leaving the jar holding a dashboard session. */
export async function signInAs(
  jar: CookieJar,
  login: string,
  password: string,
): Promise<void> {
  const username = login.includes("@") ? login.split("@")[0]!.toLowerCase() : login.toLowerCase();
  const signIn = await authRequest(jar, "/api/auth/sign-in/username", {
    body: { username, password },
  });
  if (!signIn.ok) {
    throw new Error(`sign-in failed: ${signIn.status} ${await signIn.text()}`);
  }
}

export async function latestOutboxMail(): Promise<{ to: string; subject: string; body: string }> {
  const { getChatbotService } = await import("../src/db/service");
  const { db } = await getChatbotService();
  const row = await db.get<{ to_address: string; subject: string; body: string }>(
    countQuery(
      "SELECT to_address, subject, body FROM mail_outbox ORDER BY seq DESC LIMIT 1",
      "SELECT to_address, subject, body FROM mail_outbox ORDER BY rowid DESC LIMIT 1",
    ),
  );
  if (!row) {
    throw new Error("outbox is empty");
  }
  return { to: row.to_address, subject: row.subject, body: row.body };
}

export { useTempDatabase };
