import { findExamQuestions } from "./markdown.js";
import { findCallouts } from "./callout-folds.js";

export const letters = ["A", "B", "C", "D"] as const;
export type Letter = typeof letters[number];
export type Mark = "none" | "certain" | "uncertain" | "excluded";
export type Marks = Record<Letter, Mark>;
export type Attempt = {
  id: string; createdAt: string | null; selected: Letter | null; answer: Letter | null; marks: Marks;
  important: boolean; wholeUncertain: boolean; unknown: boolean; uncertainOptions: Letter[]; wrongOptions: Letter[];
  legacyMarks?: Partial<Record<Letter, "certain" | "excluded">>;
  source?: { paperId: string; paperVersion: string; attemptId: string; questionId: string; fingerprint: string; revision: number; note: string; review: boolean; result: string };
};
export type StudyQuestion = {
  blockId: string; title: string; startLine: number; headerLine: number; endLine: number; rangeEndLine: number; materialIds: string[];
  stem: string; options: string[]; answer: Letter | null; original: Letter | null;
  extras: { start: number; end: number; kind: "metadata" | "detail" }[];
};
export type StudyGroup = { materialId: string; title: string; materialHeaderLine: number; materialEndLine: number; firstQuestionLine: number; lastQuestionLine: number; questionBlockIds: string[] };
export type StudyData = { version: 2; questions: Record<string, Attempt[]>; bindings: Record<string, { path: string; blockId: string }>; groupFolds: Record<string, boolean> };
export const emptyMarks = (): Marks => ({ A: "none", B: "none", C: "none", D: "none" });
export const emptyAttempt = (): Pick<Attempt, "important" | "wholeUncertain" | "unknown" | "uncertainOptions" | "wrongOptions"> => ({ important: false, wholeUncertain: false, unknown: false, uncertainOptions: [], wrongOptions: [] });
export const questionKey = (path: string, blockId: string) => JSON.stringify([path, blockId]);
export const groupFoldKey = (path: string, materialId: string, kind: "group" | "material") => JSON.stringify([path, materialId, kind]);
export const originalAttempt = (q: StudyQuestion): Attempt => ({ id: "original", createdAt: null, selected: q.original, answer: q.answer, marks: emptyMarks(), ...emptyAttempt() });
const asLetter = (value: string | undefined): Letter | null => letters.includes(value as Letter) ? value as Letter : null;

function displayHeadingStart(lines: string[], question: { title: string; headerLine: number }): number {
  for (let line = question.headerLine - 1; line >= 0; line -= 1) {
    const value = lines[line].trim();
    if (!value || /^<!--[\s\S]*-->$/.test(value)) continue;
    const heading = value.match(/^#{1,6}\s+(.+?)\s*#*$/);
    return heading?.[1].trim() === question.title ? line : question.headerLine;
  }
  return question.headerLine;
}

/** Only recognizable four-option questions are enhanced; rich Markdown stays intact. */
export function studyQuestions(source: string): StudyQuestion[] {
  const lines = source.split("\n");
  const callouts = findCallouts(source);
  const questions = findExamQuestions(source);
  const counts = new Map<string, number>();
  questions.forEach(q => { if (q.blockId) counts.set(q.blockId, (counts.get(q.blockId) ?? 0) + 1); });
  return questions.flatMap(q => {
    if (!q.blockId || counts.get(q.blockId) !== 1) return [];
    const parts = [""]; let index = 0;
    for (const line of q.innerLines) {
      const option = line.match(/^\s*([A-D])[.．、)）]\s*(.*)$/);
      if (option) {
        if (option[1] !== letters[index]) return [];
        index += 1; parts[index] = option[2];
      } else parts[index] += "\n" + line;
    }
    if (index !== 4 || parts.slice(1).some(p => !p.trim())) return [];
    // Use the next structural boundary as an exclusive end. In particular, a
    // following material must not become part of the preceding question's
    // metadata/callouts while its section is being post-processed.
    let end = q.endLine;
    while (end < lines.length && !/^#{1,6}\s|^>\s*\[!exam-question\]|^>\s*\[!exam-material\]|^\[\^[^\]]+\]:/.test(lines[end])) end += 1;
    const extras: StudyQuestion["extras"] = [];
    let answer: Letter | null = null;
    let original: Letter | null = null;
    for (let line = q.endLine; line < end; line += 1) {
      if (/^(标签|关联)[：:]/.test(lines[line])) {
        const start = line;
        while (line + 1 < end && lines[line + 1].trim() && !/^>|^#|^\^/.test(lines[line + 1])) line += 1;
        extras.push({ start, end: line + 1, kind: "metadata" });
      }
    }
    for (const block of callouts.filter(c => c.depth === 1 && c.line >= q.endLine && c.endLine <= end)) {
      const header = lines[block.line];
      if (!/^>\s*\[!(success|note)\][+-]?\s*(答案与解析|我的笔记)\s*$/.test(header)) continue;
      extras.push({ start: block.line, end: block.endLine, kind: "detail" });
      const body = lines.slice(block.line + 1, block.endLine).map(l => l.replace(/^>\s?/, "")).join("\n");
      if (block.type === "success") answer = asLetter(body.match(/^\s*(?:参考答案|正确答案|答案)[：:]\s*([A-D])(?:\s|[。.,，；;]|$)/m)?.[1]);
      original ||= asLetter(body.match(/^\s*(?:我的答案|我的作答)[：:]\s*([A-D])(?:\s|[。.,，；;]|$)/m)?.[1]);
    }
    return [{ blockId: q.blockId, title: q.title, startLine: displayHeadingStart(lines, q), headerLine: q.headerLine, endLine: q.endLine, rangeEndLine: Math.max(q.endLine, end - 1), materialIds: [...q.materialIds],
      stem: parts[0].trim(), options: parts.slice(1).map(s => s.trim()), answer, original, extras }];
  });
}

/** Group only contiguous, supported questions that each cite one unique earlier local exam-material block. */
export function studyGroups(source: string): StudyGroup[] {
  const lines = source.split("\n");
  const callouts = findCallouts(source);
  const allBlockIds = new Map<string, number>();
  lines.forEach(line => { const match = line.trim().match(/^\^([A-Za-z0-9_-]+)$/); if (match) allBlockIds.set(match[1], (allBlockIds.get(match[1]) ?? 0) + 1); });
  const materials = new Map<string, { title: string; headerLine: number; endLine: number }[]>();
  for (const record of callouts.filter(item => item.depth === 1 && item.type === "exam-material")) {
    let blockLine = record.endLine;
    while (blockLine < Math.min(lines.length, record.endLine + 5) && lines[blockLine].trim() === "") blockLine += 1;
    const blockId = lines[blockLine]?.trim().match(/^\^([A-Za-z0-9_-]+)$/)?.[1];
    if (!blockId) continue;
    const title = lines[record.line].match(/^>\s*\[!exam-material\][+-]?\s*(.*)$/)?.[1]?.trim() ?? "";
    const entries = materials.get(blockId) ?? [];
    entries.push({ title, headerLine: record.line, endLine: blockLine }); materials.set(blockId, entries);
  }
  const parsed = findExamQuestions(source);
  const supported = new Map(studyQuestions(source).map(question => [question.headerLine, question]));
  const sequence = parsed.map(question => {
    const valid = supported.get(question.headerLine);
    const ids = question.materialIds;
    const material = ids.length === 1 ? materials.get(ids[0]) : undefined;
    const materialId = ids.length === 1 && material?.length === 1 && (allBlockIds.get(ids[0]) ?? 0) === 1 && material[0].headerLine < question.headerLine ? ids[0] : null;
    return { raw: question, valid, materialId };
  });
  const groups: StudyGroup[] = [];
  let run: typeof sequence = [];
  const flush = () => {
    if (run.length >= 2 && run[0].materialId) {
      const first = run[0], last = run[run.length - 1], material = materials.get(first.materialId!)![0];
      groups.push({ materialId:first.materialId!, title:material.title, materialHeaderLine:material.headerLine, materialEndLine:material.endLine, firstQuestionLine:first.valid!.startLine, lastQuestionLine:last.valid!.rangeEndLine, questionBlockIds:run.map(item => item.valid!.blockId) });
    }
    run = [];
  };
  for (const item of sequence) {
    const candidate = item.valid && item.materialId;
    if (!candidate) { flush(); continue; }
    if (run.length && run[0].materialId !== item.materialId) flush();
    run.push(item);
  }
  flush();
  return groups;
}

/** Reject incompatible data instead of overwriting records we cannot understand. */
export function readStudyData(value: unknown): StudyData {
  if (value === undefined || value === null) return { version: 2, questions: {}, bindings: {}, groupFolds: {} };
  const data = value as { version: 1 | 2; questions: Record<string, Attempt[]> };
  if ((data.version !== 1 && data.version !== 2) || !data.questions || typeof data.questions !== "object" || Array.isArray(data.questions)) throw new Error("作答记录格式无法读取");
  const questions: Record<string, Attempt[]> = {};
  for (const [key, attempts] of Object.entries(data.questions)) {
    const identity = JSON.parse(key);
    if (!Array.isArray(identity) || identity.length !== 2 || !identity.every(v => typeof v === "string")) throw new Error("题目编号无效");
    if (!Array.isArray(attempts) || !attempts.length) throw new Error("作答记录为空");
    const ids = new Set<string>();
    for (const a of attempts) {
      if (!a || typeof a.id !== "string" || ids.has(a.id) || !(a.createdAt === null || typeof a.createdAt === "string") ||
        !(a.selected === null || letters.includes(a.selected)) || !(a.answer === null || letters.includes(a.answer)) ||
        !a.marks || !letters.every(k => ["none", "certain", "uncertain", "excluded"].includes(a.marks[k]))) throw new Error("作答记录损坏");
      ids.add(a.id);
    }
    questions[key] = attempts.map(raw => {
      const old = raw as Attempt;
      if (data.version === 2) {
        if (typeof old.important !== "boolean" || typeof old.wholeUncertain !== "boolean" || typeof old.unknown !== "boolean" || !Array.isArray(old.uncertainOptions) || old.uncertainOptions.some(letter => !letters.includes(letter))) throw new Error("新版作答记录标记无效");
      }
      if (old.wrongOptions !== undefined && (!Array.isArray(old.wrongOptions) || old.wrongOptions.some(letter => !letters.includes(letter)))) throw new Error("选项错项标记无效");
      if (old.source && (typeof old.source !== "object" || typeof old.source.paperId !== "string" || typeof old.source.paperVersion !== "string" || typeof old.source.attemptId !== "string" || typeof old.source.questionId !== "string" || typeof old.source.fingerprint !== "string" || typeof old.source.note !== "string" || typeof old.source.review !== "boolean")) throw new Error("导入来源记录损坏");
      const legacyMarks: Attempt["legacyMarks"] = { ...(old.legacyMarks ?? {}) };
      const uncertainOptions = data.version === 2 ? [...new Set(old.uncertainOptions)] : letters.filter(letter => old.marks[letter] === "uncertain");
      if (data.version === 1) for (const letter of letters) if (old.marks[letter] === "certain" || old.marks[letter] === "excluded") legacyMarks[letter] = old.marks[letter];
      const source = old.source ? { ...old.source, revision: Number.isInteger(old.source.revision) && old.source.revision > 0 ? old.source.revision : 1, result: typeof old.source.result === "string" ? old.source.result : "" } : undefined;
      return { ...old, ...emptyAttempt(), important: data.version === 2 ? old.important : false, wholeUncertain: data.version === 2 ? old.wholeUncertain : false, unknown: data.version === 2 ? old.unknown : false, uncertainOptions, wrongOptions: old.wrongOptions ? [...new Set(old.wrongOptions)] : [], ...(source ? { source } : {}), ...(Object.keys(legacyMarks).length ? { legacyMarks } : {}) };
    });
  }
  const bindings = data.version === 2 && (data as StudyData).bindings ? (data as StudyData).bindings : {};
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings) || Object.values(bindings).some(binding => !binding || typeof binding.path !== "string" || typeof binding.blockId !== "string")) throw new Error("导入题目绑定格式无法读取");
  const groupFolds = data.version === 2 && (data as StudyData).groupFolds ? (data as StudyData).groupFolds : {};
  if (!groupFolds || typeof groupFolds !== "object" || Array.isArray(groupFolds) || Object.entries(groupFolds).some(([key, value]) => { let identity: unknown; try { identity = JSON.parse(key); } catch { return true; } return !Array.isArray(identity) || identity.length !== 3 || !identity.every(part => typeof part === "string") || (identity[2] !== "group" && identity[2] !== "material") || typeof value !== "boolean"; })) throw new Error("题组折叠记录格式无法读取");
  return { version: 2, questions, bindings, groupFolds };
}
