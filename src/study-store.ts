import { Plugin } from "obsidian";
import { Attempt, Letter, QuestionKind, normalizeLetters, StudyData, StudyQuestion, emptyAttempt, emptyMarks, groupFoldKey, originalAttempt, questionKey, readStudyData } from "./study-model";
import { ImportedExercise, ImportedQuestion } from "./study-import";

export type Session = { redo: boolean; selected: Letter[]; important: boolean; wholeUncertain: boolean; unknown: boolean; uncertainOptions: Letter[]; wrongOptions: Letter[]; recordId: string | null; busy: boolean };

export class StudyStore {
  private data: StudyData;
  private tail: Promise<unknown> = Promise.resolve();
  private sessions = new Map<string, Session>();
  private listeners = new Set<() => void>();
  constructor(private plugin: Plugin, private saved: Record<string, unknown>, private sourcePath = "") {
    const hasV3 = Object.prototype.hasOwnProperty.call(saved, "questionTrailV3");
    const hasV2 = Object.prototype.hasOwnProperty.call(saved, "questionTrailV2");
    if (hasV3 && (!saved.questionTrailV3 || typeof saved.questionTrailV3 !== "object" || (saved.questionTrailV3 as {version?: number}).version !== 3)) throw new Error("新版作答记录无法读取，已停止写入以保护原数据");
    if (!hasV3 && hasV2 && saved.questionTrailV2 == null) throw new Error("新版作答记录为空值，已停止写入以保护原数据");
    this.data = readStudyData(hasV3 ? saved.questionTrailV3 : hasV2 ? saved.questionTrailV2 : saved.questionTrail);
  }
  get sharedMaterialDefaultExpanded(): boolean {
    const settings = this.saved.questionTrailSettings;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return true;
    const value = (settings as Record<string, unknown>).sharedMaterialDefaultExpanded;
    return typeof value === "boolean" ? value : true;
  }
  session(key: string): Session {
    if (!this.sessions.has(key)) this.sessions.set(key, { redo: false, selected: [], ...emptyAttempt(), recordId: null, busy: false });
    return this.sessions.get(key)!;
  }
  records(key: string, question: StudyQuestion): Attempt[] { return this.data.questions[key] ?? [originalAttempt(question)]; }
  folded(path: string, materialId: string, kind: "group" | "material"): boolean { return this.data.groupFolds[groupFoldKey(path, materialId, kind)] ?? false; }
  groupRedoActive(path: string, blockIds: string[]): boolean { return blockIds.some(blockId => this.session(questionKey(path, blockId)).redo); }
  async startGroupRedo(path: string, materialId: string, blockIds: string[]) {
    const keys = blockIds.map(blockId => questionKey(path, blockId));
    if (keys.some(key => this.session(key).busy)) throw new Error("有题目正在保存，暂时不能开始整组重做");
    await this.mutate(data => {
      data.groupFolds[groupFoldKey(path, materialId, "group")] = false;
      data.groupFolds[groupFoldKey(path, materialId, "material")] = false;
    });
    for (const key of keys) {
      const session = this.session(key);
      if (!session.redo) Object.assign(session, { redo: true, selected: [], ...emptyAttempt() });
    }
    this.emit();
  }
  exitGroupRedo(path: string, blockIds: string[]) {
    const keys = blockIds.map(blockId => questionKey(path, blockId));
    if (keys.some(key => this.session(key).busy)) throw new Error("有题目正在保存，暂时不能退出整组重做");
    for (const key of keys) this.session(key).redo = false;
    this.emit();
  }
  async toggleFold(path: string, materialId: string, kind: "group" | "material") {
    const key = groupFoldKey(path, materialId, kind);
    await this.mutate(data => { data.groupFolds[key] = !data.groupFolds[key]; });
    this.emit();
  }
  async setSharedMaterialDefaultExpanded(expanded: boolean) {
    const task = this.tail.then(async () => {
      const current = this.saved.questionTrailSettings;
      const settings = current && typeof current === "object" && !Array.isArray(current)
        ? current as Record<string, unknown>
        : {};
      const saved = { ...this.saved, questionTrailSettings: { ...settings, sharedMaterialDefaultExpanded: expanded } };
      await this.plugin.saveData(saved);
      this.saved = saved;
    });
    this.tail = task.catch(() => {});
    await task;
    this.emit();
  }
  current(key: string, question: StudyQuestion): Attempt {
    const records = this.records(key, question);
    return records.find(r => r.id === this.session(key).recordId) ?? records[records.length - 1];
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  emit() { this.listeners.forEach(listener => listener()); }
  start(key: string) { Object.assign(this.session(key), { redo: true, selected: [], ...emptyAttempt() }); this.emit(); }
  exit(key: string) { this.session(key).redo = false; this.emit(); }
  pick(key: string, letter: Letter, kind: QuestionKind = "single") {
    const s = this.session(key);
    if (s.busy || kind === "subjective") return;
    s.selected = kind === "multiple"
      ? normalizeLetters(s.selected.includes(letter) ? s.selected.filter(item => item !== letter) : [...s.selected, letter])
      : s.selected.includes(letter) ? [] : [letter];
    this.emit();
  }
  async toggleFlag(key: string, q: StudyQuestion, flag: "important" | "wholeUncertain" | "unknown") {
    const s = this.session(key);
    if (s.redo) { s[flag] = !s[flag]; this.emit(); return; }
    const id = this.current(key, q).id;
    s.busy = true; this.emit();
    try { await this.mutate(data => { const record = (data.questions[key] ??= [originalAttempt(q)]).find(item => item.id === id); if (!record) throw new Error("作答记录已变化，请重新选择"); record[flag] = !record[flag]; }); }
    finally { s.busy = false; this.emit(); }
  }
  async toggleUncertain(key: string, q: StudyQuestion, letter: Letter) {
    const s = this.session(key);
    if (s.redo) { s.uncertainOptions = s.uncertainOptions.includes(letter) ? s.uncertainOptions.filter(item => item !== letter) : [...s.uncertainOptions, letter]; this.emit(); return; }
    const id = this.current(key, q).id;
    s.busy = true; this.emit();
    try { await this.mutate(data => { const record = (data.questions[key] ??= [originalAttempt(q)]).find(item => item.id === id); if (!record) throw new Error("作答记录已变化，请重新选择"); record.uncertainOptions = record.uncertainOptions.includes(letter) ? record.uncertainOptions.filter(item => item !== letter) : [...record.uncertainOptions, letter]; }); }
    finally { s.busy = false; this.emit(); }
  }
  async toggleWrong(key: string, q: StudyQuestion, letter: Letter) {
    const s = this.session(key);
    if (s.redo) { s.wrongOptions = s.wrongOptions.includes(letter) ? s.wrongOptions.filter(item => item !== letter) : [...s.wrongOptions, letter]; this.emit(); return; }
    const id = this.current(key, q).id;
    s.busy = true; this.emit();
    try { await this.mutate(data => { const record = (data.questions[key] ??= [originalAttempt(q)]).find(item => item.id === id); if (!record) throw new Error("作答记录已变化，请重新选择"); record.wrongOptions = record.wrongOptions.includes(letter) ? record.wrongOptions.filter(item => item !== letter) : [...record.wrongOptions, letter]; }); }
    finally { s.busy = false; this.emit(); }
  }
  selectRecord(key: string, id: string) { this.session(key).recordId = id; this.emit(); }
  binding(identity: string) { return this.data.bindings[identity] ?? null; }
  async importBatch(exercise: ImportedExercise, sourcePath: string, rows: { imported: ImportedQuestion; question: StudyQuestion }[]) {
    const sourceIds = new Set<string>();
    const targetIds = new Set<string>();
    for (const { imported, question } of rows) {
      if (!imported.supported || !imported.questionId || !question.blockId) throw new Error("导入条目缺少受支持的题目身份");
      if (question.kind !== "single" || question.options.length !== 4 || imported.type !== "single") throw new Error("旧导入格式仅支持四选项单选题目标");
      if (sourceIds.has(imported.questionId)) throw new Error(`导入批次存在重复来源题目：${imported.questionId}`);
      if (targetIds.has(question.blockId)) throw new Error(`多个来源题目指向同一目标块：^${question.blockId}`);
      if (imported.answer !== null && !["A", "B", "C", "D"].includes(imported.answer)) throw new Error("导入答案无法映射到 A–D");
      if (imported.uncertainOptions.some(letter => !["A", "B", "C", "D"].includes(letter))) throw new Error("选项不确定标记无法映射到 A–D");
      if (imported.wrongOptions?.some(letter => !["A", "B", "C", "D"].includes(letter))) throw new Error("选项错项标记无法映射到 A–D");
      sourceIds.add(imported.questionId);
      targetIds.add(question.blockId);
    }
    let added = 0, skipped = 0;
    await this.mutate(data => {
      for (const { imported, question } of rows) {
        const identity = JSON.stringify([exercise.paperId, exercise.paperVersion, imported.questionId]);
        const existingBinding = data.bindings[identity];
        if (existingBinding && (existingBinding.path !== sourcePath || existingBinding.blockId !== question.blockId)) throw new Error("来源题目已有不同的目标绑定");
        const key = questionKey(sourcePath, question.blockId);
        const uncertainOptions = [...new Set(imported.uncertainOptions)].sort((a, b) => ["A", "B", "C", "D"].indexOf(a) - ["A", "B", "C", "D"].indexOf(b));
        const syncOnly = exercise.sourceKind === "question-trail-sync";
        const records = data.questions[key] ??= [originalAttempt(question)];
        const sameSource = records.filter(record => record.source?.paperId === exercise.paperId && record.source.paperVersion === exercise.paperVersion && record.source.attemptId === exercise.attemptId && record.source.questionId === imported.questionId);
        const latest = sameSource[sameSource.length - 1];
        const wrongOptions = [...new Set(imported.wrongOptions ?? latest?.wrongOptions ?? [])].sort((a, b) => ["A", "B", "C", "D"].indexOf(a) - ["A", "B", "C", "D"].indexOf(b));
        const fingerprint = JSON.stringify(syncOnly
          ? [imported.answer, uncertainOptions, wrongOptions, imported.important, imported.wholeUncertain, imported.unknown]
          : [imported.answer, uncertainOptions, wrongOptions, imported.important, imported.wholeUncertain, imported.unknown, imported.note, imported.review, imported.result]);
        if (latest?.source?.fingerprint === fingerprint) { skipped++; continue; }
        const revision = (latest?.source?.revision ?? 0) + 1;
        records.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), kind: question.kind, selected: imported.answer === null ? [] : [imported.answer], answer: question.answer === null ? null : [...question.answer], marks: emptyMarks(), important: imported.important, wholeUncertain: imported.wholeUncertain, unknown: imported.unknown, uncertainOptions, wrongOptions, source: { paperId: exercise.paperId, paperVersion: exercise.paperVersion, attemptId: exercise.attemptId, questionId: imported.questionId, fingerprint, revision, note: syncOnly ? "" : imported.note, review: syncOnly ? false : imported.review, result: syncOnly ? "" : imported.result } });
        data.bindings[identity] = { path: sourcePath, blockId: question.blockId }; added++;
      }
    });
    this.emit();
    return { added, skipped };
  }
  private mutate(change: (data: StudyData) => void): Promise<void> {
    const task = this.tail.then(async () => {
      const next = structuredClone(this.data); change(next);
      const saved = { ...this.saved, questionTrailV3: next };
      await this.plugin.saveData(saved);
      this.data = next; this.saved = saved;
    });
    this.tail = task.catch(() => {});
    return task;
  }
  applyRecord(key: string, q: StudyQuestion, record: Attempt) {
    const s = this.session(key); s.recordId = record.id; s.selected = [...record.selected];
    s.important = record.important; s.wholeUncertain = record.wholeUncertain; s.unknown = record.unknown; s.uncertainOptions = [...record.uncertainOptions]; s.wrongOptions = [...record.wrongOptions];
  }
  async submit(key: string, q: StudyQuestion) {
    const s = this.session(key);
    if (!s.redo || s.busy || (q.kind !== "subjective" && !s.selected.length && !s.important && !s.wholeUncertain && !s.unknown && !s.uncertainOptions.length && !s.wrongOptions.length)) return;
    const attempt: Attempt = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), kind: q.kind, selected: normalizeLetters(s.selected), answer: q.answer === null ? null : [...q.answer], marks: emptyMarks(), ...emptyAttempt(), important: s.important, wholeUncertain: s.wholeUncertain, unknown: s.unknown, uncertainOptions: [...s.uncertainOptions], wrongOptions: [...s.wrongOptions] };
    s.busy = true; this.emit();
    try {
      await this.mutate(data => { (data.questions[key] ??= [originalAttempt(q)]).push(attempt); });
      s.recordId = attempt.id; s.redo = false;
    } finally { s.busy = false; this.emit(); }
  }
  async rename(oldPath: string, newPath: string) {
    const moved = (path: string) => path === oldPath ? newPath : path.startsWith(oldPath + "/") ? newPath + path.slice(oldPath.length) : null;
    await this.mutate(data => {
      for (const [key, attempts] of Object.entries(data.questions)) {
        const [path, block] = JSON.parse(key); const target = moved(path);
        if (!target) continue;
        const nextKey = questionKey(target, block);
        const existing = data.questions[nextKey] ?? [];
        // A move must not discard records already stored for the destination.
        data.questions[nextKey] = [...existing, ...attempts.map(a => existing.some(e => e.id === a.id) ? { ...a, id: crypto.randomUUID() } : a)];
        delete data.questions[key];
      }
      for (const [identity, binding] of Object.entries(data.bindings)) {
        const target = moved(binding.path);
        if (target) data.bindings[identity] = { ...binding, path: target };
      }
      const folded: StudyData["groupFolds"] = {};
      for (const [key, value] of Object.entries(data.groupFolds)) {
        const identity = JSON.parse(key) as [string, string, "group" | "material"];
        const target = moved(identity[0]);
        const nextKey = target ? groupFoldKey(target, identity[1], identity[2]) : key;
        if (Object.prototype.hasOwnProperty.call(folded, nextKey) && folded[nextKey] !== value) throw new Error("笔记重命名与现有题组折叠状态冲突");
        folded[nextKey] = value;
      }
      data.groupFolds = folded;
    });
    for (const [key, session] of [...this.sessions]) {
      const [path, block] = JSON.parse(key); const target = moved(path);
      if (target) { this.sessions.set(questionKey(target, block), session); this.sessions.delete(key); }
    }
    this.emit();
  }
}

const sharedStores = new WeakMap<Plugin, Promise<StudyStore>>();
export async function getStudyStore(plugin: Plugin): Promise<StudyStore> {
  let current = sharedStores.get(plugin);
  if (!current) {
    current = plugin.loadData().then(saved => new StudyStore(plugin, saved ?? {}));
    sharedStores.set(plugin, current);
  }
  try { return await current; }
  catch (error) { sharedStores.delete(plugin); throw error; }
}
