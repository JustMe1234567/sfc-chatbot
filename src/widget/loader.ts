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
   lands immediately. */
const STYLES = `
.sfcw-launcher{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:56px;height:56px;border:0;border-radius:14px;background:#fff;color:#1d4e89;padding:8px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);display:inline-flex;align-items:center;justify-content:center}
.sfcw-launcher:hover{background:#f5f7fa}
.sfcw-launcher:active{transform:translateY(1px)}
.sfcw-launcher:focus-visible{outline:2px solid #e3a739;outline-offset:2px}
/* The display above would override the hidden attribute's UA style. */
.sfcw-launcher[hidden]{display:none}
/* The launcher's white surface is the plate that keeps the blue crest legible
   on arbitrary host-page backgrounds (ticket 40). */
.sfcw-launcher img{width:40px;height:40px;display:block;object-fit:contain}
.sfcw-launcher-close{width:28px;height:28px;display:none;align-items:center;justify-content:center;font:400 28px/1 system-ui,sans-serif}
.sfcw-launcher[aria-expanded="true"] img{display:none}
.sfcw-launcher[data-closing="true"] img{display:none}
.sfcw-launcher[aria-expanded="true"] .sfcw-launcher-close{display:flex}
.sfcw-launcher[data-closing="true"] .sfcw-launcher-close{display:flex}
.sfcw-frame{position:fixed;right:16px;bottom:76px;z-index:2147483000;display:block;border:0;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);background:#fff;width:min(360px,calc(100vw - 32px));height:min(560px,calc(100vh - 100px));opacity:0;transform:translateY(10px) scale(.98);transition:opacity 180ms cubic-bezier(.2,.8,.2,1),transform 180ms cubic-bezier(.2,.8,.2,1)}
.sfcw-frame.sfcw-frame-in{opacity:1;transform:none}
.sfcw-frame[hidden]{display:none}
@media (prefers-reduced-motion:reduce){.sfcw-frame{transition-duration:0ms}.sfcw-launcher:active{transform:none}}
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

  // The iframe stays mounted when closed. Tell it whether the panel and host
  // page are visible so it can keep a live conversation responsive without
  // polling full history at the same rate while idle.
  function sendFrameState(): void {
    frame.contentWindow?.postMessage(
      { type: "sfcw:state", open: isOpen, visible: document.visibilityState === "visible" },
      base,
    );
  }
  frame.addEventListener("load", sendFrameState);
  document.addEventListener("visibilitychange", sendFrameState);

  function openFrame(): void {
    isOpen = true;
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
    sendFrameState();
    frame.contentWindow?.focus();
  }

  function close(): void {
    isOpen = false;
    frame.classList.remove("sfcw-frame-in");
    // Keep the close affordance until the fading frame (and its crest) is
    // display-hidden, so the launcher crest never duplicates it on screen.
    launcher.dataset.closing = "true";
    launcher.setAttribute("aria-label", "Chat with Springfield College");
    launcher.setAttribute("aria-expanded", "false");
    sendFrameState();
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

  // The frame requests its own closure (for example on Escape) and asks for
  // the latest visibility state after hydration; only accept messages from
  // this widget's iframe on the chatbot origin.
  window.addEventListener("message", (event) => {
    if (event.origin !== base || event.source !== frame.contentWindow) {
      return;
    }
    if ((event.data as { type?: string } | null)?.type === "sfcw:ready") {
      sendFrameState();
    } else if ((event.data as { type?: string } | null)?.type === "sfcw:close") {
      close();
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
