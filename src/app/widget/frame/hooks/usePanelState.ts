"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * The widget panel's open state (ticket 33 extraction of the frame page):
 * whether the chat panel is showing, the loader handshake that reports it,
 * and the frame-side close request.
 */
export function usePanelState(
  inputRef: RefObject<HTMLTextAreaElement | null>,
  closeButtonRef: RefObject<HTMLButtonElement | null>,
): {
  panelOpen: boolean;
  requestClose: () => void;
  focusPanelTarget: (viaKeyboard: boolean) => void;
} {
  const [panelOpen, setPanelOpen] = useState(false);

  // The panel's open state comes from the loader (ticket 61): after
  // hydration the frame asks with sfcw:ready and applies only sfcw:state
  // messages its parent window sent. Outside an embed (a standalone dev
  // preview) the frame is the visible chat, so it reads as open.
  useEffect(() => {
    if (window.parent === window) {
      setPanelOpen(true);
      // The standalone preview is the open panel too (ticket 26): same
      // deliberate target under the keyboard.
      focusPanelTarget(false);
      return;
    }
    function onPanelState(event: MessageEvent): void {
      if (event.source === window.parent && event.data?.type === "sfcw:state") {
        setPanelOpen(event.data.open === true);
        if (event.data.open === true) {
          // The open landed (ticket 26): message tasks run after the loader
          // has already unhidden the frame, so the deliberate target is
          // focusable here — on every open, not just first load. The ring
          // follows the opener's modality via the loader's viaKeyboard
          // flag (absent on stale cached loaders: mouse-safe default).
          focusPanelTarget(event.data.viaKeyboard === true);
        }
      }
    }
    window.addEventListener("message", onPanelState);
    window.parent.postMessage({ type: "sfcw:ready" }, "*");
    return () => window.removeEventListener("message", onPanelState);
  }, []);

  function requestClose(): void {
    // The loader owns the iframe; Escape inside the frame asks it to close.
    if (window.parent !== window) {
      window.parent.postMessage({ type: "sfcw:close" }, "*");
    }
  }

  /**
   * Ticket 26: an open panel puts a deliberate target under the keyboard —
   * the composer when it is usable, otherwise the always-present close
   * button (fresh contact gate, or the ticket-43 waiting lock). The ring
   * follows the opener's modality: the iframe document has no interaction
   * history of its own, so the plain :focus-visible heuristic would light a
   * ring for mouse users too; focusVisible is pinned from the loader's
   * flag instead. Browsers without the option ignore it (graceful).
   */
  function focusPanelTarget(viaKeyboard: boolean): void {
    const focusOptions: FocusOptions & { focusVisible?: boolean } = {
      focusVisible: viaKeyboard,
    };
    const input = inputRef.current;
    if (input && !input.disabled) {
      input.focus(focusOptions);
      return;
    }
    closeButtonRef.current?.focus(focusOptions);
  }

  return { panelOpen, requestClose, focusPanelTarget };
}
