import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({stdin:{contents:'export * from "./src/study-model.ts"; export * from "./src/study-store.ts"; export * from "./src/study-import.ts";',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'});
const {studyQuestions, studyGroups, StudyStore, readStudyData, questionKey, emptyMarks, emptyAttempt, parseAnswerCardJson} = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const question = (kind = '多选', options = ['甲','乙','丙','丁','戊'], answer = 'AC', original = 'CA') => ['> [!exam-question] 第 1 题','> 题干',...options.map((text,i)=>`> ${String.fromCharCode(65+i)}. ${text}`),'','^q1',...(kind ? [`题型：${kind}`] : []),'','> [!success]- 答案与解析',`> 参考答案：${answer}`,'','> [!note]- 我的笔记',`> 我的答案：${original}`].join('\n');
const oldRecord = () => ({id:'old',createdAt:null,selected:'C',answer:'B',marks:{A:'certain',B:'uncertain',C:'excluded',D:'none'},...emptyAttempt()});

test('explicit kinds parse answer sets, A–Z, and preserve judgment wording', () => {
  const q=studyQuestions(question())[0];
  assert.equal(q.kind,'multiple'); assert.deepEqual(q.answer,['A','C']); assert.deepEqual(q.original,['A','C']); assert.equal(q.options.length,5);
  assert.deepEqual(studyQuestions(question('多选',Array.from({length:26},(_,i)=>`选项${i}`),'ZA'))[0].answer,['A','Z']);
  const judgment=studyQuestions(question('判断',['符合题意','不符合题意'],'不符合题意','符合题意'))[0];
  assert.equal(judgment.kind,'judgment'); assert.deepEqual(judgment.answer,['B']); assert.deepEqual(judgment.original,['A']); assert.deepEqual(judgment.options,['符合题意','不符合题意']);
  const subjective=studyQuestions(question('主观题',[],'参考要点','我的正文'))[0];
  assert.equal(subjective.kind,'subjective'); assert.deepEqual(subjective.options,[]); assert.equal(subjective.answer,null); assert.deepEqual(subjective.original,[]);
});

test('legacy compatibility and ambiguous answers never guess', () => {
  assert.equal(studyQuestions(question('', ['甲','乙','丙','丁'],'B'))[0].kind,'single');
  assert.equal(studyQuestions(question('', ['甲','乙','丙'])) .length,0);
  assert.equal(studyQuestions(question('单选',['甲','乙'],'AB'))[0].answer,null);
  for(const value of ['未知','AF','A A','A、A','A,?','']) assert.equal(studyQuestions(question('多选',['甲','乙','丙','丁','戊'],value))[0].answer,null,value);
  assert.deepEqual(studyQuestions(question('多选',['甲','乙','丙'],'A、 C'))[0].answer,['A','C']);
  assert.equal(studyQuestions(question('未知题型')).length,0);
  assert.equal(studyQuestions(question()+'\n\n'+question()).length,0);
});

test('code and math inside a question are not mistaken for options', () => {
  const source=question('单选',['甲','乙'],'B').replace('> 题干',()=>'> 题干\n> ```text\n> Z. 代码\n> ```\n> $$\n> X. 公式\n> $$');
  const q=studyQuestions(source)[0]; assert.ok(q); assert.match(q.stem,/Z\. 代码/); assert.match(q.stem,/X\. 公式/); assert.equal(q.options.length,2);
});

test('V1/V2 read as V3 while their originals remain unchanged', async () => {
  for(const version of [1,2]) {
    const key=questionKey('old.md','q1'), legacy={version,questions:{[key]:[oldRecord()]},bindings:{},groupFolds:{}};
    const before=structuredClone(legacy); const decoded=readStudyData(legacy);
    assert.equal(decoded.version,3); assert.equal(decoded.questions[key][0].kind,'single'); assert.deepEqual(decoded.questions[key][0].selected,['C']); assert.deepEqual(decoded.questions[key][0].answer,['B']); assert.deepEqual(legacy,before);
    let saved; const store=new StudyStore({saveData:async value=>{saved=structuredClone(value)}},{other:true,[version===1?'questionTrail':'questionTrailV2']:legacy});
    await store.toggleFlag(key,studyQuestions(question())[0],'important');
    assert.deepEqual(saved[version===1?'questionTrail':'questionTrailV2'],before); assert.equal(saved.questionTrailV3.version,3); assert.equal(saved.other,true);
  }
});

test('V3 presence takes precedence and damaged data blocks writes', () => {
  for(const value of [null,undefined,{}, {version:3,questions:{[questionKey('x','q')]:[{...oldRecord(),kind:'multiple',selected:['A','A'],answer:['B'],marks:emptyMarks()}]}}]) {
    assert.throws(()=>new StudyStore({saveData:async()=>{throw new Error('must not save')}},{questionTrailV3:value,questionTrailV2:{version:2,questions:{}}}));
  }
  const key=questionKey('x','q');
  const valid={version:3,questions:{[key]:[{...oldRecord(),kind:'multiple',selected:['C','A'],answer:null,marks:emptyMarks()}]},bindings:{},groupFolds:{}};
  const decoded=readStudyData(valid); assert.deepEqual(decoded.questions[key][0].selected,['A','C']); assert.equal(decoded.questions[key][0].answer,null);
  const store=new StudyStore({}, {questionTrailV3:valid,questionTrailV2:{version:2,questions:{[key]:[oldRecord()]}}}); assert.equal(store.records(key,studyQuestions(question())[0])[0].answer,null);
});

test('multiple drafts toggle independently, snapshot answers and retain failed drafts', async () => {
  let saved,fail=false; const store=new StudyStore({saveData:async value=>{if(fail)throw new Error('disk failure');saved=structuredClone(value)}},{});
  const q=studyQuestions(question())[0],key=questionKey('file.md',q.blockId);
  store.start(key); store.pick(key,'C',q.kind); store.pick(key,'A',q.kind); store.pick(key,'C',q.kind); assert.deepEqual(store.session(key).selected,['A']); store.pick(key,'C',q.kind);
  fail=true; await assert.rejects(store.submit(key,q),/disk failure/); assert.equal(store.records(key,q).length,1); assert.deepEqual(store.session(key).selected,['A','C']); assert.equal(store.session(key).redo,true);
  fail=false; await store.submit(key,q); q.answer.push('D');
  assert.deepEqual(store.records(key,q)[1].answer,['A','C']); assert.equal(store.records(key,q)[1].kind,'multiple'); assert.equal(saved.questionTrailV3.questions[key].length,2);
  await store.rename('file.md','moved.md'); assert.equal(store.records(questionKey('moved.md','q1'),q).length,2); assert.equal(saved.questionTrailV3.questions[key],undefined);
});

test('empty subjective completion and no reference answer remain distinct', async () => {
  let saved; const store=new StudyStore({saveData:async value=>{saved=structuredClone(value)}},{});
  const q=studyQuestions(question('主观题',[]))[0],key=questionKey('subjective.md','q1'); store.start(key); await store.submit(key,q);
  assert.deepEqual(saved.questionTrailV3.questions[key][1].selected,[]); assert.equal(saved.questionTrailV3.questions[key][1].answer,null); assert.equal(saved.questionTrailV3.questions[key][1].kind,'subjective');
  const choice=studyQuestions(question('多选',['甲','乙'],'未知'))[0],other=questionKey('no-answer.md','q1'); store.start(other); store.pick(other,'A',choice.kind); await store.submit(other,choice); assert.equal(store.records(other,choice)[1].answer,null);
});

test('legacy imports stay four-option single and become V3 records', async () => {
  const input={schemaVersion:2,type:'answer-recorder-attempt',exercise:{paperId:'p',paperVersion:'1',attemptId:'a',questions:[{questionId:'q',type:'single',options:['A','B','C','D'],answer:'C'}]}};
  const exercise=parseAnswerCardJson(JSON.stringify(input)); assert.equal(exercise.questions[0].supported,true);
  const multi=structuredClone(input);multi.exercise.questions[0].type='multiple';assert.equal(parseAnswerCardJson(JSON.stringify(multi)).questions[0].supported,false);
  let saved;const store=new StudyStore({saveData:async value=>{saved=structuredClone(value)}},{});const q=studyQuestions(question('', ['甲','乙','丙','丁'],'B'))[0];
  await store.importBatch(exercise,'import.md',[{imported:exercise.questions[0],question:q}]); const records=saved.questionTrailV3.questions[questionKey('import.md','q1')];assert.deepEqual(records[1].selected,['C']);assert.equal(records[1].kind,'single');
  await assert.rejects(store.importBatch(exercise,'multiple.md',[{imported:exercise.questions[0],question:studyQuestions(question())[0]}]),/单选/);
});

test('bracket display math and metadata fake boundaries preserve real question ownership', () => {
  const source=question('单选',['甲','乙'],'B').replace('> 题干',()=>'> 题干\n> \\[\n> Z. 公式伪选项\n> \\]');
  assert.equal(studyQuestions(source)[0]?.options.length,2);
  const withMetadata=source.replace('题型：单选','```md\n#### 伪标题\n题型：未知\n```\n题型：单选');
  assert.equal(studyQuestions(withMetadata)[0]?.kind,'single');
});

test('ambiguous reference declarations never choose the first or last answer', () => {
  const source=question('多选',['甲','乙','丙'],'AC');
  assert.equal(studyQuestions(source.replace('> 参考答案：AC','> 参考答案：AC\n> 正确答案：B'))[0].answer,null);
  assert.equal(studyQuestions(source+'\n\n> [!success]- 答案与解析\n> 答案：B')[0].answer,null);
  assert.equal(studyQuestions(source+'\n\n> [!success]- 答案与解析\n> 没有标准答案')[0].answer,null);
  assert.equal(studyQuestions(source+'\n> 正确答案：B')[0].answer,null);
});

test('damaged V3 required maps and source fields block writes; V2 retains defaults', () => {
  const key=questionKey('v3.md','q1');
  const source={paperId:'p',paperVersion:'1',attemptId:'a',questionId:'q',fingerprint:'f',revision:1,note:'',review:false,result:''};
  const record={...oldRecord(),kind:'single',selected:['C'],answer:['B'],marks:emptyMarks(),source};
  const base={version:3,questions:{[key]:[record]},bindings:{},groupFolds:{}};
  for(const field of ['bindings','groupFolds']) for(const value of [undefined,null,[],true]) {
    const bad=structuredClone(base); if(value===undefined) delete bad[field]; else bad[field]=value;
    assert.throws(()=>readStudyData(bad),field+':'+String(value));
    assert.throws(()=>new StudyStore({}, {questionTrailV3:bad,questionTrailV2:{version:2,questions:{}}}));
  }
  for(const [field,values] of Object.entries({revision:[undefined,null,0,-1,1.5,'1'],result:[undefined,null,1],note:[undefined,null],review:[undefined,'false'],paperId:[undefined,null]})) {
    for(const value of values) {
      const bad=structuredClone(base); if(value===undefined) delete bad.questions[key][0].source[field];else bad.questions[key][0].source[field]=value;
      assert.throws(()=>readStudyData(bad),field+':'+String(value));
    }
  }
  const old={version:2,questions:{[key]:[{...oldRecord(),source:{...source,revision:undefined,result:undefined}}]}};
  const decoded=readStudyData(old);assert.deepEqual(decoded.bindings,{});assert.deepEqual(decoded.groupFolds,{});assert.equal(decoded.questions[key][0].source.revision,1);assert.equal(decoded.questions[key][0].source.result,'');
});

test('V3 requires wrongOptions while V1/V2 retain missing-field compatibility', () => {
  const key=questionKey('required.md','q1');
  const record={...oldRecord(),kind:'single',selected:['C'],answer:['B'],marks:emptyMarks()};delete record.wrongOptions;
  const data={version:3,questions:{[key]:[record]},bindings:{},groupFolds:{}};
  assert.throws(()=>readStudyData(data),/错项/);
  assert.throws(()=>new StudyStore({}, {questionTrailV3:data}),/错项/);
  for(const version of [1,2]) {
    const old=oldRecord();delete old.wrongOptions;
    assert.deepEqual(readStudyData({version,questions:{[key]:[old]}}).questions[key][0].wrongOptions,[]);
  }
});

test('prototype names are rejected as unknown question kinds', () => {
  for(const kind of ['constructor','toString','__proto__','hasOwnProperty','valueOf','未知题型']) {
    assert.deepEqual(studyQuestions(question(kind)),[],kind);
  }
});
