"use client";

import { useRef, useState } from "react";
import PendingButton from "../pending-button";
import {
  chatheadForeground,
  chatheadOuterSize,
  CHATHEAD_DEFAULTS,
  MAX_BRANDING_IMAGE_BYTES,
  normalizeHexColor,
  parseBrandingImageDataUrl,
} from "@/domain/branding";
import styles from "../dashboard.module.css";

export interface BrandingInitial {
  chatbotIconUrl: string;
  faviconUrl: string;
  chathead: {
    backgroundColor: string;
    iconSize: number;
    padding: number;
    outerSize: number;
    foreground: string;
  };
}

type SaveAction = "save" | "reset";

interface PutResult {
  ok: boolean;
  data: {
    ok?: boolean;
    reset?: boolean;
    version?: string;
    chathead?: { backgroundColor: string; iconSize: number; padding: number };
    error?: { code: string; message: string };
  };
}

async function putJson(url: string, body: unknown): Promise<PutResult> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, data: (await response.json().catch(() => ({}))) as PutResult["data"] };
}

/** Reads one chosen file into a data URL (null when the reader fails). */
function readFileDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/**
 * The branding forms (ticket 70): two independent upload cards and the
 * chathead appearance card. Validation runs client-side for immediate
 * feedback with the same domain validator the server applies — the server
 * remains authoritative. The icon and favicon saves/resets are independent
 * by construction: each card talks to its own endpoint and keeps its own
 * state, so resetting one never touches the other.
 */
export default function BrandingSettings({ initial }: { initial: BrandingInitial }) {
  const [chatbotIconUrl, setChatbotIconUrl] = useState(initial.chatbotIconUrl);
  const [faviconUrl, setFaviconUrl] = useState(initial.faviconUrl);
  const [chathead, setChathead] = useState(initial.chathead);
  const [iconAction, setIconAction] = useState<SaveAction | null>(null);
  const [faviconAction, setFaviconAction] = useState<SaveAction | null>(null);
  const [chatheadAction, setChatheadAction] = useState<SaveAction | null>(null);
  const [iconSelection, setIconSelection] = useState<string | null>(null);
  const [faviconSelection, setFaviconSelection] = useState<string | null>(null);
  const [iconStatus, setIconStatus] = useState<{ error?: string; note?: string } | null>(null);
  const [faviconStatus, setFaviconStatus] = useState<{ error?: string; note?: string } | null>(null);
  const [chatheadStatus, setChatheadStatus] = useState<{ error?: string; note?: string } | null>(null);
  const iconFileRef = useRef<HTMLInputElement>(null);
  const faviconFileRef = useRef<HTMLInputElement>(null);

  async function handleImageSelection(
    file: File | undefined,
    kind: "chatbot-icon" | "dashboard-favicon",
  ) {
    const setStatus = kind === "chatbot-icon" ? setIconStatus : setFaviconStatus;
    const setSelection = kind === "chatbot-icon" ? setIconSelection : setFaviconSelection;
    setStatus(null);
    setSelection(null);
    if (!file) {
      return;
    }
    if (file.size > MAX_BRANDING_IMAGE_BYTES) {
      setStatus({ error: "That file is over the 500 KB limit." });
      return;
    }
    const dataUrl = await readFileDataUrl(file);
    // The same content validator the server applies: type comes from the
    // decoded bytes, never the file's name or reported type.
    if (!dataUrl || !parseBrandingImageDataUrl(dataUrl)) {
      setStatus({ error: "Choose a PNG, JPEG, or WebP image up to 500 KB." });
      return;
    }
    setSelection(dataUrl);
  }

  async function saveImage(kind: "chatbot-icon" | "dashboard-favicon", action: SaveAction) {
    const isIcon = kind === "chatbot-icon";
    const setAction = isIcon ? setIconAction : setFaviconAction;
    const setStatus = isIcon ? setIconStatus : setFaviconStatus;
    const setUrl = isIcon ? setChatbotIconUrl : setFaviconUrl;
    const selection = isIcon ? iconSelection : faviconSelection;
    if (action === "save" && !selection) {
      return;
    }
    setAction(action);
    setStatus(null);
    try {
      const result = await putJson(`/api/staff/settings/branding/${kind}`, {
        image: action === "reset" ? null : selection,
      });
      if (!result.ok) {
        setStatus({ error: result.data.error?.message ?? "The image could not be saved." });
        return;
      }
      if (result.data.version) {
        setUrl(`/api/branding/${kind}?v=${encodeURIComponent(result.data.version)}`);
      }
      if (isIcon) {
        setIconSelection(null);
        iconFileRef.current!.value = "";
      } else {
        setFaviconSelection(null);
        faviconFileRef.current!.value = "";
      }
      setStatus({ note: result.data.reset ? "Reset to the bundled image." : "Saved." });
    } catch {
      setStatus({ error: "The image could not be saved. Check the connection and try again." });
    } finally {
      setAction(null);
    }
  }

  async function saveChathead(action: SaveAction) {
    setChatheadAction(action);
    setChatheadStatus(null);
    try {
      const result = await putJson(
        "/api/staff/settings/branding/chathead",
        action === "reset"
          ? null
          : {
              chathead: {
                backgroundColor: normalizeHexColor(chathead.backgroundColor),
                iconSize: chathead.iconSize,
                padding: chathead.padding,
              },
            },
      );
      if (!result.ok) {
        setChatheadStatus({
          error: result.data.error?.message ?? "The appearance could not be saved.",
        });
        return;
      }
      if (result.data.chathead) {
        const saved = result.data.chathead;
        setChathead({
          backgroundColor: saved.backgroundColor,
          iconSize: saved.iconSize,
          padding: saved.padding,
          outerSize: chatheadOuterSize(saved),
          foreground: chatheadForeground(saved.backgroundColor),
        });
      } else {
        // Reset: the endpoint clears the row; show the confirmed defaults.
        setChathead({
          backgroundColor: CHATHEAD_DEFAULTS.backgroundColor,
          iconSize: CHATHEAD_DEFAULTS.iconSize,
          padding: CHATHEAD_DEFAULTS.padding,
          outerSize: chatheadOuterSize(CHATHEAD_DEFAULTS),
          foreground: chatheadForeground(CHATHEAD_DEFAULTS.backgroundColor),
        });
      }
      setChatheadStatus({ note: action === "reset" ? "Reset to the defaults." : "Saved." });
    } catch {
      setChatheadStatus({ error: "The appearance could not be saved. Check the connection and try again." });
    } finally {
      setChatheadAction(null);
    }
  }

  const hex = normalizeHexColor(chathead.backgroundColor) ?? chathead.backgroundColor;

  return (
    <div className={styles.settingsGrid}>
      <section className={styles.ruleCard} aria-labelledby="branding-chathead-title">
        <h2 id="branding-chathead-title">
          Chatbot icon and chathead
        </h2>
        <p className={styles.hint}>
          The icon appears on the launcher, the widget header, the greeting, and the bot
          avatar on newly loaded chats. The chathead is the launcher button around it.
        </p>
        <div className={styles.settingsPreview}>
          <span
            className={styles.chatheadPreview}
            style={{
              background: chathead.backgroundColor,
              color: chathead.foreground,
              width: chathead.outerSize,
              height: chathead.outerSize,
              padding: chathead.padding,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={chatbotIconUrl} alt="" style={{ width: chathead.iconSize, height: chathead.iconSize, objectFit: "contain" }} />
          </span>
          <span className={styles.hint}>
            {chathead.outerSize} × {chathead.outerSize} px outer · foreground{" "}
            {chathead.foreground} (automatic)
          </span>
        </div>
        <div className={styles.settingsRow}>
          <label htmlFor="chathead-bg">Background</label>
          <input
            id="chathead-bg"
            type="color"
            value={hex}
            onChange={(event) =>
              setChathead((current) => ({ ...current, backgroundColor: event.target.value }))
            }
          />
          <input
            className={styles.settingsHex}
            aria-label="Background color as hex"
            value={chathead.backgroundColor}
            onChange={(event) =>
              setChathead((current) => ({ ...current, backgroundColor: event.target.value }))
            }
          />
        </div>
        <div className={styles.settingsRow}>
          <label htmlFor="chathead-icon-size">Icon size</label>
          <input
            id="chathead-icon-size"
            className={styles.settingsRange}
            type="range"
            min={32}
            max={64}
            step={1}
            value={chathead.iconSize}
            onChange={(event) =>
              setChathead((current) => ({ ...current, iconSize: Number(event.target.value) }))
            }
          />
          <output htmlFor="chathead-icon-size">{chathead.iconSize} px</output>
        </div>
        <div className={styles.settingsRow}>
          <label htmlFor="chathead-padding">Padding</label>
          <input
            id="chathead-padding"
            className={styles.settingsRange}
            type="range"
            min={0}
            max={12}
            step={1}
            value={chathead.padding}
            onChange={(event) =>
              setChathead((current) => ({ ...current, padding: Number(event.target.value) }))
            }
          />
          <output htmlFor="chathead-padding">{chathead.padding} px</output>
        </div>
        {chatheadStatus?.error ? (
          <p className={styles.contactError} role="alert">
            {chatheadStatus.error}
          </p>
        ) : null}
        {chatheadStatus?.note ? (
          <p className={styles.hint} role="status">
            {chatheadStatus.note}
          </p>
        ) : null}
        <div className={styles.settingsActions}>
          <PendingButton
            pending={chatheadAction === "save"}
            pendingLabel="Saving…"
            className={styles.primaryButton}
            onClick={() => void saveChathead("save")}
          >
            Save appearance
          </PendingButton>
          <PendingButton
            pending={chatheadAction === "reset"}
            pendingLabel="Resetting…"
            className={styles.secondaryButton}
            onClick={() => void saveChathead("reset")}
          >
            Reset appearance
          </PendingButton>
        </div>
      </section>

      <section className={styles.ruleCard} aria-labelledby="branding-icon-title">
        <h2 id="branding-icon-title">
          Chatbot icon
        </h2>
        <p className={styles.hint}>
          PNG, JPEG, or WebP up to 500 KB. Applies wherever the chatbot icon appears;
          reset brings back the bundled Springfield College crest.
        </p>
        <div className={styles.settingsPreview}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.settingsPreviewImg} src={iconSelection ?? chatbotIconUrl} alt="Chatbot icon preview" />
        </div>
        <div className={styles.settingsRow}>
          <label htmlFor="chatbot-icon-file">New image</label>
          <input
            id="chatbot-icon-file"
            ref={iconFileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => void handleImageSelection(event.target.files?.[0], "chatbot-icon")}
          />
        </div>
        {iconStatus?.error ? (
          <p className={styles.contactError} role="alert">
            {iconStatus.error}
          </p>
        ) : null}
        {iconStatus?.note ? (
          <p className={styles.hint} role="status">
            {iconStatus.note}
          </p>
        ) : null}
        <div className={styles.settingsActions}>
          <PendingButton
            pending={iconAction === "save"}
            pendingLabel="Saving…"
            className={styles.primaryButton}
            disabled={!iconSelection || iconAction !== null}
            onClick={() => void saveImage("chatbot-icon", "save")}
          >
            Save icon
          </PendingButton>
          <PendingButton
            pending={iconAction === "reset"}
            pendingLabel="Resetting…"
            className={styles.secondaryButton}
            disabled={iconAction !== null}
            onClick={() => void saveImage("chatbot-icon", "reset")}
          >
            Reset icon
          </PendingButton>
        </div>
      </section>

      <section className={styles.ruleCard} aria-labelledby="branding-favicon-title">
        <h2 id="branding-favicon-title">
          Dashboard favicon
        </h2>
        <p className={styles.hint}>
          PNG, JPEG, or WebP up to 500 KB. Shown as the browser-tab icon on the sign-in,
          enrollment, and dashboard pages only — the sidebar crest and the public pages
          are unchanged.
        </p>
        <div className={styles.settingsPreview}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.settingsPreviewImg} src={faviconSelection ?? faviconUrl} alt="Dashboard favicon preview" />
        </div>
        <div className={styles.settingsRow}>
          <label htmlFor="dashboard-favicon-file">New image</label>
          <input
            id="dashboard-favicon-file"
            ref={faviconFileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) =>
              void handleImageSelection(event.target.files?.[0], "dashboard-favicon")
            }
          />
        </div>
        {faviconStatus?.error ? (
          <p className={styles.contactError} role="alert">
            {faviconStatus.error}
          </p>
        ) : null}
        {faviconStatus?.note ? (
          <p className={styles.hint} role="status">
            {faviconStatus.note}
          </p>
        ) : null}
        <div className={styles.settingsActions}>
          <PendingButton
            pending={faviconAction === "save"}
            pendingLabel="Saving…"
            className={styles.primaryButton}
            disabled={!faviconSelection || faviconAction !== null}
            onClick={() => void saveImage("dashboard-favicon", "save")}
          >
            Save favicon
          </PendingButton>
          <PendingButton
            pending={faviconAction === "reset"}
            pendingLabel="Resetting…"
            className={styles.secondaryButton}
            disabled={faviconAction !== null}
            onClick={() => void saveImage("dashboard-favicon", "reset")}
          >
            Reset favicon
          </PendingButton>
        </div>
      </section>
    </div>
  );
}
