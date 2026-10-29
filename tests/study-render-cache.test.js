import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({entryPoints:['src/study-render-cache.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const { StudyRenderCache, NearbyQuestions } = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const source = '> [!exam-question] 第 1 题\n> 题干\n> A. 甲\n> B. 乙\n> C. 丙\n> D. 丁\n\n^q1';
test('cache reuses each file across navigation and invalidates changed source',()=>{
 const c=new StudyRenderCache(),a=c.get('a',source); c.get('b',source);assert.equal(c.get('a',source),a);
 assert.notEqual(c.get('a',source+'\n修改'),a);c.clear();assert.notEqual(c.get('a',source),a);
});
test('cache is bounded and ambiguous materials remain unavailable',()=>{
 const c=new StudyRenderCache(),a=c.get('a',source);for(let i=0;i<8;i++)c.get('f'+i,source);
 assert.notEqual(c.get('a',source),a);
 const material='> [!exam-material] 材料\n> 内容\n\n^m1\n';
 const entry=c.get('m',material+source);assert.ok(entry.material('m1'));assert.equal(entry.material('m1'),entry.material('m1'));
 assert.equal(c.get('m',material+'\n^m1\n'+source).material('m1'),null);
});
test('indexed sections preserve question ambiguity, material headers and extra boundaries',()=>{
 const material='> [!exam-material] 材料\n> 共用内容\n\n^m1\n\n';
 const first=source+'\n标签：#测试\n材料：[[#^m1]]\n\n> [!success]- 答案与解析\n> 参考答案：A\n\n';
 const second=first.replace('第 1 题','第 2 题').replace('^q1','^q2');
 const c=new StudyRenderCache(),entry=c.get('sections',material+first+second);
 assert.equal(entry.questions.length,2); assert.equal(entry.groups.length,1);
 const [q1,q2]=entry.questions,group=entry.groups[0];
 assert.equal(entry.questionAt(q1.title,q1.headerLine,q1.headerLine),q1);
 assert.equal(entry.questionAt(q1.title,q2.headerLine,q2.endLine),null);
 const duplicate=c.get('duplicate',first+first.replace('^q1','^q2'));
 assert.equal(duplicate.questionAt('第 1 题',0,duplicate.lines.length),null);
 assert.equal(entry.materialGroupAt(group.materialHeaderLine,group.materialEndLine),group);
 assert.equal(entry.materialGroupAt(group.materialHeaderLine+1,group.materialEndLine),null);
 assert.equal(entry.groupAt(group.firstQuestionLine,group.lastQuestionLine),group);
 assert.equal(entry.groupAt(group.firstQuestionLine,group.lastQuestionLine+1),null);
 const extra=q1.extras.find(e=>e.kind==='detail');assert.ok(extra);
 assert.equal(entry.extraAt(extra.start,extra.end-1).question,q1);
 assert.equal(entry.extraAt(extra.start,extra.end),null);
 assert.equal(entry.extraAt(q2.headerLine,q2.headerLine),null);
});
test('nearby queue mounts only intersecting cards, two per frame, and cancels disposed work',async()=>{
 let observer; const frames=new Map();let id=0;
 const saved=[globalThis.IntersectionObserver,globalThis.requestAnimationFrame,globalThis.cancelAnimationFrame];
 globalThis.IntersectionObserver=class{constructor(cb){this.cb=cb;observer=this;} observe(){} unobserve(){} disconnect(){}};
 globalThis.requestAnimationFrame=cb=>{frames.set(++id,cb);return id};globalThis.cancelAnimationFrame=id=>frames.delete(id);
 const frame=()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(cb=>cb())};
 const element=()=>({isConnected:true,closest:()=>null,getBoundingClientRect:()=>({height:50})});
 try {
  let mounted=0;const queue=new NearbyQuestions();const cards=Array.from({length:5},element);
  const removes=cards.map(card=>queue.add(card,async()=>{mounted++}));
  observer.cb(cards.slice(0,3).map(target=>({target,isIntersecting:true})));frame();assert.equal(mounted,2);frame();assert.equal(mounted,3);
  observer.cb([{target:cards[3],isIntersecting:true}]);removes[3]();frame();assert.equal(mounted,3);
  observer.cb([{target:cards[4],isIntersecting:true}]);queue.destroy();frame();assert.equal(mounted,3);
  let resume,ready=false;const delayed=new NearbyQuestions((_el,cb)=>{resume=cb;return ready});
  delayed.add(cards[0],async()=>{mounted++});observer.cb([{target:cards[0],isIntersecting:true}]);frame();assert.equal(mounted,3);
  ready=true;resume();frame();assert.equal(mounted,4);delayed.destroy();
 }finally{[globalThis.IntersectionObserver,globalThis.requestAnimationFrame,globalThis.cancelAnimationFrame]=saved}
});
