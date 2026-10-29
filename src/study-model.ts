import { findExamQuestions, structuralLineMask } from "./markdown.js";
import { findCallouts } from "./callout-folds.js";

export const letters = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"] as const;
export type QuestionKind = "single" | "multiple" | "judgment" | "subjective";
export const legacyLetters = letters.slice(0, 4);
export const normalizeLetters = (values: Letter[]): Letter[] => [...new Set(values)].sort((a, b) => letters.indexOf(a) - letters.indexOf(b));
export type Letter = typeof letters[number];
export type Mark = "none" | "certain" | "uncertain" | "excluded";
export type Marks = Record<Letter, Mark>;
export type Attempt = {
  id: string; createdAt: string | null; kind: QuestionKind; selected: Letter[]; answer: Letter[] | null; marks: Marks;
  important: boolean; wholeUncertain: boolean; unknown: boolean; uncertainOptions: Letter[]; wrongOptions: Letter[];
  legacyMarks?: Partial<Record<Letter, "certain" | "excluded">>;
  source?: { paperId: string; paperVersion: string; attemptId: string; questionId: string; fingerprint: string; revision: number; note: string; review: boolean; result: string };
};
export type StudyQuestion = {
  blockId: string; title: string; startLine: number; headerLine: number; endLine: number; rangeEndLine: number; materialIds: string[];
  kind: QuestionKind; stem: string; options: string[]; answer: Letter[] | null; original: Letter[];
  extras: { start: number; end: number; kind: "metadata" | "detail" }[];
};
export type StudyGroup = { materialId: string; title: string; materialHeaderLine: number; materialEndLine: number; firstQuestionLine: number; lastQuestionLine: number; questionBlockIds: string[] };
export type StudyData = { version: 3; questions: Record<string, Attempt[]>; bindings: Record<string, { path: string; blockId: string }>; groupFolds: Record<string, boolean> };
export const emptyMarks = (): Marks => Object.fromEntries(letters.map(letter => [letter, "none"])) as Marks;
export const emptyAttempt = (): Pick<Attempt, "important" | "wholeUncertain" | "unknown" | "uncertainOptions" | "wrongOptions"> => ({ important: false, wholeUncertain: false, unknown: false, uncertainOptions: [], wrongOptions: [] });
export const questionKey = (path: string, blockId: string) => JSON.stringify([path, blockId]);
export const groupFoldKey = (path: string, materialId: string, kind: "group" | "material") => JSON.stringify([path, materialId, kind]);
export const originalAttempt = (q: StudyQuestion): Attempt => ({ id: "original", createdAt: null, kind: q.kind, selected: [...q.original], answer: q.answer === null ? null : [...q.answer], marks: emptyMarks(), ...emptyAttempt() });
function parseAnswer(value: string | undefined, kind: QuestionKind, options: string[]): Letter[] | null {
  if (!value?.trim() || kind === "subjective") return null;
  const text = value.trim().replace(/[。；;]$/, "").trim();
  if (kind === "judgment") {
    const matches = options.flatMap((option, index) => option.trim() === text ? [letters[index]] : []);
    if (matches.length === 1) return matches;
  }
  if (!/^[A-Z](?:[\s,，、|]*[A-Z])*$/.test(text)) return null;
  const values = text.match(/[A-Z]/g) as Letter[];
  if (new Set(values).size !== values.length || values.some(letter => letters.indexOf(letter) >= options.length) || (kind !== "multiple" && values.length !== 1)) return null;
  return normalizeLetters(values);
}

/** Recognize options outside fenced code, indented code and display math. */
function questionParts(innerLines: string[], kind: QuestionKind | null): string[] | null {
  if (kind === "subjective") return [innerLines.join("\n").trim()];
  const parts = [""]; let index = 0;
  const structural = structuralLineMask(innerLines.join("\n"));
  for (const [lineIndex, line] of innerLines.entries()) {
    const option = structural[lineIndex] ? line.match(/^ {0,3}([A-Z])[.．、)）]\s*(.*)$/) : null;
    if (option) {
      if (option[1] !== letters[index] || index >= letters.length) return null;
      index += 1; parts[index] = option[2];
    } else parts[index] += "\n" + line;
  }
  if (index < 2 || parts.slice(1).some(part => !part.trim()) || (!kind && index !== 4) || (kind === "judgment" && index !== 2)) return null;
  return parts.map(part => part.trim());
}

function displayHeadingStart(lines: string[], question: { title: string; headerLine: number }): number {
  for (let line = question.headerLine - 1; line >= 0; line -= 1) {
    const value = lines[line].trim();
    if (!value || /^<!--[\s\S]*-->$/.test(value)) continue;
    const heading = value.match(/^#{1,6}\s+(.+?)\s*#*$/);
    return heading?.[1].trim() === question.title ? line : question.headerLine;
  }
  return question.headerLine;
}

/** Explicit kinds support A–Z; untyped legacy questions retain four-option single choice. */
export function studyQuestions(source: string): StudyQuestion[] {
  const lines = source.split("\n");
  const callouts = findCallouts(source);
  const structural = structuralLineMask(source);
  const questions = findExamQuestions(source);
  const counts = new Map<string, number>();
  questions.forEach(q => { if (q.blockId) counts.set(q.blockId, (counts.get(q.blockId) ?? 0) + 1); });
  return questions.flatMap(q => {
    if (!q.blockId || counts.get(q.blockId) !== 1) return [];
    const end = q.metadataEndLine;
    const declarations = lines.slice(q.endLine, end).filter((line, index) => structural[q.endLine + index] && /^题型[：:]/.test(line));
    const kinds = new Map<string, QuestionKind>([["单选", "single"], ["多选", "multiple"], ["判断", "judgment"], ["主观题", "subjective"]]);
    const declaredKind = declarations.length === 1 ? kinds.get(declarations[0].replace(/^题型[：:]\s*/, "").trim()) ?? null : null;
    if (declarations.length && !declaredKind) return [];
    const parts = questionParts(q.innerLines, declaredKind);
    if (!parts) return [];
    const kind = declaredKind ?? "single";
    const options = parts.slice(1);
    const extras: StudyQuestion["extras"] = [];
    let answer: Letter[] | null = null;
    let answerBlocks = 0;
    let original: Letter[] = [];
    for (let line = q.endLine; line < end; line += 1) {
      if (/^(标签|关联)[：:]/.test(lines[line])) {
        const start = line;
        while (line + 1 < end && lines[line + 1].trim() && !/^>|^#|^\^|^题型[：:]/.test(lines[line + 1])) line += 1;
        extras.push({ start, end: line + 1, kind: "metadata" });
      }
    }
    for (const block of callouts.filter(c => c.depth === 1 && c.line >= q.endLine && c.endLine <= end && structural[c.line])) {
      const header = lines[block.line];
      if (!/^>\s*\[!(success|note)\][+-]?\s*(答案与解析|我的笔记)\s*$/.test(header)) continue;
      extras.push({ start: block.line, end: block.endLine, kind: "detail" });
      const body = lines.slice(block.line + 1, block.endLine).map(l => l.replace(/^>\s?/, "")).join("\n");
      if (block.type === "success") {
        answerBlocks += 1;
        const declarations = lines.slice(block.line + 1, block.endLine).flatMap((line, index) => {
          if (!structural[block.line + 1 + index]) return [];
          const match = line.replace(/^>\s?/, "").match(/^\s*(?:参考答案|正确答案|答案)[：:]([^\n]*)$/);
          return match ? [match[1]] : [];
        });
        answer = answerBlocks === 1 && declarations.length === 1 ? parseAnswer(declarations[0], kind, options) : null;
      }
      if (!original.length) original = parseAnswer(body.match(/^\s*(?:我的答案|我的作答)[：:]([^\n]*)$/m)?.[1], kind, options) ?? [];
    }
    const referenceCount = lines.slice(q.endLine, end).filter((line, index) => structural[q.endLine + index] && /^\s*(?:参考答案|正确答案|答案)[：:]/.test(line.replace(/^>\s?/, ""))).length;
    if (referenceCount !== 1) answer = null;
    return [{ blockId: q.blockId, title: q.title, startLine: displayHeadingStart(lines, q), headerLine: q.headerLine, endLine: q.endLine, rangeEndLine: Math.max(q.endLine, end - 1), materialIds: [...q.materialIds], kind,
      stem: parts[0], options, answer, original, extras }];
  });
}

/** Group only contiguous, supported questions that each cite one unique earlier local exam-material block. */
export function studyGroups(source: string, questions = studyQuestions(source)): StudyGroup[] {
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
  const supported = new Map(questions.map(question => [question.headerLine, question]));
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
  if (value === undefined || value === null) return { version: 3, questions: {}, bindings: {}, groupFolds: {} };
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("作答记录格式无法读取");
  const data = value as { version: number; questions: Record<string, any[]>; bindings?: StudyData["bindings"]; groupFolds?: StudyData["groupFolds"] };
  if (![1, 2, 3].includes(data.version) || !data.questions || typeof data.questions !== "object" || Array.isArray(data.questions)) throw new Error("作答记录格式无法读取");
  const isLetters = (items: unknown, allowed: readonly string[] = letters): items is Letter[] => Array.isArray(items) && items.every(item => typeof item === "string" && allowed.includes(item)) && new Set(items).size === items.length;
  const questions: Record<string, Attempt[]> = {};
  for (const [key, attempts] of Object.entries(data.questions)) {
    let identity: unknown;
    try { identity = JSON.parse(key); } catch { throw new Error("题目编号无效"); }
    if (!Array.isArray(identity) || identity.length !== 2 || !identity.every(v => typeof v === "string")) throw new Error("题目编号无效");
    if (!Array.isArray(attempts) || !attempts.length) throw new Error("作答记录为空");
    const ids = new Set<string>();
    questions[key] = attempts.map(old => {
      const v3 = data.version === 3;
      const validAnswer = v3 ? old?.answer === null || isLetters(old?.answer) && old.answer.length > 0 : old?.answer === null || legacyLetters.includes(old?.answer);
      const validSelected = v3 ? isLetters(old?.selected) : old?.selected === null || legacyLetters.includes(old?.selected);
      const kind: QuestionKind = v3 ? old?.kind : "single";
      if (!old || typeof old.id !== "string" || ids.has(old.id) || !(old.createdAt === null || typeof old.createdAt === "string") || !validAnswer || !validSelected || !["single", "multiple", "judgment", "subjective"].includes(kind) ||
        !old.marks || typeof old.marks !== "object" || Array.isArray(old.marks) || !(v3 ? letters : legacyLetters).every(letter => ["none", "certain", "uncertain", "excluded"].includes(old.marks[letter]))) throw new Error("作答记录损坏");
      ids.add(old.id);
      const selected: Letter[] = v3 ? normalizeLetters(old.selected) : old.selected === null ? [] : [old.selected];
      const answer: Letter[] | null = old.answer === null ? null : v3 ? normalizeLetters(old.answer) : [old.answer];
      if (kind !== "multiple" && (selected.length > 1 || (answer?.length ?? 0) > 1) || kind === "subjective" && (selected.length > 0 || answer !== null)) throw new Error("题型与作答记录不符");
      const allowed = v3 ? letters : legacyLetters;
      if (data.version >= 2 && (typeof old.important !== "boolean" || typeof old.wholeUncertain !== "boolean" || typeof old.unknown !== "boolean" || !isLetters(old.uncertainOptions, allowed))) throw new Error("新版作答记录标记无效");
      if ((v3 || old.wrongOptions !== undefined) && !isLetters(old.wrongOptions, allowed)) throw new Error("选项错项标记无效");
      if (v3 && old.source !== undefined && (!old.source || typeof old.source !== "object" || Array.isArray(old.source) || !Number.isInteger(old.source.revision) || old.source.revision <= 0 || typeof old.source.result !== "string")) throw new Error("新版导入来源记录损坏");
      if (old.source && (typeof old.source !== "object" || typeof old.source.paperId !== "string" || typeof old.source.paperVersion !== "string" || typeof old.source.attemptId !== "string" || typeof old.source.questionId !== "string" || typeof old.source.fingerprint !== "string" || typeof old.source.note !== "string" || typeof old.source.review !== "boolean")) throw new Error("导入来源记录损坏");
      if (old.legacyMarks !== undefined && (!old.legacyMarks || typeof old.legacyMarks !== "object" || Array.isArray(old.legacyMarks) || Object.entries(old.legacyMarks).some(([letter, mark]) => !allowed.includes(letter as Letter) || (mark !== "certain" && mark !== "excluded")))) throw new Error("旧选项标记损坏");
      const legacyMarks: NonNullable<Attempt["legacyMarks"]> = { ...(old.legacyMarks ?? {}) };
      const uncertainOptions = data.version >= 2 ? normalizeLetters(old.uncertainOptions) : legacyLetters.filter(letter => old.marks[letter] === "uncertain");
      if (data.version === 1) for (const letter of legacyLetters) if (old.marks[letter] === "certain" || old.marks[letter] === "excluded") legacyMarks[letter] = old.marks[letter];
      const source = old.source ? { ...old.source, revision: Number.isInteger(old.source.revision) && old.source.revision > 0 ? old.source.revision : 1, result: typeof old.source.result === "string" ? old.source.result : "" } : undefined;
      return { ...old, ...emptyAttempt(), kind, selected, answer, marks: { ...emptyMarks(), ...old.marks }, important: data.version >= 2 ? old.important : false, wholeUncertain: data.version >= 2 ? old.wholeUncertain : false, unknown: data.version >= 2 ? old.unknown : false, uncertainOptions, wrongOptions: old.wrongOptions ? normalizeLetters(old.wrongOptions) : [], ...(source ? { source } : {}), ...(Object.keys(legacyMarks).length ? { legacyMarks } : {}) };
    });
  }
  const bindings = data.version === 3 ? data.bindings : data.version >= 2 && data.bindings !== undefined ? data.bindings : {};
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings) || Object.values(bindings).some(binding => !binding || typeof binding.path !== "string" || typeof binding.blockId !== "string")) throw new Error("导入题目绑定格式无法读取");
  const groupFolds = data.version === 3 ? data.groupFolds : data.version >= 2 && data.groupFolds !== undefined ? data.groupFolds : {};
  if (!groupFolds || typeof groupFolds !== "object" || Array.isArray(groupFolds) || Object.entries(groupFolds).some(([key, value]) => { let identity: unknown; try { identity = JSON.parse(key); } catch { return true; } return !Array.isArray(identity) || identity.length !== 3 || !identity.every(part => typeof part === "string") || (identity[2] !== "group" && identity[2] !== "material") || typeof value !== "boolean"; })) throw new Error("题组折叠记录格式无法读取");
  return { version: 3, questions, bindings: structuredClone(bindings), groupFolds: { ...groupFolds } };
}
