/**
 * The visitor credential in chatbot-origin sessionStorage. Shared by the
 * chat frame (which lives in it) and the /return landing page (which writes
 * a redeemed session into it before redirecting into the frame).
 */
export const STORAGE_KEY = "sfc_chatbot_v1_session";

export interface StoredSession {
  id: string;
  token: string;
  expiresAt: string;
}

export function readSession(): StoredSession | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const session = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof session.id === "string" &&
      typeof session.token === "string" &&
      typeof session.expiresAt === "string"
    ) {
      if (new Date(session.expiresAt).getTime() <= Date.now()) {
        window.sessionStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return { id: session.id, token: session.token, expiresAt: session.expiresAt };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeSession(session: StoredSession): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage can be unavailable (blocked cookies); the chat still works for
    // this page view, but history will not survive a reload.
  }
}

export function dropSession(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
