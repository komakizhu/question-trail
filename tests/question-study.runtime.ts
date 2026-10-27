import { historyLabels, registerQuestionStudy } from "../src/study-view";
import { StudyStore } from "../src/study-store";
import { questionKey, readStudyData, studyGroups, studyQuestions } from "../src/study-model";
import { parseAnswerCardCsv, parseAnswerCardJson } from "../src/study-import";

/** Real Markdown renderer, isolated DOM and in-memory storage; never writes the user's vault. */
export async function run(native: any, app: any, css: string) {
  const passed: string[] = [];
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
  const wait = () => new Promise(resolve => setTimeout(resolve, 25));
  const source = ["#### 第 103 题", "", "> [!exam-question] 第 103 题", "> 咖啡销量没有增加，以下哪项最能削弱？", ">", "> A. **个别**门店不健康", "> B. 单价过高", "> C. 今年企业转向其他品类", "> D. 文化不成熟", "", "^q103", "", "标签：#考点/削弱论证 #状态/不确定", "关联：[[示例笔记]]", "", "> [!success]- 答案与解析", "> 参考答案：B", "> 解析：价格过高。", "", "> [!note]- 我的笔记", "> 我的答案：C", "> 需要复盘。", "", "#### 第 104 题", "", "> [!exam-question] 第 104 题", "> 第二题", "> A. 甲", "> B. 乙", "> C. 丙", "> D. 丁", "", "^q104", "", "标签：", "关联：", "", "> [!success]- 答案与解析", "> 参考答案：A", ""].join("\n");
  const typedSource = [
    "> [!exam-material] 共用材料", "> 这段材料应在整组重做时保留。", "", "^mtyped", "",
    "#### 第 201 题", "> [!exam-question] 第 201 题", "> 多选题干", "> A. 甲", "> B. 乙", "> C. 丙", "> D. 丁", "> E. 戊", "", "^qm201", "题型：多选", "标签：#题型/多选", "关联：[[示例笔记]]", "材料：[[#^mtyped|共用材料]]", "", "> [!success]- 答案与解析", "> 参考答案：AC", "> 解析：A 和 C 正确。", "",
    "#### 第 202 题", "> [!exam-question] 第 202 题", "> 判断题干", "> A. 对", "> B. 错", "", "^qj202", "题型：判断", "标签：", "关联：", "材料：[[#^mtyped|共用材料]]", "", "> [!success]- 答案与解析", "> 参考答案：对", "> 解析：判断说明。", "",
    "#### 第 203 题", "> [!exam-question] 第 203 题", "> 主观题题干：说明原因。", "", "^qs203", "题型：主观题", "标签：", "关联：", "材料：[[#^mtyped|共用材料]]", "", "> [!success]- 答案与解析", "> 参考答案：不自动评分", "> 解析：参考思路。", "", "> [!note]- 我的笔记", "> 记住个人提示。", "",
    "#### 第 204 题", "> [!exam-question] 第 204 题", "> 五项单选且没有参考答案", "> A. 甲", "> B. 乙", "> C. 丙", "> D. 丁", "> E. 戊", "", "^qs204", "题型：单选", "标签：", "关联：", "",
  ].join("\n");
  const qs = studyQuestions(source);
  assert(qs.length === 2 && qs[0].answer?.join() === "B" && qs[0].original.join() === "C" && qs[1].answer?.join() === "A" && source.split("\n")[qs[0].startLine] === "#### 第 103 题", "source ownership and standalone heading range");
  assert(studyQuestions(source.replace("^q104", "^q103")).length === 0, "duplicate ids must not share history");
  assert(studyQuestions(source.replace("参考答案：B", "参考答案：BC"))[0].answer === null, "never grade multiple answers as one");
  const typedQuestions = studyQuestions(typedSource);
  assert(typedQuestions.map(question => question.kind).join() === "multiple,judgment,subjective,single", "explicit types are parsed without inferring from option shape");
  assert(typedQuestions[0].options.length === 5 && typedQuestions[0].answer?.join() === "A,C" && typedQuestions[1].options.join("|") === "对|错" && typedQuestions[1].answer?.join() === "A" && typedQuestions[2].options.length === 0 && typedQuestions[2].answer === null && typedQuestions[3].options.length === 5 && typedQuestions[3].answer === null, "A–Z options, judgment wording, subjective body, and missing answers are preserved");
  assert(studyGroups(typedSource).length === 1 && studyGroups(typedSource)[0].questionBlockIds.join() === "qm201,qj202,qs203", "mixed types share the same material group");
  const materialGroup = ["> [!exam-material] （一）", "> 共用材料", "", "^m1", "", "#### 第 1 题", "> [!exam-question] 第 1 题", "> 多选题干一", "> A. 甲", "> B. 乙", "> C. 丙", "> D. 丁", "", "^q1", "题型：多选", "标签：", "关联：", "材料：[[#^m1|共享材料]]", "", "#### 第 2 题", "> [!exam-question] 第 2 题", "> 主观题干二", "", "^q2", "题型：主观题", "标签：", "关联：", "材料：[[#^m1|共享材料]]", ""].join("\n");
  assert(studyGroups(materialGroup).length === 1 && studyGroups(materialGroup)[0].questionBlockIds.join() === "q1,q2" && materialGroup.split("\n")[studyGroups(materialGroup)[0].firstQuestionLine] === "#### 第 1 题", "continuous local material groups include standalone question headings");
  assert(studyQuestions(materialGroup).map(question => question.kind).join() === "multiple,subjective", "mixed question types remain in a shared-material group");
  assert(studyGroups(materialGroup.replace("[[#^m1|共享材料]]", "[[Other#^m1|共享材料]]")).length === 0, "cross-file material references are not grouped");
  assert(studyGroups(materialGroup.replace("^m1\n", "^m1\n\n^m1\n")).length === 0, "duplicate material block ids are not grouped");
  assert(studyGroups(materialGroup.replace("[[#^m1|共享材料]]", "[[#^m1|共享材料]] [[#^missing|另一个材料]]")).length === 0, "multiple material references are not grouped");
  assert(studyGroups(materialGroup.replaceAll("[[#^m1|共享材料]]", "[[#^missing|共享材料]]")).length === 0, "missing material is not grouped");
  const nextMaterialSource = materialGroup.replace("\n#### 第 2 题", "\n#### 第 2 题") + "\n> [!exam-material] （二）\n> 下一组材料\n\n^m2\n";
  const nextMaterialLine = nextMaterialSource.split("\n").findIndex(line => line.startsWith("> [!exam-material] （二）"));
  const lastQuestion = studyQuestions(nextMaterialSource).at(-1)!;
  assert(lastQuestion.rangeEndLine < nextMaterialLine && lastQuestion.extras.every(extra => extra.end <= nextMaterialLine), "question metadata and details stop before the next material block");
  let rejected = false;
  try { readStudyData({version:3,questions:{}}); } catch { rejected = true; }
  assert(rejected, "incompatible storage must not be overwritten");
  rejected = false; try { new StudyStore({} as any,{questionTrailV2:null}); } catch { rejected = true; }
  assert(rejected, "explicit null V2 storage is not treated as empty data");
  const legacyKey = questionKey("legacy.md", "q1");
  const legacy = readStudyData({ version:1, questions:{ [legacyKey]:[{ id:"original",createdAt:null,selected:"A",answer:"B",marks:{A:"certain",B:"uncertain",C:"excluded",D:"none"} }] } });
  assert(legacy.questions[legacyKey][0].uncertainOptions.includes("B") && legacy.questions[legacyKey][0].wrongOptions.length === 0 && legacy.questions[legacyKey][0].legacyMarks?.A === "certain" && legacy.questions[legacyKey][0].legacyMarks?.C === "excluded", "legacy option judgments survive as audit data and missing wrong marks default empty");
  const cardV2 = parseAnswerCardJson(JSON.stringify({schemaVersion:2,type:"answer-recorder-attempt",exercise:{paperId:"p",paperVersion:"1",attemptId:"a",name:"练习",questions:[{questionId:"q1",number:1,type:"single",options:["A","B","C","D"],answer:"C",uncertainOptions:["B"],wrongOptions:["D"],important:true,wholeUncertain:false,unknown:true,note:"v2",review:true}]}}));
  assert(cardV2.questions[0].answer === "C" && cardV2.questions[0].uncertainOptions[0] === "B" && cardV2.questions[0].wrongOptions[0] === "D" && cardV2.questions[0].important && cardV2.questions[0].unknown, "v2 JSON maps answer and independent option marks");
  const cardV3 = parseAnswerCardJson(JSON.stringify({schemaVersion:3,type:"answer-recorder-attempt",exercise:{paperId:"p",paperVersion:"3",attemptId:"a3",name:"练习",questions:[{questionId:"q1",number:1,type:"single",options:["A","B","C","D"],optionIds:["o1","o2","o3","o4"],answer:"o3",uncertainOptions:["o2"],wrongOptions:["o1"],important:true,note:"含逗号,和换行\n的备注",review:true}]}}));
  assert(cardV3.questions[0].answer === "C" && cardV3.questions[0].uncertainOptions[0] === "B" && cardV3.questions[0].wrongOptions[0] === "A", "v3 option ids map both marks by declared option identity");
  const csvV2 = parseAnswerCardCsv('schema_version,paper_id,paper_version,attempt_id,exercise_name,question_id,question_number,question_type,answer,review_flag,uncertain_options,wrong_options,note,important_flag,whole_uncertain_flag,unknown_flag\n2,p,1,a,练习,q1,1,single,B,true,"A|C","D","含逗号,的备注",true,false,false\n');
  assert(csvV2.questions[0].answer === "B" && csvV2.questions[0].uncertainOptions.join() === "A,C" && csvV2.questions[0].wrongOptions[0] === "D", "v2 CSV answer and independent option marks parse");
  const csvV3Headers = "schema_version,paper_id,paper_version,attempt_id,exercise_name,question_id,question_number,question_type,answer,review_flag,uncertain_options,wrong_options,note,important_flag,whole_uncertain_flag,unknown_flag,options_json,answer_json,uncertain_option_ids_json,wrong_option_ids_json,note_json";
  const csvV3Values = [3,"p",3,"a3","练习","q1",1,"single","C",true,"[\"B\"]","[\"A\"]","line1\nline2",true,false,false,JSON.stringify([{id:"x1",label:"A"},{id:"x2",label:"B"},{id:"x3",label:"C"},{id:"x4",label:"D"}]),JSON.stringify("x3"),JSON.stringify(["x2"]),JSON.stringify(["x1"]),JSON.stringify("line1\nline2")];
  const csvCell = (value: unknown) => { const text=String(value); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"','""')}"` : text; };
  const csvV3 = parseAnswerCardCsv(csvV3Headers+"\n"+csvV3Values.map(csvCell).join(",")+"\n");
  assert(csvV3.questions[0].answer === "C" && csvV3.questions[0].uncertainOptions[0] === "B" && csvV3.questions[0].wrongOptions[0] === "A" && csvV3.questions[0].note.includes("line2"), "v3 CSV identity and multiline extension fields parse");
  const skillSync = parseAnswerCardJson(JSON.stringify({schemaVersion:1,type:"question-trail-sync",paperId:"p",paperVersion:"1",attemptId:"a",batchId:"g1",name:"Skill 同步",questions:[{questionId:"q1",number:1,section:"判断推理",type:"single",answer:"C",uncertainOptions:["B"],wrongOptions:["A"],important:true,wholeUncertain:false,unknown:true,supported:true}]}));
  assert(skillSync.sourceKind === "question-trail-sync" && skillSync.questions[0].supported && skillSync.questions[0].answer === "C" && skillSync.questions[0].wrongOptions[0] === "A", "Skill sync preserves both option marks without question text");
  rejected = false; try { parseAnswerCardJson(JSON.stringify({schemaVersion:1,type:"question-trail-sync",paperId:"p",paperVersion:"1",attemptId:"a",questions:[{questionId:"q1",type:"single",answer:"C",uncertainOptions:[],important:false,wholeUncertain:false,unknown:false,supported:true,note:"不允许同步"}]})); } catch { rejected = true; }
  assert(rejected, "Skill sync rejects question text and personal note fields");
  passed.push("识别各题答案、原始作答、标签和关联范围");
  const historyKey = questionKey("history.md", "q1");
  const historyQuestion = studyQuestions(source)[0];
  const historyStore = new StudyStore({} as any, {});
  const historyRecords = [
    { ...historyStore.current(historyKey, historyQuestion), id:"original", selected:[], source:undefined },
    { ...historyStore.current(historyKey, historyQuestion), id:"a1", selected:["B"], source:undefined },
    { ...historyStore.current(historyKey, historyQuestion), id:"sync1", selected:["C"], source:{paperId:"p",paperVersion:"1",attemptId:"a",questionId:"q1",fingerprint:"1",revision:1,note:"",review:false,result:""} },
    { ...historyStore.current(historyKey, historyQuestion), id:"sync2", selected:["D"], source:{paperId:"p",paperVersion:"1",attemptId:"a",questionId:"q1",fingerprint:"2",revision:2,note:"",review:false,result:""} },
    { ...historyStore.current(historyKey, historyQuestion), id:"a2", selected:[], important:true, source:undefined },
  ];
  assert(historyLabels(historyRecords as any).map(item => item.label).join("|") === "未作答|第1次|第2次|第2次 · 修订1|第3次", "attempt history counts blank original placeholders once and imported revisions within one attempt");
  passed.push("作答次数区分空占位、实际作答和导入修订");
  const filePath = "__question_trail_study_test__.md";
  const typedFilePath = "__question_trail_types_test__.md";
  const seedStore = new StudyStore({} as any, {});
  const noAnswerKey = questionKey(typedFilePath, "qs204");
  const noAnswerOriginal = seedStore.current(noAnswerKey, typedQuestions[3]);
  const historicalMultiple = { ...noAnswerOriginal, id:"historical-multiple", createdAt:"2026-10-01T00:00:00.000Z", kind:"multiple" as const, selected:["A", "B"], answer:["A", "C"] };
  let saved: any = {
    otherSetting: "keep",
    questionTrail: { version:1, questions:{} },
    questionTrailV3: { version:3, questions:{ [noAnswerKey]:[noAnswerOriginal,historicalMultiple] }, bindings:{}, groupFolds:{} },
  };
  let failSave = false;
  const virtualSources = new Map([[filePath, source], [typedFilePath, typedSource]]);
  const isolatedVault = new Proxy(app.vault, { get(target, property) {
    if (property === "getAbstractFileByPath") return (path: string) => virtualSources.has(path) ? { path } : target.getAbstractFileByPath(path);
    if (property === "cachedRead") return (file: { path: string }) => virtualSources.has(file.path) ? Promise.resolve(virtualSources.get(file.path)!) : target.cachedRead(file);
    const value = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  const isolatedApp = new Proxy(app, { get(target, property) {
    if (property === "vault") return isolatedVault;
    const value = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  const plugin: any = { app: isolatedApp, loadData: async () => structuredClone(saved), saveData: async (v: any) => { if (failSave) throw new Error("disk failure"); saved = structuredClone(v); }, registerEvent() {}, registerEditorExtension() {}, registerMarkdownPostProcessor(fn: any) { processors.push(fn); } };
  const processors: any[] = [];
  const children: any[] = [];
  const host = document.createElement("div"); host.dataset.questionTrailStudyTest = "true";
  host.className = "markdown-preview-view markdown-rendered";
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:700px;opacity:0;pointer-events:none";
  const style = document.createElement("style"); style.textContent = css; host.append(style); document.body.append(host);
  const ranges = [[2,10],[12,13],[15,17],[19,21],[25,32],[34,35],[37,38]];
  const blocks: HTMLElement[] = [];
  try {
    await registerQuestionStudy(plugin);
    for (const [start, end] of ranges) {
      const element = document.createElement("div"); host.append(element); blocks.push(element);
      const component = new native.Component(); component.load(); children.push(component);
      await native.Renderer.render(app, source.split("\n").slice(start,end + 1).join("\n"), element, filePath, component);
      const callout = element.querySelector(".callout[data-callout='exam-question']");
      if (callout && !callout.querySelector(".exam-question-actions")) {
        const actions = document.createElement("span"); actions.className = "exam-question-actions";
        actions.innerHTML = '<button>复制题目</button><button>复制链接</button>';
        callout.querySelector(".callout-title")!.append(actions);
      }
      for (const processor of processors) await processor(element, { sourcePath: filePath, getSectionInfo: () => ({text:source,lineStart:start,lineEnd:end}), addChild: (c: any) => component.addChild(c) });
    }
    const typedHost = document.createElement("div"); typedHost.className = "markdown-preview-view markdown-rendered"; host.append(typedHost);
    const typedComponent = new native.Component(); typedComponent.load(); children.push(typedComponent);
    await native.Renderer.render(isolatedApp, typedSource, typedHost, typedFilePath, typedComponent);
    typedHost.querySelectorAll<HTMLElement>(".callout[data-callout='exam-question']").forEach(callout => {
      const title = callout.querySelector<HTMLElement>(".callout-title")!;
      if (!title.querySelector(".exam-question-actions")) { const actions = document.createElement("span"); actions.className = "exam-question-actions"; title.append(actions); }
    });
    for (const processor of processors) await processor(typedHost, { sourcePath: typedFilePath, getSectionInfo: () => ({text:typedSource,lineStart:0,lineEnd:typedSource.split("\n").length-1}), addChild: (c: any) => typedComponent.addChild(c) });
    const typedCards = Array.from(typedHost.querySelectorAll<HTMLElement>(".callout.qt-study-question"));
    assert(typedCards.length === 4, "all explicit question types mount in the reading view");
    const typedLines = typedSource.split("\n");
    const detailStarts = typedLines.flatMap((line, index) => /^>\s*\[!(?:success|note)\]/.test(line) ? [index] : []);
    const detailCards = Array.from(typedHost.querySelectorAll<HTMLElement>(".callout[data-callout='success'], .callout[data-callout='note']"));
    assert(detailCards.length === detailStarts.length, "all answer and note callouts render natively");
    for (const [index, detail] of detailCards.entries()) {
      const lineStart = detailStarts[index];
      for (const processor of processors) await processor(detail, { sourcePath: typedFilePath, getSectionInfo: () => ({ text: typedSource, lineStart, lineEnd: lineStart + 1 }), addChild: (c: any) => typedComponent.addChild(c) });
    }
    const [multiCard, judgmentCard, subjectiveCard, noAnswerCard] = typedCards;
    const multiRows = (letter: string) => multiCard.querySelector<HTMLElement>('[data-option="'+letter+'"]')!;
    const cardButton = (card: HTMLElement, label: string) => Array.from(card.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent === label)!;
    const typedKey = (blockId: string) => questionKey(typedFilePath, blockId);
    assert(multiCard.querySelectorAll(".qt-study-option").length === 5 && multiRows("A").dataset.tone === "correct" && multiRows("C").dataset.result === "missed" && multiRows("C").querySelector(".qt-study-result")?.textContent === "漏选", "multiple choice shows correct, wrong, and missed answer states across five options");
    const groupRedo = typedHost.querySelector<HTMLButtonElement>(".qt-study-group-redo")!;
    assert(groupRedo && multiCard.querySelector(".qt-study-question-material")?.textContent?.includes("这段材料应在整组重做时保留"), "material groups expose controls and each question retains shared material");
    groupRedo.click(); await wait();
    assert(typedCards.slice(0,3).every(item => Array.from(item.querySelectorAll(".qt-study-extra")).some(extra => extra.classList.contains("qt-study-concealed"))) && multiCard.querySelector(".qt-study-question-material") && groupRedo.textContent === "退出整组重做", "group redo hides personal clues while keeping shared material visible");
    groupRedo.click(); await wait();
    assert(typedCards.slice(0,3).every((item,index) => saved.questionTrailV3.questions[typedKey(["qm201","qj202","qs203"][index])].length === 1), "entering and leaving group redo does not add attempts");
    passed.push("混合题型题组可整组重做，隐藏个人提示并保留材料");
    cardButton(multiCard, "重做").click();
    multiRows("A").querySelector<HTMLButtonElement>(".qt-study-letter")!.click();
    multiRows("B").querySelector<HTMLButtonElement>(".qt-study-letter")!.click();
    multiRows("A").querySelector<HTMLButtonElement>(".qt-study-uncertain")!.click();
    cardButton(multiCard, "核对答案").click(); await wait();
    const multiAttempt = saved.questionTrailV3.questions[typedKey("qm201")][1];
    assert(multiAttempt.kind === "multiple" && multiAttempt.selected.join() === "A,B" && multiAttempt.answer.join() === "A,C" && multiAttempt.uncertainOptions.join() === "A" && multiRows("B").dataset.result === "wrong" && multiRows("C").dataset.result === "missed", "multiple choice stores selected set, answer snapshot, and uncertainty independently");
    cardButton(multiCard, "重做").click();
    multiRows("A").querySelector<HTMLButtonElement>(".qt-study-letter")!.click();
    multiRows("C").querySelector<HTMLButtonElement>(".qt-study-letter")!.click();
    cardButton(multiCard, "核对答案").click(); await wait();
    const correctMultiBottom = multiCard.querySelector<HTMLElement>(".qt-study-bottom")!;
    assert(saved.questionTrailV3.questions[typedKey("qm201")][2].selected.join() === "A,C" && multiCard.querySelector(".qt-study-status")?.textContent?.includes("完全正确") && !correctMultiBottom.hidden && correctMultiBottom.querySelector("button")?.hidden, "multiple choice is correct only when the selected set exactly matches and its result remains visible after submission");
    passed.push("多选题独立保存选择与犹豫标记，并清楚提示错选漏选");
    assert(judgmentCard.querySelectorAll(".qt-study-option").length === 2 && judgmentCard.querySelector('[data-option="A"] .qt-study-option-body')?.textContent?.includes("对") && judgmentCard.querySelector('[data-option="B"] .qt-study-option-body')?.textContent?.includes("错"), "judgment wording is preserved");
    cardButton(judgmentCard, "重做").click();
    judgmentCard.querySelector<HTMLButtonElement>('[data-option="A"] .qt-study-letter')!.click();
    judgmentCard.querySelector<HTMLButtonElement>('[data-option="B"] .qt-study-letter')!.click();
    assert(judgmentCard.querySelector('[data-option="A"]')?.dataset.chosen === "false" && judgmentCard.querySelector('[data-option="B"]')?.dataset.chosen === "true", "judgment uses single-choice replacement behavior");
    cardButton(judgmentCard, "核对答案").click(); await wait();
    assert(saved.questionTrailV3.questions[typedKey("qj202")][1].kind === "judgment" && saved.questionTrailV3.questions[typedKey("qj202")][1].answer.join() === "A" && saved.questionTrailV3.questions[typedKey("qj202")][1].selected.join() === "B", "judgment answer and submitted response are stored independently");
    passed.push("判断题保留原有选项文字并按单选替换");
    assert(subjectiveCard.querySelectorAll(".qt-study-option").length === 0 && subjectiveCard.querySelector(".qt-study-stem")?.textContent?.includes("说明原因"), "subjective question shows its body without option controls");
    cardButton(subjectiveCard, "重做").click();
    cardButton(subjectiveCard, "退出重做").click();
    assert(saved.questionTrailV3.questions[typedKey("qs203")].length === 1, "leaving subjective redo does not add an attempt");
    cardButton(subjectiveCard, "重做").click();
    const finishSubjective = cardButton(subjectiveCard, "完成本次");
    assert(!finishSubjective.disabled, "an empty subjective attempt can be completed");
    finishSubjective.click(); await wait();
    const subjectiveAttempt = saved.questionTrailV3.questions[typedKey("qs203")][1];
    assert(subjectiveAttempt.kind === "subjective" && subjectiveAttempt.selected.length === 0 && subjectiveAttempt.answer === null && typeof subjectiveAttempt.createdAt === "string", "subjective completion saves a timestamped attempt without an answer");
    cardButton(subjectiveCard, "重做").click();
    assert(Array.from(typedHost.querySelectorAll(".qt-study-extra")).filter(extra => /参考思路|记住个人提示/.test(extra.textContent ?? "")).every(extra => extra.classList.contains("qt-study-concealed")) && subjectiveCard.querySelector(".qt-study-question-material"), "subjective redo hides solution and notes while preserving shared material");
    cardButton(subjectiveCard, "退出重做").click();
    passed.push("主观题无标记也可完成并保存独立历史，重做只遮住提示");
    const noAnswerRows = (letter: string) => noAnswerCard.querySelector<HTMLElement>('[data-option="'+letter+'"]')!;
    assert(noAnswerCard.querySelectorAll(".qt-study-option").length === 5 && noAnswerRows("A").dataset.result === "correct" && noAnswerRows("B").dataset.result === "wrong" && noAnswerRows("C").dataset.result === "missed" && noAnswerCard.querySelector(".qt-study-status")?.textContent?.includes("有错选或漏选"), "historical question type and answer snapshot are used even when the current Markdown type has changed");
    const noAnswerHistory = noAnswerCard.querySelector<HTMLSelectElement>(".qt-study-history")!;
    noAnswerHistory.value = "original"; noAnswerHistory.dispatchEvent(new Event("change")); await wait();
    assert(["A","B","C","D","E"].every(letter => noAnswerRows(letter).dataset.tone === "none"), "missing current answer does not show automatic grading on its original record");
    cardButton(noAnswerCard, "重做").click();
    noAnswerRows("E").querySelector<HTMLButtonElement>(".qt-study-letter")!.click();
    cardButton(noAnswerCard, "保存作答").click(); await wait();
    assert(saved.questionTrailV3.questions[typedKey("qs204")][2].kind === "single" && saved.questionTrailV3.questions[typedKey("qs204")][2].answer === null && saved.questionTrailV3.questions[typedKey("qs204")][2].selected.join() === "E" && noAnswerRows("E").dataset.tone === "none", "answerless five-option question stores a response without grading it");
    passed.push("无参考答案题可保存作答且不自动判分");
    const card = blocks[0];
    const btn = (label: string) => Array.from(card.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent === label)!;
    const row = (key: string) => card.querySelector<HTMLElement>('[data-option="'+key+'"]')!;
    const collapsedMember = document.createElement("div"); collapsedMember.className = "qt-study-group-member qt-study-group-collapsed";
    const collapsedContent = document.createElement("span"); collapsedContent.className = "qt-study-group-content"; collapsedContent.textContent = "子题内容"; collapsedMember.append(collapsedContent); host.append(collapsedMember);
    assert(getComputedStyle(collapsedMember).display !== "none" && getComputedStyle(collapsedContent).display === "none" && getComputedStyle(collapsedMember).marginTop === "0px", `folding keeps the host-managed section box in flow and collapses only its inner content (${getComputedStyle(collapsedMember).display}/${getComputedStyle(collapsedContent).display}/${getComputedStyle(collapsedMember).marginTop})`);
    collapsedMember.remove();
    passed.push("题组折叠保留区块外壳并仅收起内部内容");
    assert(card.querySelectorAll(".qt-study-option").length === 4, "four options mounted");
    assert(card.querySelector("strong")?.textContent === "个别", "rich markdown preserved");
    assert(row("C").dataset.tone === "wrong" && row("B").dataset.tone === "correct", "initial answer colors");
    row("B").querySelector<HTMLButtonElement>(".qt-study-uncertain")!.click();
    await wait();
    assert(row("B").dataset.tone === "correct" && row("B").dataset.uncertain === "true", "correct answer remains green and carries uncertainty mark");
    const unsureIndicator = getComputedStyle(row("B").querySelector(".qt-study-letter")!).backgroundColor;
    assert(unsureIndicator !== "rgba(0, 0, 0, 0)", "uncertainty visibly changes the correct option");
    assert(getComputedStyle(row("B").querySelector(".qt-study-letter")!).borderTopWidth === "2px", "uncertainty adds a clear orange marker");
    row("B").querySelector<HTMLButtonElement>(".qt-study-uncertain")!.click();
    await wait();
    const originalKey = questionKey(filePath,"q103");
    const migrationStore = new StudyStore(plugin, structuredClone(saved));
    await Promise.all([migrationStore.toggleFlag(originalKey, qs[0], "important"), migrationStore.toggleFlag(originalKey, qs[0], "wholeUncertain"), migrationStore.toggleFlag(originalKey, qs[0], "unknown")]);
    assert(saved.questionTrailV3.questions[originalKey][0].important && saved.questionTrailV3.questions[originalKey][0].wholeUncertain && saved.questionTrailV3.questions[originalKey][0].unknown, "three flags coexist in V3");
    assert(saved.questionTrail.version === 1, "legacy snapshot preserved unchanged");
    const syncStore = new StudyStore(plugin, {questionTrailV2:{version:2,questions:{},bindings:{}}});
    await syncStore.importBatch(skillSync, filePath, [{imported:skillSync.questions[0],question:qs[0]}]);
    const syncKey = questionKey(filePath,"q103");
    await syncStore.importBatch(skillSync, filePath, [{imported:skillSync.questions[0],question:qs[0]}]);
    const syncChanged = {...skillSync.questions[0],answer:"A" as const};
    await syncStore.importBatch(skillSync, filePath, [{imported:syncChanged,question:qs[0]}]);
    assert(saved.questionTrailV3.questions[syncKey].length === 3 && saved.questionTrailV3.questions[syncKey][1].source.revision === 1 && saved.questionTrailV3.questions[syncKey][2].source.revision === 2 && saved.questionTrailV3.questions[syncKey][1].source.fingerprint !== saved.questionTrailV3.questions[syncKey][2].source.fingerprint, "Skill sync skips unchanged data and appends a changed revision");
    assert(saved.questionTrailV3.questions[syncKey][1].source.note === "" && !saved.questionTrailV3.questions[syncKey][1].source.review && saved.questionTrailV3.questions[syncKey][1].source.result === "", "Skill sync leaves notes and grading audit outside Obsidian source records");
    const olderSync = {...skillSync.questions[0],answer:"B" as const}; delete (olderSync as any).wrongOptions;
    await syncStore.importBatch(skillSync,filePath,[{imported:olderSync,question:qs[0]}]);
    assert(saved.questionTrailV3.questions[syncKey].length === 4 && saved.questionTrailV3.questions[syncKey][3].wrongOptions.includes("A"), "older sync revisions without wrongOptions preserve the previously synced mark");
    let duplicateTargetRejected = false;
    try { await syncStore.importBatch({...skillSync,questions:[skillSync.questions[0],{...skillSync.questions[0],questionId:"q-other"}]},filePath,[{imported:skillSync.questions[0],question:qs[0]},{imported:{...skillSync.questions[0],questionId:"q-other"},question:qs[0]}]); } catch { duplicateTargetRejected = true; }
    assert(duplicateTargetRejected && saved.questionTrailV3.questions[syncKey].length === 4, "ambiguous many-to-one source mapping is rejected atomically");
    await syncStore.toggleFold(filePath,"m1","group");
    assert(new StudyStore(plugin,structuredClone(saved)).folded(filePath,"m1","group"), "question group fold state persists across reload");
    syncStore.start(syncKey); syncStore.pick(syncKey,"D"); syncStore.session(questionKey(filePath,"q104")).busy = false;
    await syncStore.toggleFold(filePath,"m1","group");
    await syncStore.startGroupRedo(filePath,"m1",["q103","q104"]);
    await syncStore.startGroupRedo(filePath,"m1",["q103","q104"]);
    assert(syncStore.session(syncKey).selected.join() === "D" && syncStore.session(questionKey(filePath,"q104")).redo && !syncStore.folded(filePath,"m1","group"), "group redo preserves an active draft and expands the material");
    syncStore.session(questionKey(filePath,"q104")).busy = true;
    let groupExitBlocked = false; try { syncStore.exitGroupRedo(filePath,["q103","q104"]); } catch { groupExitBlocked = true; }
    assert(groupExitBlocked && syncStore.session(syncKey).redo, "saving child blocks group exit without affecting drafts");
    syncStore.session(questionKey(filePath,"q104")).busy = false; syncStore.exitGroupRedo(filePath,["q103","q104"]);
    assert(!syncStore.session(syncKey).redo && saved.questionTrailV3.questions[syncKey].length === 4, "group exit discards only unsubmitted sessions");
    await syncStore.toggleFold(filePath,"m1","group");
    await syncStore.rename(filePath,"renamed-group.md");
    assert(syncStore.binding(JSON.stringify(["p","1","q1"]))?.path === "renamed-group.md" && syncStore.folded("renamed-group.md","m1","group"), "rename preserves import bindings and group fold state");
    assert(blocks[1].querySelector("a.tag")?.nextSibling?.textContent?.startsWith(" "), "tag spacing");
    assert(blocks[1].querySelectorAll("a.tag").length === 2, "missing label space still renders native tags");
    assert(blocks[1].querySelector("a.internal-link"), "native relation link");
    passed.push("真实渲染保留 Markdown 格式、标签、关联和原始作答");
    btn("重做").click();
    assert(blocks.slice(1,4).every(b => b.classList.contains("qt-study-concealed")), "hide all clues");
    assert(!blocks[5].classList.contains("qt-study-concealed"), "other question unaffected");
    assert(row("B").dataset.tone === "none" && row("C").dataset.tone === "none", "fresh markings");
    row("C").querySelector<HTMLButtonElement>(".qt-study-letter")!.click();
    row("C").querySelector<HTMLButtonElement>(".qt-study-uncertain")!.click();
    row("A").querySelector<HTMLButtonElement>(".qt-study-wrong")!.click();
    btn("核对答案").click(); await wait();
    assert(row("C").dataset.tone === "uncertain-wrong" && row("A").dataset.tone === "wrong", "overlapping uncertain/wrong is split orange/red and wrong-only is red");
    assert(!blocks[1].classList.contains("qt-study-concealed"), "restore tags");
    const key = questionKey(filePath,"q103");
    assert(saved.questionTrailV3.questions[key].length === 2, "first redo appended");
    assert(saved.questionTrailV3.questions[key][1].uncertainOptions.includes("C"), "uncertain option stored separately");
    assert(saved.questionTrailV3.questions[key][1].wrongOptions.includes("A"), "wrong option stored independently from uncertainty and answer");
    btn("重做").click(); row("B").querySelector<HTMLButtonElement>(".qt-study-letter")!.click(); btn("核对答案").click(); await wait();
    assert(saved.questionTrailV3.questions[key].length === 3 && saved.questionTrailV3.questions[key][1].selected.join() === "C", "history remains independent");
    const history = card.querySelector<HTMLSelectElement>("select")!; history.value = saved.questionTrailV3.questions[key][1].id; history.dispatchEvent(new Event("change"));
    assert(row("C").dataset.tone === "uncertain-wrong", "history selectable");
    passed.push("重做遮盖答案与标签；多次提交独立保存且可切换复盘");
    const reload = new StudyStore(plugin, structuredClone(saved));
    assert(reload.records(key,qs[0]).length === 3, "reload persistence");
    reload.start(key); reload.session(key).unknown = true; reload.pick(key,"D"); failSave = true;
    await reload.submit(key,qs[0]).then(() => { throw new Error("must reject"); }, () => {});
    assert(reload.records(key,qs[0]).length === 3 && reload.session(key).redo && reload.session(key).selected.join() === "D" && reload.session(key).unknown, "failed save keeps draft");
    failSave = false; await reload.submit(key,qs[0]);
    await reload.rename(filePath,"renamed.md");
    assert(reload.records(questionKey("renamed.md","q103"),qs[0]).length === 4 && saved.otherSetting === "keep" && saved.questionTrail.version === 1, "rename and legacy settings preservation");
    passed.push("重载读取历史、保存失败保留草稿、重命名保留记录");
    const firstKey = questionKey("renamed.md", "q103"); const secondKey = questionKey("renamed.md", "q104");
    reload.start(firstKey); reload.pick(firstKey,"B"); reload.start(secondKey); reload.pick(secondKey,"A");
    await Promise.all([reload.submit(firstKey,qs[0]),reload.submit(secondKey,qs[1])]);
    assert(saved.questionTrailV3.questions[firstKey].length === 5 && saved.questionTrailV3.questions[secondKey].length === 2, "serialize parallel writes");
    passed.push("不同题目的并发保存互不覆盖，重复块编号与未知数据格式不冒险写入");
    for (const width of [320,700]) {
      host.style.width = width + "px";
      assert(card.scrollWidth <= card.clientWidth + 1, "layout overflow " + width);
    }
    assert(getComputedStyle(card.querySelector(".callout")!).backgroundColor === "rgba(0, 0, 0, 0)", "transparent background");
    assert(getComputedStyle(row("D")).backgroundColor === "rgba(0, 0, 0, 0)", "neutral option");
    passed.push("主题透明背景和窄屏排版");
    const footnoteSource = source.split("#### 第 104 题")[0].replace("**个别**门店不健康", "**个别**门店不健康[^exam-q103-note-1]") + "\n[^exam-q103-note-1]: 私人提示\n";
    const footnoteHost = document.createElement("div"); footnoteHost.className = "markdown-preview-view"; host.append(footnoteHost);
    const component = new native.Component(); component.load(); children.push(component);
    await native.Renderer.render(app, footnoteSource, footnoteHost, filePath, component);
    if (!footnoteHost.querySelector(".exam-question-actions")) { const actions=document.createElement("span"); actions.className="exam-question-actions"; footnoteHost.querySelector(".callout-title")!.append(actions); }
    for (const processor of processors) await processor(footnoteHost, { sourcePath: "footnote.md", getSectionInfo: () => ({ text: footnoteSource, lineStart:0, lineEnd:footnoteSource.split("\n").length-1 }), addChild:(c:any)=>component.addChild(c) });
    const ref=footnoteHost.querySelector<HTMLAnchorElement>(".qt-study-option sup a[data-footref]")!;
    assert(ref && footnoteHost.querySelector('[id="'+ref.getAttribute("href")!.slice(1)+'"]'), "native footnote targets preserved");
    Array.from(footnoteHost.querySelectorAll<HTMLButtonElement>("button")).find(b=>b.textContent==="重做")!.click();
    assert(ref.parentElement!.classList.contains("qt-study-concealed") && footnoteHost.querySelector(".footnotes li")!.classList.contains("qt-study-concealed"), "hide personal footnotes during redo");
    passed.push("保留原生脚注跳转，重做时隐藏个人脚注提示");
    return { passed: passed.length, results: passed };
  } finally { children.forEach(c => c.unload()); host.remove(); }
}
