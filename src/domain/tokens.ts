import { createHash, randomBytes } from "node:crypto";
import { envMs } from "./limits";

/** Visitor credentials are short-lived and scoped to one conversation. */
export const VISITOR_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** Mailed return links live one day: long enough to come back, not longer. */
export const RETURN_LINK_TTL_MS = 24 * 60 * 60 * 1000;

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionExpiry(): string {
  return new Date(Date.now() + VISITOR_SESSION_TTL_MS).toISOString();
}

export function returnLinkExpiry(): string {
  // RETURN_LINK_TTL_MS lets tests age a link out deterministically.
  return new Date(Date.now() + envMs("RETURN_LINK_TTL_MS", RETURN_LINK_TTL_MS)).toISOString();
}
