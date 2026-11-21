import { PassThrough } from "node:stream";
import { Writable } from "node:stream";
import { describe, expect, test } from "vitest";
import { readHiddenLine } from "../scripts/lib/secure-input";

/** A sink that records exactly what the operator's terminal would show. */
function collectingSink(): Writable & { written: string } {
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      sink.written += chunk.toString("utf8");
      callback();
    },
  }) as Writable & { written: string };
  sink.written = "";
  return sink;
}

type FakeTty = PassThrough & {
  isTTY: boolean;
  setRawModeCalls: boolean[];
  setRawMode(mode: boolean): void;
};

function fakeTty(): FakeTty {
  const tty = new PassThrough() as FakeTty;
  tty.isTTY = true;
  tty.setRawModeCalls = [];
  tty.setRawMode = (mode: boolean) => {
    tty.setRawModeCalls.push(mode);
  };
  return tty;
}

describe("hidden password input (ticket 98)", () => {
  test("the piped path returns the first line and never writes the secret", async () => {
    const input = new PassThrough();
    const output = collectingSink();
    const pending = readHiddenLine({ input, output }, "Enter the new password: ");
    input.write("piped-secret-42\nsecond line\n");
    input.end();
    expect(await pending).toBe("piped-secret-42");
    expect(output.written).toBe("Enter the new password: ");
    expect(output.written).not.toContain("piped-secret-42");
  });

  test("the TTY path reads keystrokes invisibly and toggles raw mode", async () => {
    const input = fakeTty();
    const output = collectingSink();
    const pending = readHiddenLine({ input, output }, "Enter the new password: ");
    input.write("pass");
    input.write("\x7f"); // Backspace removes the last "s"
    input.write("word");
    input.write("\r");
    expect(await pending).toBe("pasword");
    // Exactly the prompt and the final newline were shown: no echoed
    // keystrokes, no partial or full secret ever reached the output.
    expect(output.written).toBe("Enter the new password: \r\n");
    expect(output.written).not.toContain("pasword");
    expect(input.setRawModeCalls).toEqual([true, false]);
  });

  test("Ctrl-C cancels entry and restores the terminal", async () => {
    const input = fakeTty();
    const output = collectingSink();
    const pending = readHiddenLine({ input, output }, "Enter the new password: ");
    input.write("half-typed-secret");
    input.write("\x03");
    await expect(pending).rejects.toThrowError(/cancelled/);
    expect(input.setRawModeCalls).toEqual([true, false]);
    expect(output.written).not.toContain("half-typed-secret");
  });

  test("an empty piped stream yields an empty secret, which callers reject", async () => {
    const input = new PassThrough();
    const output = collectingSink();
    const pending = readHiddenLine({ input, output });
    input.end();
    expect(await pending).toBe("");
    expect(output.written).toBe("");
  });
});
