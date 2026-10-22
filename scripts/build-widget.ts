import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "../src/paths";

const root = repoRoot();
const entry = path.join(root, "src/widget/widget.ts");
const outDir = path.join(root, "public/widget");
const outFile = path.join(outDir, "v1.js");

// The widget is embedded on the college WordPress site with a single
// <script src=".../widget/v1.js"> tag, so it must be a self-contained
// bundle that carries its own styles and needs no global configuration.
export async function buildWidget() {
  await mkdir(outDir, { recursive: true });
  await build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    minify: true,
    legalComments: "none",
    outfile: outFile,
    target: ["es2019"],
  });
  return outFile;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildWidget()
    .then((file) => console.log(`built ${path.relative(root, file)}`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
