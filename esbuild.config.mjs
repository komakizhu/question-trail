import esbuild from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "@codemirror/view", "@codemirror/state"],
  format: "cjs",
  platform: "node",
  target: "es2020",
  outfile: "main.js",
  sourcemap: false,
  logLevel: "info",
});

// Keep generated dependency-comment blank lines clean for consistent diffs.
const bundle = readFileSync("main.js", "utf8");
writeFileSync("main.js", bundle.replace(/^[\t ]+$/gm, ""));
