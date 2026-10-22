/**
 * College website chat widget, version 1.
 *
 * Embedded on the college WordPress site with a single script tag. The script
 * is self-contained (styles included) and needs no configuration: it derives
 * the API base URL from its own src attribute. Visitors start anonymously;
 * the session credential lives only in this browser's localStorage.
 */

import { MAX_MESSAGE_LENGTH } from "../domain/limits";
import type { MessageRole } from "../domain/types";

interface StoredSession {
  id: string;
  token: string;
}

interface WidgetMessage {
  id: string;
  role: MessageRole;
  text: string;
  link?: string;
  createdAt: string;
}

const BOOT_MARKER = "sfc-chatbot-widget-v1";
const STORAGE_KEY = "sfc_chatbot_v1_session";

const STYLES = `
.sfcw-launcher{position:fixed;right:16px;bottom:16px;z-index:2147483000;border:0;border-radius:999px;background:#1d3a6b;color:#fff;font:600 15px/1 system-ui,sans-serif;padding:14px 20px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}
.sfcw-launcher:hover{background:#16305d}
.sfcw-panel{position:fixed;right:16px;bottom:76px;z-index:2147483000;display:flex;flex-direction:column;width:min(360px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 100px));background:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);font:15px/1.45 system-ui,sans-serif;color:#1f2933}
.sfcw-header{display:flex;align-items:center;justify-content:space-between;background:#1d3a6b;color:#fff;padding:12px 16px;border-radius:12px 12px 0 0}
.sfcw-title{font-size:16px;font-weight:600}
.sfcw-close{border:0;background:transparent;color:#fff;font-size:20px;line-height:1;cursor:pointer;padding:4px 8px;border-radius:6px}
.sfcw-close:hover{background:rgba(255,255,255,.15)}
.sfcw-intro{padding:12px 16px 0;color:#52606d;font-size:14px}
.sfcw-log{flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:8px}
.sfcw-msg{max-width:85%;padding:8px 12px;border-radius:12px;white-space:pre-wrap;overflow-wrap:break-word}
.sfcw-msg--visitor{align-self:flex-end;background:#1d3a6b;color:#fff;border-bottom-right-radius:4px}
.sfcw-msg--bot,.sfcw-msg--staff{align-self:flex-start;background:#e4e9f1;color:#1f2933;border-bottom-left-radius:4px}
.sfcw-msg a{color:#1d3a6b}
.sfcw-status{min-height:20px;padding:0 16px;color:#a8342a;font-size:13px}
.sfcw-form{display:flex;gap:8px;padding:12px 16px;border-top:1px solid #e4e9f1}
.sfcw-input{flex:1;resize:none;font:inherit;padding:8px 10px;border:1px solid #cbd2dc;border-radius:8px}
.sfcw-input:focus-visible{outline:2px solid #1d3a6b}
.sfcw-send{border:0;border-radius:8px;background:#1d3a6b;color:#fff;font:600 14px system-ui,sans-serif;padding:0 16px;cursor:pointer}
.sfcw-send:disabled{opacity:.5;cursor:default}
.sfcw-sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
@media (max-width:480px){.sfcw-panel{right:8px;left:8px;bottom:72px;width:auto;max-height:calc(100vh - 88px)}}
`;

function text<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  parent.appendChild(element);
  return element;
}

function boot(): void {
  if (document.querySelector(`.${BOOT_MARKER}, script[data-sfc-chatbot="1"]`)) {
    return;
  }
  const currentScript = document.currentScript as HTMLScriptElement | null;
  if (currentScript) {
    currentScript.dataset.sfcChatbot = "1";
  }

  const base = new URL(currentScript?.src ?? document.baseURI, document.baseURI).origin;

  const style = text(document.head, "style");
  style.textContent = STYLES;

  const launcher = text(document.body, "button", `sfcw-launcher ${BOOT_MARKER}`);
  launcher.type = "button";
  launcher.textContent = "Chat";
  launcher.setAttribute("aria-label", "Chat with the college");
  launcher.setAttribute("aria-expanded", "false");

  const panel = text(document.body, "section", "sfcw-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Chat with the college");
  panel.hidden = true;

  const header = text(panel, "div", "sfcw-header");
  const title = text(header, "span", "sfcw-title");
  title.textContent = "Chat with us";
  const closeButton = text(header, "button", "sfcw-close");
  closeButton.type = "button";
  closeButton.textContent = "\u00d7";
  closeButton.setAttribute("aria-label", "Close chat");

  const intro = text(panel, "p", "sfcw-intro");
  intro.textContent = "Ask us about admissions, courses, or fees.";

  const log = text(panel, "div", "sfcw-log");
  log.setAttribute("role", "log");
  log.setAttribute("aria-label", "Messages");
  log.setAttribute("aria-live", "polite");

  const status = text(panel, "p", "sfcw-status");
  status.setAttribute("role", "status");

  const form = text(panel, "form", "sfcw-form") as HTMLFormElement;
  const label = text(form, "label", "sfcw-sr-only");
  label.htmlFor = "sfcw-question";
  label.textContent = "Your question";
  const input = text(form, "textarea", "sfcw-input") as HTMLTextAreaElement;
  input.id = "sfcw-question";
  input.rows = 2;
  input.maxLength = MAX_MESSAGE_LENGTH;
  input.placeholder = "Type your question";
  const send = text(form, "button", "sfcw-send") as HTMLButtonElement;
  send.type = "submit";
  send.textContent = "Send";

  function readSession(): StoredSession | null {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw) as Partial<StoredSession>;
      if (typeof session.id === "string" && typeof session.token === "string") {
        return { id: session.id, token: session.token };
      }
      return null;
    } catch {
      return null;
    }
  }

  function writeSession(session: StoredSession): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Storage can be unavailable (private browsing). The chat still works
      // for this page view; history just will not survive a reload.
    }
  }

  function clearSession(): void {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore; nothing to clear.
    }
  }

  function renderMessage(message: Pick<WidgetMessage, "role" | "text" | "link">): void {
    const bubble = text(log, "p", `sfcw-msg sfcw-msg--${message.role}`);
    bubble.textContent = message.text;
    if (message.link && /^https?:\/\//i.test(message.link)) {
      const anchor = text(bubble, "a");
      anchor.href = message.link;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = "Visit the college page";
    }
    log.scrollTop = log.scrollHeight;
  }

  async function ensureSession(): Promise<StoredSession | null> {
    const existing = readSession();
    if (existing) return existing;
    try {
      const response = await fetch(`${base}/api/v1/conversations`, { method: "POST" });
      if (!response.ok) {
        showError();
        return null;
      }
      const conversation = (await response.json()) as StoredSession;
      writeSession(conversation);
      return conversation;
    } catch {
      showError();
      return null;
    }
  }

  async function loadHistory(session: StoredSession): Promise<boolean> {
    try {
      const response = await fetch(`${base}/api/v1/conversations/${encodeURIComponent(session.id)}/messages`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (response.status === 401 || response.status === 404) {
        clearSession();
        return true; // Session expired; a fresh conversation starts on next ask.
      }
      if (!response.ok) {
        showError();
        return false;
      }
      const body = (await response.json()) as { messages: WidgetMessage[] };
      for (const message of body.messages) {
        renderMessage(message);
      }
      return true;
    } catch {
      showError();
      return false;
    }
  }

  function showError(): void {
    status.textContent = "The chat is temporarily unavailable. Please try again.";
  }

  function clearError(): void {
    status.textContent = "";
  }

  async function openPanel(): Promise<void> {
    panel.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    input.focus();
    if (log.childElementCount === 0) {
      const session = readSession();
      if (session) {
        await loadHistory(session);
      }
    }
  }

  function closePanel(): void {
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus();
  }

  launcher.addEventListener("click", () => {
    if (panel.hidden) {
      void openPanel();
    } else {
      closePanel();
    }
  });

  closeButton.addEventListener("click", closePanel);

  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closePanel();
    }
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (question.length === 0 || question.length > MAX_MESSAGE_LENGTH) {
      return;
    }
    const session = await ensureSession();
    if (!session) return;

    clearError();
    renderMessage({ role: "visitor", text: question });
    input.value = "";
    send.disabled = true;
    try {
      const response = await fetch(
        `${base}/api/v1/conversations/${encodeURIComponent(session.id)}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({ text: question }),
        },
      );
      if (response.status === 401 || response.status === 404) {
        clearSession();
        showError();
        return;
      }
      if (!response.ok) {
        showError();
        return;
      }
      const body = (await response.json()) as { reply: WidgetMessage };
      renderMessage(body.reply);
    } catch {
      showError();
    } finally {
      send.disabled = false;
      input.focus();
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
