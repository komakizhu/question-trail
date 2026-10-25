import { Letter, letters } from "./study-model";

export type ImportedQuestion = { questionId: string; number: string; section: string; type: string; answer: Letter | null; uncertainOptions: Letter[]; wrongOptions?: Letter[]; important: boolean; wholeUncertain: boolean; unknown: boolean; note: string; review: boolean; result: string; supported: boolean; reason?: string };
export type ImportedExercise = { schemaVersion: number; paperId: string; paperVersion: string; attemptId: string; name: string; questions: ImportedQuestion[]; sourceKind: "answer-card" | "question-trail-sync" };
function validateIdentity(exercise: ImportedExercise): ImportedExercise {
  if (!exercise.paperId || !exercise.paperVersion || !exercise.attemptId || !exercise.questions.length) throw new Error("作答记录缺少试卷、作答或题目身份");
  const seen = new Set<string>();
  for (const question of exercise.questions) {
    if (!question.questionId) throw new Error("作答记录缺少 questionId");
    if (seen.has(question.questionId)) throw new Error(`作答记录存在重复 questionId：${question.questionId}`);
    seen.add(question.questionId);
  }
  return exercise;
}
const obj = (v: any, label: string) => { if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(label + "格式无效"); return v; };
const bool = (value: unknown, label: string): boolean => { if (value === undefined) return false; if (typeof value !== "boolean") throw new Error(`${label} 必须是布尔值`); return value; };
const letter = (value: unknown, labels?: string[], ids?: string[]): Letter | null => {
  if (value == null || value === "" || (Array.isArray(value) && !value.length)) return null;
  if (Array.isArray(value)) { if (value.length !== 1) return null; value = value[0]; }
  if (typeof value !== "string") return null;
  if (letters.includes(value as Letter)) return value as Letter;
  const index = ids?.indexOf(value) ?? -1; const label = index >= 0 ? labels?.[index] : value;
  const match = label?.match(/^\s*([A-D])(?:[.、．)）\s]|$)/);
  return match ? match[1] as Letter : null;
};
const parseQuestion = (raw: any, version: number): ImportedQuestion => {
  const q = obj(raw,"题目");
  if (q.uncertainOptions !== undefined && !Array.isArray(q.uncertainOptions)) throw new Error("选项不确定标记必须是数组");
  if (q.wrongOptions !== undefined && !Array.isArray(q.wrongOptions)) throw new Error("选项错项标记必须是数组");
  const labels: string[] = Array.isArray(q.options) ? q.options.map((o: any) => typeof o === "string" ? o : String(o?.label ?? "")) : [];
  const ids: string[] = Array.isArray(q.optionIds) ? q.optionIds : Array.isArray(q.options) && q.options.some((o:any)=>typeof o==="object") ? q.options.map((o:any)=>String(o.id ?? "")) : [];
  const answer = letter(q.answer,labels,ids);
  const uncertainRaw = Array.isArray(q.uncertainOptions) ? q.uncertainOptions : [];
  const uncertainOptions = uncertainRaw.map((x:unknown)=>letter(x,labels,ids)).filter((x:Letter|null):x is Letter=>x!==null);
  const wrongRaw = Array.isArray(q.wrongOptions) ? q.wrongOptions : [];
  const wrongOptions = wrongRaw.map((x:unknown)=>letter(x,labels,ids)).filter((x:Letter|null):x is Letter=>x!==null);
  const type = String(q.type ?? ""); const supported = type === "single" && labels.length === 4 && labels.every((v,i)=>v.startsWith(letters[i]));
  const unmappedUncertain = uncertainRaw.some((value: unknown) => letter(value, labels, ids) === null);
  const unmappedWrong = wrongRaw.some((value: unknown) => letter(value, labels, ids) === null);
  const valid = supported && !unmappedUncertain && !unmappedWrong && (answer !== null || q.answer == null || q.answer === "");
  return { questionId:String(q.questionId ?? ""), number:String(q.number ?? q.displayNumber ?? ""), section:String(q.section ?? ""), type, answer, uncertainOptions, ...(q.wrongOptions !== undefined ? { wrongOptions } : {}), important:bool(q.important,"important"), wholeUncertain:bool(q.wholeUncertain,"wholeUncertain"), unknown:bool(q.unknown,"unknown"), note:String(q.note ?? ""), review:q.review===true, result:String(q.result ?? ""), supported:valid, ...(!valid?{reason:!supported?"仅支持四选项单选题":unmappedWrong?"错项标记无法映射到 A–D":unmappedUncertain?"不确定选项无法映射到 A–D":"答案无法映射到 A–D"}:{}) };
};
export function parseAnswerCardJson(text:string): ImportedExercise {
  const root=obj(JSON.parse(text.replace(/^\uFEFF/,"")),"JSON");
  if(root.type==="question-trail-sync" && root.schemaVersion===1) {
    if(!Array.isArray(root.questions)) throw new Error("题迹同步包缺少题目");
    const questions=root.questions.map((raw:any)=>{
      const q=obj(raw,"题迹同步题目");
      const allowed = new Set(["questionId","number","section","type","answer","uncertainOptions","wrongOptions","important","wholeUncertain","unknown","supported","reason"]);
      if (Object.keys(q).some(key => !allowed.has(key))) throw new Error("题迹 Skill 同步包只能包含答案和标记，不接受题目正文或笔记字段");
      const parsed=parseQuestion({...q,options:letters},2);
      const flagsValid=Array.isArray(q.uncertainOptions)&&q.uncertainOptions.every((v:unknown)=>letters.includes(v as Letter));
      const wrongFlagsValid=q.wrongOptions===undefined||Array.isArray(q.wrongOptions)&&q.wrongOptions.every((v:unknown)=>letters.includes(v as Letter));
      const payloadValid=q.supported===true&&q.type==="single"&&flagsValid&&wrongFlagsValid&&(q.answer===null||letters.includes(q.answer as Letter))&&typeof q.important==="boolean"&&typeof q.wholeUncertain==="boolean"&&typeof q.unknown==="boolean";
      parsed.supported=payloadValid&&parsed.supported;
      if(!parsed.supported) parsed.reason=String(q.reason||parsed.reason||"同步记录无法明确映射到 A–D");
      return parsed;
    });
    return validateIdentity({schemaVersion:1,paperId:String(root.paperId??""),paperVersion:String(root.paperVersion??""),attemptId:String(root.attemptId??""),name:String(root.name??"Skill 作答同步"),questions,sourceKind:"question-trail-sync"});
  }
  if(root.type!=="answer-recorder-attempt" || (root.schemaVersion!==2 && root.schemaVersion!==3)) throw new Error("只支持答题卡 v2/v3 作答 JSON");
  const ex=obj(root.exercise,"作答记录"); if(!Array.isArray(ex.questions)) throw new Error("作答记录缺少题目");
  return validateIdentity({schemaVersion:root.schemaVersion,paperId:String(ex.paperId??""),paperVersion:String(ex.paperVersion??""),attemptId:String(ex.attemptId??""),name:String(ex.name??""),questions:ex.questions.map((q:any)=>parseQuestion(q,root.schemaVersion)),sourceKind:"answer-card"});
}
function csvRows(text:string):string[][] {
  const source=text.replace(/^\uFEFF/,"");
  const rows:string[][]=[];
  let row:string[]=[], cell="", quoted=false, closedQuote=false;
  for(let i=0;i<source.length;i++) {
    const c=source[i];
    if(quoted) {
      if(c==='"'&&source[i+1]==='"'){cell+='"';i++;}
      else if(c==='"'){quoted=false;closedQuote=true;}
      else cell+=c;
    } else if(closedQuote&&c!==","&&c!=="\n"&&c!=="\r") {
      throw new Error("CSV 闭合引号后存在多余内容");
    } else if(c==='"') {
      if(cell)throw new Error("CSV 引号位置无效");
      quoted=true;
    } else if(c===",") {
      row.push(cell);cell="";closedQuote=false;
    } else if(c==="\n"||c==="\r") {
      if(c==="\r"&&source[i+1]==="\n")i++;
      row.push(cell);if(row.some(v=>v!==""))rows.push(row);
      row=[];cell="";closedQuote=false;
    } else cell+=c;
  }
  if(quoted)throw new Error("CSV 引号未闭合");
  if(cell||row.length){row.push(cell);if(row.some(v=>v!==""))rows.push(row);}
  return rows;
}
const jsonCell=(v:string)=>{if(!v)return undefined;try{return JSON.parse(v)}catch{throw new Error("CSV JSON 扩展字段无效")}};
export function parseAnswerCardCsv(text:string):ImportedExercise {
  const rows=csvRows(text);
  if(rows.length<2)throw new Error("CSV 没有作答记录");
  const headers=rows[0];
  if(new Set(headers).size!==headers.length||headers.some(v=>!v))throw new Error("CSV 列名缺失或重复");
  if(rows.slice(1).some(row=>row.length!==headers.length))throw new Error("CSV 存在列数不一致的行");
  const col=(r:string[],k:string)=>r[headers.indexOf(k)]??"";
  const first=rows[1];
  const version=Number(col(first,"schema_version"));
  if(version!==2&&version!==3)throw new Error("只支持答题卡 v2/v3 作答 CSV");
  for(const row of rows.slice(1)) {
    if(Number(col(row,"schema_version"))!==version||col(row,"paper_id")!==col(first,"paper_id")||col(row,"paper_version")!==col(first,"paper_version")||col(row,"attempt_id")!==col(first,"attempt_id"))
      throw new Error("CSV 中的试卷、版本、作答身份或 schema_version 不一致");
  }
  const questions=rows.slice(1).map(r=>{
    const answer=version===3?(jsonCell(col(r,"answer_json"))??null):(col(r,"answer")||null);
    const options=version===3?jsonCell(col(r,"options_json"))??[]:letters;
    const csvBool=(name:string)=>{const value=col(r,name);if(value==="true")return true;if(value==="false"||value==="")return false;throw new Error(`CSV 字段 ${name} 必须是 true/false`);};
    const hasWrongOptions = headers.includes(version===3 ? "wrong_option_ids_json" : "wrong_options");
    const q={questionId:col(r,"question_id"),number:col(r,"question_number"),section:col(r,"section"),type:col(r,"question_type"),options,optionIds:version===3?options.map((o:any)=>o.id):[],answer,uncertainOptions:version===3?(jsonCell(col(r,"uncertain_option_ids_json"))??[]):(col(r,"uncertain_options")||"").split("|").filter(Boolean),...(hasWrongOptions?{wrongOptions:version===3?(jsonCell(col(r,"wrong_option_ids_json"))??[]):(col(r,"wrong_options")||"").split("|").filter(Boolean)}:{}),important:csvBool("important_flag"),wholeUncertain:csvBool("whole_uncertain_flag"),unknown:csvBool("unknown_flag"),note:version===3?(jsonCell(col(r,"note_json"))??col(r,"note")):col(r,"note"),review:csvBool("review_flag")};
    const parsed=parseQuestion(q,version);
    if(version===2){parsed.supported=col(r,"question_type")==="single"&&parsed.supported;parsed.reason=parsed.supported?undefined:"仅支持四选项单选题或选项标记无法映射";}
    return parsed;
  });
  return validateIdentity({schemaVersion:version,paperId:col(first,"paper_id"),paperVersion:col(first,"paper_version"),attemptId:col(first,"attempt_id"),name:col(first,"exercise_name"),questions,sourceKind:"answer-card"});
}
export function parseAnswerCardFile(text:string,name:string){return name.toLowerCase().endsWith(".csv")?parseAnswerCardCsv(text):parseAnswerCardJson(text)}
