/**
 * Secret line input for operator commands. The received characters are
 * never written to the output stream — a TTY reads keystrokes in raw mode
 * with no echo, piped input is consumed silently — so the secret cannot
 * leak into terminal logs, npm output, commits, or reports.
 */

export interface SecureInputStreams {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

interface RawModeStream {
  isTTY?: boolean;
  setRawMode?(mode: boolean): void;
}

/**
 * Reads one line without echoing it. On a TTY the prompt is written and
 * keystrokes are collected invisibly until Enter (Backspace edits, Ctrl-C
 * cancels). Otherwise the first line of the piped stream is returned and
 * the rest of the stream is left unread. The prompt goes to the given
 * output (callers pass stderr so stdout stays clean for scripts).
 */
export async function readHiddenLine(
  streams: SecureInputStreams,
  prompt = "",
): Promise<string> {
  const input = streams.input as NodeJS.ReadableStream & RawModeStream;
  if (prompt) {
    streams.output.write(prompt);
  }
  return input.isTTY ? readHiddenFromTty(input, streams.output) : readFirstPipedLine(input);
}

function readHiddenFromTty(
  input: NodeJS.ReadableStream & RawModeStream,
  output: NodeJS.WritableStream,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let secret = "";
    const setRawMode = input.setRawMode?.bind(input);
    setRawMode?.(true);
    const cleanup = () => {
      input.off("data", onData);
      input.off("error", onError);
      setRawMode?.(false);
    };
    const onData = (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const character of text) {
        if (character === "\r" || character === "\n") {
          cleanup();
          output.write("\r\n");
          resolve(secret);
          return;
        }
        if (character === "\x7f" || character === "\b") {
          secret = secret.slice(0, -1);
          continue;
        }
        if (character === "\x03") {
          cleanup();
          output.write("\r\n");
          reject(new Error("Password entry cancelled."));
          return;
        }
        if (character < " ") {
          continue; // other control characters are swallowed, never echoed
        }
        secret += character;
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    input.on("data", onData);
    input.on("error", onError);
  });
}

function readFirstPipedLine(input: NodeJS.ReadableStream): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("error", onError);
      fn();
    };
    const text = () => Buffer.concat(chunks).toString("utf8");
    const onData = (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
      const newline = text().indexOf("\n");
      if (newline !== -1) {
        settle(() => resolve(text().slice(0, newline).replace(/\r$/, "")));
      }
    };
    const onEnd = () => {
      settle(() => resolve(text().replace(/\r$/, "")));
    };
    const onError = (error: Error) => {
      settle(() => reject(error));
    };
    input.on("data", onData);
    input.on("end", onEnd);
    input.on("error", onError);
  });
}
