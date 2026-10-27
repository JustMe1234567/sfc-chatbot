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

const STYLES = `
.sfcw-launcher{position:fixed;right:16px;bottom:16px;z-index:2147483000;border:0;border-radius:999px;background:#1d4e89;color:#fff;font:600 15px/1 system-ui,sans-serif;padding:9px 18px 9px 11px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);display:inline-flex;align-items:center;gap:8px}
.sfcw-launcher:hover{background:#163c6b}
.sfcw-launcher:focus-visible{outline:2px solid #e3a739;outline-offset:2px}
/* The display above would override the hidden attribute's UA style. */
.sfcw-launcher[hidden]{display:none}
/* White plate: the crest's blue shield would vanish on the same-hue button. */
.sfcw-launcher img{width:24px;height:24px;display:block;background:#fff;border-radius:6px;padding:1px}
.sfcw-frame{position:fixed;right:16px;bottom:76px;z-index:2147483000;display:block;border:0;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);background:#fff;width:min(360px,calc(100vw - 32px));height:min(560px,calc(100vh - 100px))}
.sfcw-frame[hidden]{display:none}
@media (max-width:480px){.sfcw-frame{right:8px;left:8px;bottom:72px;width:calc(100vw - 16px);height:calc(100vh - 88px)}}
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
  // The compact crest travels with the chatbot origin (ticket 16); the label
  // text next to it carries the accessible name.
  const crest = document.createElement("img");
  crest.src = `${base}/brand/cropped-SFC-Final-Logo-Single.png`;
  crest.alt = "";
  const label = document.createElement("span");
  label.textContent = "Chat";
  launcher.appendChild(crest);
  launcher.appendChild(label);
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

  function close(): void {
    frame.hidden = true;
    launcher.hidden = false;
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus();
  }

  launcher.addEventListener("click", () => {
    frame.hidden = false;
    // The open frame carries the crest in its own header; hiding the launcher
    // avoids repeating the brand mark while the chat is on screen.
    launcher.hidden = true;
    launcher.setAttribute("aria-expanded", "true");
    frame.contentWindow?.focus();
  });

  // The frame requests its own closure (for example on Escape); only accept
  // messages from the chatbot origin.
  window.addEventListener("message", (event) => {
    if (event.origin === base && (event.data as { type?: string } | null)?.type === "sfcw:close") {
      close();
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
