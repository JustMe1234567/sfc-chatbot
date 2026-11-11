/**
 * College website chat widget loader, version 1.
 *
 * Embedded on the college WordPress site with a single script tag. The loader
 * only renders a launcher button and a cross-origin iframe pointing at the
 * chatbot origin, so the visitor session credential lives in iframe-origin
 * session storage — never in WordPress page storage — and no API call or
 * secret ever happens in the WordPress page context.
 */

const BOOT_MARKER = "sfc-chatbot-widget-v1";

/* Motion values match the frame app and dashboard tokens (ticket 15): one
   160ms ease-out for the panel. Under prefers-reduced-motion the panel
   lands immediately.
   The chathead's look (ticket 70, dimensions from ticket 71) rides CSS
   custom properties with the confirmed defaults inline — background
   #013C78, 48px icon, 4px padding, 64 × 64 container — so a missing
   branding message leaves exactly those. The foreground and the focus ring
   share the automatically chosen color; the hover lifts brightness, which
   reads on any background without needing a second configurable color.
   The corner radius keeps the rounded-square proportion: 25% of the
   smaller dimension, square or rectangular. The opened frame hangs above
   the configured height; its right edge stays viewport-anchored, which
   holds the widest launcher (96px) fully on screen at every supported
   width. */
const STYLES = `
.sfcw-launcher{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:var(--sfcw-w,64px);height:var(--sfcw-h,64px);border:0;border-radius:calc(min(var(--sfcw-w,64px),var(--sfcw-h,64px)) * .25);background:var(--sfcw-bg,#013c78);color:var(--sfcw-fg,#fff);padding:var(--sfcw-pad,4px);cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);display:inline-flex;align-items:center;justify-content:center}
.sfcw-launcher:hover{filter:brightness(1.15)}
.sfcw-launcher:active{transform:translateY(1px)}
.sfcw-launcher:focus-visible{outline:2px solid var(--sfcw-fg,#fff);outline-offset:2px}
/* The display above would override the hidden attribute's UA style. */
.sfcw-launcher[hidden]{display:none}
.sfcw-launcher img{width:var(--sfcw-icon,48px);height:var(--sfcw-icon,48px);display:block;object-fit:contain}
.sfcw-launcher-close{width:28px;height:28px;display:none;align-items:center;justify-content:center;font:400 28px/1 system-ui,sans-serif}
.sfcw-launcher[aria-expanded="true"] img{display:none}
.sfcw-launcher[data-closing="true"] img{display:none}
.sfcw-launcher[aria-expanded="true"] .sfcw-launcher-close{display:flex}
.sfcw-launcher[data-closing="true"] .sfcw-launcher-close{display:flex}
.sfcw-frame{position:fixed;right:16px;bottom:calc(16px + var(--sfcw-h,64px) + 4px);z-index:2147483000;display:block;border:0;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);background:#fff;width:min(360px,calc(100vw - 32px));height:min(560px,calc(100vh - 100px));opacity:0;transform:translateY(10px) scale(.98);transition:opacity 180ms cubic-bezier(.2,.8,.2,1),transform 180ms cubic-bezier(.2,.8,.2,1)}
.sfcw-frame.sfcw-frame-in{opacity:1;transform:none}
.sfcw-frame[hidden]{display:none}
@media (prefers-reduced-motion:reduce){.sfcw-frame{transition-duration:0ms}.sfcw-launcher:active{transform:none}}
@media (max-width:480px){.sfcw-frame{right:8px;left:8px;bottom:calc(8px + var(--sfcw-h,64px) + 8px);width:calc(100vw - 16px);height:calc(100vh - 88px)}}
`;

function boot(): void {
  // Load once, even if the script tag is duplicated on a page.
  if (document.querySelector(`.${BOOT_MARKER}`)) {
    return;
  }
  const currentScript = document.currentScript as HTMLScriptElement | null;
  if (currentScript) {
    currentScript.dataset.sfcChatbot = "1";
  }

  const base = new URL(currentScript?.src ?? document.baseURI, document.baseURI).origin;

  const style = document.createElement("style");
  style.textContent = STYLES;
  document.head.appendChild(style);

  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = `sfcw-launcher ${BOOT_MARKER}`;
  // The compact crest travels with the chatbot origin (ticket 16). Ticket 40
  // makes the launcher icon-only; aria-label below carries its accessible name.
  const crest = document.createElement("img");
  crest.src = `${base}/brand/cropped-SFC-Final-Logo-Single.png`;
  crest.alt = "";
  const closeIcon = document.createElement("span");
  closeIcon.className = "sfcw-launcher-close";
  closeIcon.textContent = "×";
  closeIcon.setAttribute("aria-hidden", "true");
  launcher.appendChild(crest);
  launcher.appendChild(closeIcon);
  launcher.setAttribute("aria-label", "Chat with Springfield College");
  launcher.setAttribute("aria-expanded", "false");
  document.body.appendChild(launcher);

  // Created up front but hidden: the iframe keeps its session and history
  // across open/close for the life of the page.
  const frame = document.createElement("iframe");
  frame.className = "sfcw-frame";
  frame.src = `${base}/widget/frame`;
  frame.title = "Chat with Springfield College";
  frame.hidden = true;
  document.body.appendChild(frame);

  /* Open/close with a subtle transition (ticket 15): the frame starts from
     its invisible style each open and slides in; closing reverses and only
     then display-hides it. A pending hide timer is what keeps rapid
     toggling correct — reopening cancels it, so the panel always ends in
     the state of the last action. */
  let hideTimer: number | undefined;
  let isOpen = false;
  // How the current open was triggered (ticket 26): the frame pins the
  // focus ring's visibility from this, because its own document has no
  // interaction history — a plain :focus-visible heuristic would show a
  // ring to mouse users there. Pointer covers touch; keyboard covers
  // Enter/Space on the focused launcher.
  let openViaKeyboard = false;
  launcher.addEventListener("pointerdown", () => {
    openViaKeyboard = false;
  });
  launcher.addEventListener("keydown", () => {
    openViaKeyboard = true;
  });

  function sendOpenState(): void {
    frame.contentWindow?.postMessage(
      { type: "sfcw:state", open: isOpen, viaKeyboard: openViaKeyboard },
      base,
    );
  }

  function openFrame(): void {
    isOpen = true;
    sendOpenState();
    delete launcher.dataset.closing;
    if (hideTimer !== undefined) {
      window.clearTimeout(hideTimer);
      hideTimer = undefined;
    }
    frame.hidden = false;
    // Two frames: the just-shown element must commit its invisible style
    // before the transition to visible can run.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (isOpen) {
          frame.classList.add("sfcw-frame-in");
        }
      });
    });
    launcher.setAttribute("aria-label", "Close chat");
    launcher.setAttribute("aria-expanded", "true");
    frame.contentWindow?.focus();
  }

  function close(): void {
    isOpen = false;
    sendOpenState();
    frame.classList.remove("sfcw-frame-in");
    // Keep the close affordance until the fading frame (and its crest) is
    // display-hidden, so the launcher crest never duplicates it on screen.
    launcher.dataset.closing = "true";
    launcher.setAttribute("aria-label", "Chat with Springfield College");
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus();
    if (hideTimer !== undefined) {
      window.clearTimeout(hideTimer);
    }
    // One animation frame of slack beyond the 180ms transition so the fade
    // always finishes before display:none.
    hideTimer = window.setTimeout(() => {
      frame.hidden = true;
      delete launcher.dataset.closing;
      hideTimer = undefined;
    }, 200);
  }

  launcher.addEventListener("click", () => {
    if (isOpen) {
      close();
    } else {
      openFrame();
    }
  });

  // The frame requests its own closure (for example on Escape) and, once
  // hydrated, asks for the panel's open state (ticket 61). Only messages
  // from the chatbot origin AND the widget iframe's own window count.
  window.addEventListener("message", (event) => {
    if (event.origin !== base || event.source !== frame.contentWindow) {
      return;
    }
    const type = (event.data as { type?: string } | null)?.type;
    if (type === "sfcw:ready") {
      sendOpenState();
    } else if (type === "sfcw:close") {
      close();
    } else if (type === "sfcw:branding") {
      // The configured branding (ticket 70) arrives from the frame — the
      // loader itself makes no API calls (the security property the embed
      // pins guard), so the widget surface that already talks to the
      // chatbot origin forwards the public values here. A missing or junk
      // message leaves the bundled defaults already painted.
      const payload = (event.data as { config?: unknown } | null)?.config;
      if (typeof payload !== "object" || payload === null) {
        return;
      }
      const { chatbotIconUrl, chathead } = payload as {
        chatbotIconUrl?: unknown;
        chathead?: Record<string, unknown> | null;
      };
      if (
        typeof chatbotIconUrl === "string" &&
        chatbotIconUrl.startsWith("/") &&
        chatbotIconUrl.length <= 200
      ) {
        crest.src = new URL(chatbotIconUrl, base).href;
      }
      if (typeof chathead !== "object" || chathead === null) {
        return;
      }
      const { backgroundColor, foreground, iconSize, padding, width, height } = chathead;
      if (typeof backgroundColor === "string" && backgroundColor.length <= 9) {
        launcher.style.setProperty("--sfcw-bg", backgroundColor);
      }
      if (typeof foreground === "string" && foreground.length <= 9) {
        launcher.style.setProperty("--sfcw-fg", foreground);
      }
      if (typeof iconSize === "number" && iconSize > 0 && iconSize <= 128) {
        launcher.style.setProperty("--sfcw-icon", `${iconSize}px`);
      }
      if (typeof padding === "number" && padding >= 0 && padding <= 32) {
        launcher.style.setProperty("--sfcw-pad", `${padding}px`);
      }
      if (typeof width === "number" && width >= 24 && width <= 192) {
        launcher.style.setProperty("--sfcw-w", `${width}px`);
      }
      if (typeof height === "number" && height >= 24 && height <= 192) {
        launcher.style.setProperty("--sfcw-h", `${height}px`);
        // The opened frame hangs above the configured height.
        frame.style.setProperty("--sfcw-h", `${height}px`);
      }
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
