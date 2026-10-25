import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const bundle = await build({entryPoints:["tests/question-study.runtime.ts"],bundle:true,write:false,format:"cjs",platform:"browser",external:["obsidian"]});
const code = `(async()=>{
 const view=app.workspace.getLeavesOfType("markdown").map(l=>l.view).find(v=>v.previewMode&&v.file);
 if(!view)throw new Error("需要一个已打开的 Markdown 视图");
 const Renderer=Object.getPrototypeOf(Object.getPrototypeOf(view.previewMode)).constructor;
 const MarkdownRenderChild=Object.getPrototypeOf(Renderer.prototype).constructor;
 const Component=Object.getPrototypeOf(MarkdownRenderChild.prototype).constructor;
 const native={Renderer,MarkdownRenderer:Renderer,MarkdownRenderChild,Component,Notice:class{constructor(m){throw new Error(m)}}};
 const module={exports:{}};
 new Function("require","module","exports",${JSON.stringify(bundle.outputFiles[0].text)})(()=>native,module,module.exports);
 try{return JSON.stringify(await module.exports.run(native,app,${JSON.stringify(readFileSync("styles.css","utf8"))}));}
 catch(e){return JSON.stringify({error:String(e),stack:e.stack});}
 finally{document.querySelectorAll("[data-question-trail-study-test]").forEach(e=>e.remove());}
})()`;
const result=execFileSync("obsidian",["eval",`code=${code}`],{encoding:"utf8",maxBuffer:4*1024*1024});
console.log(result.trim());if(!result.includes('"passed":'))process.exitCode=1;
