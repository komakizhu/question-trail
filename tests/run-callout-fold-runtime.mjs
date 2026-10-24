import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const result = await build({
  entryPoints: [fileURLToPath(new URL("./callout-fold.runtime.ts", import.meta.url))],
  bundle: true, write: false, format: "cjs", platform: "browser", external: ["obsidian"],
});
const code = `(async () => {
  const preview = app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view).find(view => view.previewMode && view.file);
  if (!preview) throw new Error("Open a Markdown note before running this test");
  const Renderer = Object.getPrototypeOf(Object.getPrototypeOf(preview.previewMode)).constructor;
  const MarkdownRenderChild = Object.getPrototypeOf(Renderer.prototype).constructor;
  const Component = Object.getPrototypeOf(MarkdownRenderChild.prototype).constructor;
  const native = { Renderer, MarkdownRenderChild, Component, TFile: preview.file.constructor, Notice: class { constructor(message) { throw new Error(message); } } };
  const module = { exports: {} };
  new Function("require", "module", "exports", ${JSON.stringify(result.outputFiles[0].text)})((name) => {
    if (name === "obsidian") return native;
    throw new Error("Unexpected module: " + name);
  }, module, module.exports);
  try { return JSON.stringify(await module.exports.run(native, app)); }
  catch (error) { return JSON.stringify({ error: String(error), stack: error.stack }); }
  finally { document.querySelectorAll("[data-question-trail-fold-test]").forEach(element => element.remove()); }
})()`;
// Pass the JavaScript as an argv value, never interpolate it into a shell command.
const output = execFileSync("obsidian", ["eval", `code=${code}`], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
console.log(output.trim());
if (!output.includes('"passed":')) process.exitCode = 1;
