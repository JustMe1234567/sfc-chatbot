"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The result of one staff action (ticket 33's shared plumbing): whether the
 * server accepted it, the parsed response body, and — on failure — the
 * visitor-facing message the server sent or the caller's fallback.
 */
export type StaffActionResult =
  | { ok: true; body: unknown }
  | { ok: false; body: unknown; message: string };

/**
 * The dashboard's shared staff-action plumbing (ticket 33): the busy/error
 * pair, the POST, the router refresh on success, and the parse-error
 * fallback that every dashboard client used to re-implement. The button
 * stays a PendingButton — it disables itself while `busy` and its own
 * in-flight latch swallows same-tick double clicks — so this hook adds no
 * guard of its own; a caller that can fire outside a button guards with
 * `busy` first.
 *
 * Success and failure both come back through the result so callers with
 * extra needs (the invite form's one-time password, the close button's
 * refresh-on-failure) keep their exact behavior while the request plumbing
 * stays in one place.
 */
export function useStaffAction(): {
  busy: boolean;
  error: string;
  setError: (message: string) => void;
  run: (action: () => Promise<Response>, fallback: string) => Promise<StaffActionResult>;
} {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = useCallback(
    async (action: () => Promise<Response>, fallback: string): Promise<StaffActionResult> => {
      setBusy(true);
      setError("");
      try {
        const response = await action();
        const body = (await response.json().catch(() => null)) as unknown;
        if (!response.ok) {
          const message =
            (body as { error?: { message?: string } } | null)?.error?.message ?? fallback;
          setError(message);
          return { ok: false, body, message };
        }
        router.refresh();
        return { ok: true, body };
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  return { busy, error, setError, run };
}
