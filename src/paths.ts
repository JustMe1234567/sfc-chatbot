import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the repository root, from any module that imports this. */
export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}
