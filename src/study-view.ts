import { MarkdownPostProcessorContext, MarkdownRenderChild, MarkdownRenderer, MarkdownView, Notice, Plugin } from "obsidian";
import { codeFolding, foldEffect, unfoldEffect } from "@codemirror/language";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import type { Range, StateEffect } from "@codemirror/state";
import { Letter, StudyGroup, StudyQuestion, letters, questionKey, studyGroups, studyQuestions } from "./study-model";
import { StudyStore, getStudyStore } from "./study-store";
import { extractBlockById } from "./markdown.js";

/** Apply the same neutral detail-callout style in Live Preview, where Markdown post-processors do not run. */
class StudyExtraCalloutEditor {
  private source = "";
  private detailTypes = new Map<number, string>();

  constructor(private view: EditorView) { this.refresh(); }

  update(_update: ViewUpdate) { this.refresh(); }

  private refresh() {
    const source = this.view.state.doc.toString();
    if (source !== this.source) {
      this.source = source;
      this.detailTypes = new Map();
      const lines = source.split("\n");
      for (const question of studyQuestions(source)) {
        for (const extra of question.extras) {
          if (extra.kind !== "detail") continue;
          const type = lines[extra.start]?.match(/^>\s*\[!(success|note)\]/)?.[1];
          if (type) this.detailTypes.set(extra.start, type);
        }
      }
    }

    for (const callout of Array.from(this.view.dom.querySelectorAll<HTMLElement>(".callout[data-callout]"))) {
      if (callout.closest(".qt-study-body")) continue;
      let line: number;
      try { line = this.view.state.doc.lineAt(this.view.posAtDOM(callout, 0)).number - 1; }
      catch { continue; }
      callout.classList.toggle("qt-study-extra", this.detailTypes.get(line) === callout.dataset.callout);
    }
  }

  destroy() { this.view.dom.querySelectorAll(".callout.qt-study-extra").forEach(callout => callout.classList.remove("qt-study-extra")); }
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag); el.className = className; el.textContent = text; return el;
}
/** Turn tab-indented note lists into valid Markdown only in reading view. */
function normalizeIndentedNoteCallout(raw: string): string | null {
  const sourceLines = raw.split("\n");
  if (!/^>\s*\[!note\][+-]?\s*我的笔记\s*$/.test(sourceLines[0] ?? "")) return null;
  // Remove the quote marker without consuming a tab: the tab is the source's
  // indentation signal and must be normalized rather than discarded.
  const bodyLines = sourceLines.slice(1).map(line => line.replace(/^> ?/, ""));
  if (!bodyLines.some(line => /^[\t ]*\t[\t ]*[-*+]\s+/.test(line))) return null;

  const output: string[] = [];
  let listOpen = false;
  for (const line of bodyLines) {
    if (!line.trim()) { output.push(""); continue; }
    const match = line.match(/^([ \t]*)(.*)$/)!;
    const sourceIndent = match[1];
    const tabs = (sourceIndent.match(/\t/g) ?? []).length;
    const spaces = sourceIndent.replace(/\t/g, "").length;
    const content = match[2];
    const marker = content.match(/^([-*+]\s+|\d+[.)]\s+)/);
    if (marker) {
      const indent = spaces + Math.max(0, tabs - 1) * 2;
      if (!listOpen && output.length && output.at(-1)?.trim()) output.push("");
      output.push(" ".repeat(indent) + content);
      listOpen = true;
      continue;
    }
    if (listOpen && tabs > 0) {
      const indent = spaces + Math.max(2, tabs * 2 - 2);
      output.push(" ".repeat(indent) + content);
      continue;
    }
    if (listOpen && !sourceIndent) {
      if (output.length && output.at(-1)?.trim()) output.push("");
      listOpen = false;
    }
    output.push(sourceIndent.replace(/\t/g, "  ") + content);
  }
  return output.join("\n");
}
function button(label: string, action: () => void): HTMLButtonElement {
  const el = node("button", "qt-study-button", label); el.type = "button";
  el.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); action(); });
  return el;
}
function report(error: unknown) { console.error("题迹：作答记录保存失败", error); new Notice("作答记录未保存，请重试"); }

export function historyLabels(records: ReturnType<StudyStore["records"]>) {
  const groups = new Map<string, { number: number; revision: number }>();
  let number = 0;
  return records.map(record => {
    if (record.id === "original" && !record.selected) return { id: record.id, label: "未作答" };
    const identity = record.source ? JSON.stringify([record.source.paperId, record.source.paperVersion, record.source.attemptId, record.source.questionId]) : record.id;
    let group = groups.get(identity);
    if (!group) { group = { number: ++number, revision: 0 }; groups.set(identity, group); }
    const importedRevision = record.source?.revision ?? 1;
    const revision = record.source ? Math.max(group.revision + 1, importedRevision) : 1;
    group.revision = revision;
    return { id: record.id, label: `第${group.number}次${record.source && revision > 1 ? ` · 修订${revision - 1}` : ""}` };
  });
}

function groupRangeLabel(group: StudyGroup, questions: StudyQuestion[]): string {
  const numbers = group.questionBlockIds.map(id => questions.find(question => question.blockId === id)?.title.match(/第\s*(\d+)\s*题/)?.[1]).filter((value): value is string => !!value);
  if (numbers.length !== group.questionBlockIds.length) return `共${group.questionBlockIds.length}题`;
  const values = numbers.map(Number);
  const range = values.every(Number.isInteger) && values.every((value, index) => index === 0 || value === values[index - 1] + 1) ? `第${numbers[0]}–${numbers[numbers.length - 1]}题` : `第${numbers.join("、")}题`;
  return `${range} · 共${group.questionBlockIds.length}题`;
}

type PreviewSection = { el: HTMLElement; rendered: boolean; computed: boolean };
type PreviewRenderer = { sections: PreviewSection[]; previewEl: HTMLElement; measureSection: (section: PreviewSection) => void; updateVirtualDisplay: (scrollTop?: number) => void };
const pendingGroupLayouts = new WeakMap<object, { raf: number; requests: Map<string, { materialId: string; anchor: HTMLElement; failOpen: () => void }> }>();

function queueGroupLayout(plugin: Plugin, path: string, materialId: string, anchor: HTMLElement, failOpen: () => void) {
  const renderer = plugin.app.workspace.getLeavesOfType("markdown").map(item => (item.view as any)?.previewMode?.renderer as PreviewRenderer | undefined)
    .find(candidate => candidate?.sections.some(section => section.el === anchor || section.el.contains(anchor)));
  if (!renderer) return;
  let state = pendingGroupLayouts.get(renderer as object);
  if (!state) { state = { raf: 0, requests: new Map() }; pendingGroupLayouts.set(renderer as object, state); }
  state.requests.set(materialId, { materialId, anchor, failOpen });
  if (state.raf) return;
  state.raf = requestAnimationFrame(() => {
    state!.raf = 0;
    const requests = [...state!.requests.values()]; state!.requests.clear();
    try {
      if (!renderer.previewEl.isConnected || typeof renderer.measureSection !== "function" || typeof renderer.updateVirtualDisplay !== "function") throw new Error("Obsidian 阅读视图不支持题组布局协调");
      const scrollTop = renderer.previewEl.scrollTop;
      const anchors = requests.map(request => ({ request, top: request.anchor.getBoundingClientRect().top }));
      const affected = renderer.sections.filter(section => section.rendered && section.el.isConnected && requests.some(request => section.el.dataset.qtGroup === request.materialId || section.el === request.anchor || section.el.contains(request.anchor)));
      for (const section of affected) renderer.measureSection(section);
      renderer.updateVirtualDisplay(scrollTop);
      for (const section of affected) if (section.el.isConnected) renderer.measureSection(section);
      renderer.updateVirtualDisplay(scrollTop);
      const anchor = anchors.find(item => item.request.anchor.isConnected);
      if (anchor) renderer.previewEl.scrollTop += anchor.request.anchor.getBoundingClientRect().top - anchor.top;
    } catch (error) {
      console.error("题迹：题组布局更新失败", error);
      for (const request of requests) request.failOpen();
      new Notice("题组折叠暂不可用，已恢复显示");
    }
  });
}

function ensureGroupControls(plugin: Plugin, callout: HTMLElement, group: StudyGroup, path: string, questions: StudyQuestion[], store: StudyStore, registerCleanup?: (cleanup: () => void) => void) {
  const title = callout.querySelector<HTMLElement>(":scope > .callout-title");
  if (!title) return;
  callout.classList.add("qt-study-group-header");
  callout.dataset.qtMaterialId = group.materialId;
  let controls = title.querySelector<HTMLElement>(":scope > .qt-study-group-controls");
  const rangeLabel = groupRangeLabel(group, questions);
  let created = false;
  if (controls) {
    const range = controls.querySelector<HTMLElement>(".qt-study-group-range");
    if (range && range.textContent !== rangeLabel) range.textContent = rangeLabel;
  }
  if (!controls) {
    created = true;
    controls = document.createElement("div"); controls.className = "qt-study-group-controls";
    const range = document.createElement("span"); range.className = "qt-study-group-range"; range.textContent = rangeLabel; controls.append(range);
    const redoGroup = button("整组重做", () => {
      try {
        if (store.groupRedoActive(path, group.questionBlockIds)) store.exitGroupRedo(path, group.questionBlockIds);
        else void store.startGroupRedo(path, group.materialId, group.questionBlockIds).catch(report);
      } catch(error) { report(error); }
    });
    redoGroup.classList.add("qt-study-group-redo"); redoGroup.setAttribute("aria-label", "整组重做"); redoGroup.title = "让本组每道题分别进入重做";
    const foldGroup = button("收起题组", () => { void store.toggleFold(path, group.materialId, "group").catch(report); });
    foldGroup.classList.add("qt-study-group-toggle"); foldGroup.setAttribute("aria-label", "收起题组"); foldGroup.title = "收起或展开整组题目";
    const foldMaterial = button("收起材料", () => { void store.toggleFold(path, group.materialId, "material").catch(report); });
    foldMaterial.classList.add("qt-study-material-toggle"); foldMaterial.setAttribute("aria-label", "收起共用材料"); foldMaterial.title = "只收起或展开共用材料";
    controls.append(redoGroup, foldGroup, foldMaterial); title.append(controls);
  }
  const foldGroup = controls.querySelector<HTMLButtonElement>(".qt-study-group-toggle");
  const foldMaterial = controls.querySelector<HTMLButtonElement>(".qt-study-material-toggle");
  const redoGroup = controls.querySelector<HTMLButtonElement>(".qt-study-group-redo");
  if (!foldGroup || !foldMaterial || !redoGroup) return;
  const update = () => {
    const groupFolded = store.folded(path, group.materialId, "group"); const materialFolded = store.folded(path, group.materialId, "material");
    const groupRedo = store.groupRedoActive(path, group.questionBlockIds);
    const layoutChanged = callout.classList.contains("qt-study-group-folded") !== groupFolded || callout.classList.contains("qt-study-material-folded") !== materialFolded;
    callout.classList.toggle("qt-study-group-folded", groupFolded);
    callout.classList.toggle("qt-study-material-folded", materialFolded);
    if (layoutChanged) queueGroupLayout(plugin, path, group.materialId, callout, () => callout.classList.remove("qt-study-group-folded", "qt-study-material-folded"));
    const redoLabel = groupRedo ? "退出整组重做" : "整组重做"; if (redoGroup.textContent !== redoLabel) redoGroup.textContent = redoLabel;
    redoGroup.setAttribute("aria-label", redoLabel); redoGroup.title = groupRedo ? "退出整组重做" : "让本组每道题分别进入重做";
    const groupLabel = groupFolded ? "展开题组" : "收起题组"; if (foldGroup.textContent !== groupLabel) foldGroup.textContent = groupLabel;
    foldGroup.setAttribute("aria-label", groupLabel); foldGroup.title = groupLabel;
    const materialLabel = materialFolded ? "展开材料" : "收起材料"; if (foldMaterial.textContent !== materialLabel) foldMaterial.textContent = materialLabel;
    foldMaterial.setAttribute("aria-label", materialLabel); foldMaterial.title = materialLabel;
  };
  update();
  if (created && registerCleanup) {
    const unsubscribe = store.subscribe(update);
    registerCleanup(() => { unsubscribe(); controls?.remove(); callout.classList.remove("qt-study-group-header", "qt-study-group-folded", "qt-study-material-folded"); delete callout.dataset.qtMaterialId; });
  }
}

class StudyGroupEditor {
  private decorations: DecorationSet = Decoration.none;
  private source = "";
  private groups: StudyGroup[] = [];
  private questions: StudyQuestion[] = [];
  private applied = new Map<string, { from: number; to: number }>();
  private pendingGroupControls = new WeakSet<HTMLElement>();
  private unsubscribe: (() => void) | null = null;
  constructor(private view: EditorView, private plugin: Plugin, private store: StudyStore) {
    this.unsubscribe = store.subscribe(() => this.refresh());
    this.refresh();
  }
  get lineDecorations() { return this.decorations; }
  update(update: ViewUpdate) {
    if (update.docChanged) this.applied = new Map([...this.applied].map(([key, range]) => [key, { from: update.changes.mapPos(range.from), to: update.changes.mapPos(range.to) }]));
    if (update.docChanged || update.viewportChanged) this.refresh();
  }
  private refresh() {
    const source = this.view.state.doc.toString();
    if (source !== this.source) { this.source = source; this.groups = studyGroups(source); this.questions = studyQuestions(source); }
    const groups = this.groups; const questions = this.questions;
    const file = this.plugin.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? this.plugin.app.workspace.getActiveFile();
    const path = file?.path ?? "";
    const livePreview = !!this.view.dom.closest(".markdown-source-view.is-live-preview");
    if (!livePreview) {
      this.decorations = Decoration.none;
      this.syncFoldRanges([], path);
      return;
    }
    const lineDecorations: Range<Decoration>[] = [];
    for (const group of groups) {
      if (this.store.folded(path, group.materialId, "group")) continue;
      for (let line = group.firstQuestionLine + 1; line <= group.lastQuestionLine + 1 && line <= this.view.state.doc.lines; line += 1) {
        lineDecorations.push(Decoration.line({ class: "qt-study-group-editor-member" }).range(this.view.state.doc.line(line).from));
      }
    }
    this.decorations = Decoration.set(lineDecorations, true);
    for (const callout of Array.from(this.view.dom.querySelectorAll<HTMLElement>(".callout[data-callout='exam-material']"))) {
      let line: number;
      try { line = this.view.state.doc.lineAt(this.view.posAtDOM(callout, 0)).number - 1; } catch { continue; }
      const group = groups.find(item => item.materialHeaderLine === line);
      if (!group) continue;
      if (!callout.querySelector(":scope > .callout-title .qt-study-group-controls")) {
        if (this.pendingGroupControls.has(callout)) continue;
        this.pendingGroupControls.add(callout);
        requestAnimationFrame(() => {
          this.pendingGroupControls.delete(callout);
          if (!this.view.dom.isConnected || !callout.isConnected || callout.closest(".markdown-source-view") !== this.view.dom.closest(".markdown-source-view")) return;
          ensureGroupControls(this.plugin, callout, group, path, questions, this.store);
        });
      } else ensureGroupControls(this.plugin, callout, group, path, questions, this.store);
    }
    this.decorations = Decoration.set(lineDecorations, true);
    this.syncFoldRanges(groups, path);
  }
  private lineRange(startLine: number, endLine: number) {
    const doc = this.view.state.doc; const start = startLine + 1; const end = endLine + 1;
    if (start < 1 || end > doc.lines || end < start) return null;
    const from = doc.line(start).from; const to = doc.line(end).to;
    return to > from ? { from, to } : null;
  }
  private syncFoldRanges(groups: StudyGroup[], path: string) {
    const desired = new Map<string, { from: number; to: number }>();
    for (const group of groups) {
      if (this.store.folded(path, group.materialId, "group")) {
        const range = this.lineRange(group.materialHeaderLine + 1, group.lastQuestionLine);
        if (range) desired.set(`group:${group.materialId}`, range);
      } else if (this.store.folded(path, group.materialId, "material")) {
        const range = this.lineRange(group.materialHeaderLine + 1, group.materialEndLine);
        if (range) desired.set(`material:${group.materialId}`, range);
      }
    }
    const effects: StateEffect<any>[] = [];
    for (const [key, range] of this.applied) {
      const next = desired.get(key);
      if (!next || next.from !== range.from || next.to !== range.to) effects.push(unfoldEffect.of(range));
    }
    for (const [key, range] of desired) {
      const previous = this.applied.get(key);
      if (!previous || previous.from !== range.from || previous.to !== range.to) effects.push(foldEffect.of(range));
    }
    this.applied = desired;
    if (effects.length) queueMicrotask(() => { if (this.view.state.doc.toString() === this.source && this.view.dom.isConnected) this.view.dispatch({ effects }); });
  }
  destroy() { this.unsubscribe?.(); this.unsubscribe = null; }
}

async function mountQuestion(plugin: Plugin, store: StudyStore, callout: HTMLElement, q: StudyQuestion, context: MarkdownPostProcessorContext) {
  if (callout.classList.contains("qt-study-question")) return;
  const content = callout.querySelector<HTMLElement>(":scope > .callout-content");
  const actions = callout.querySelector<HTMLElement>(":scope > .callout-title .exam-question-actions");
  if (!content || !actions) return;
  const key = questionKey(context.sourcePath, q.blockId);
  const child = new MarkdownRenderChild(callout); context.addChild(child);
  // Keep native footnote targets: rendering an isolated option lacks the file's definitions.
  const references = new Map<string, HTMLElement[]>();
  content.querySelectorAll<HTMLElement>("sup.footnote-ref").forEach(ref => {
    const id = ref.querySelector("a")?.getAttribute("data-footref");
    if (id) { const list = references.get(id) ?? []; list.push(ref); references.set(id, list); }
  });
  const renderMarkdown = async (markdown: string, target: HTMLElement) => {
    // The real definitions remain in the native document footer. Temporary definitions
    // make Obsidian render reference nodes that we replace with their original targets.
    const definitions = [...references.keys()].map(id => `[^${id}]: .`).join("\n");
    await MarkdownRenderer.render(plugin.app, markdown + (definitions ? "\n\n" + definitions : ""), target, context.sourcePath, child);
    target.querySelectorAll(".footnotes").forEach(el => el.remove());
  };
  let disposed = false;
  child.register(() => { disposed = true; });
  const body = node("div", "qt-study-body");
  const sourceFile = plugin.app.vault.getAbstractFileByPath(context.sourcePath);
  const source = sourceFile ? await plugin.app.vault.cachedRead(sourceFile as any) : "";
  const blockCounts = new Map<string, number>();
  source.split("\n").forEach(line => { const id = line.trim().match(/^\^([A-Za-z0-9_-]+)$/)?.[1]; if (id) blockCounts.set(id, (blockCounts.get(id) ?? 0) + 1); });
  const material = q.materialIds.length === 1 && blockCounts.get(q.materialIds[0]) === 1 ? extractBlockById(source, q.materialIds[0]) : null;
  const materialDisclosure = material ? node("details", "qt-study-question-material") : null;
  let materialDisclosureTouched = false;
  if (material && materialDisclosure) {
    const summary = node("summary", "", "共用题干");
    materialDisclosure.open = store.sharedMaterialDefaultExpanded;
    summary.addEventListener("click", () => { materialDisclosureTouched = true; });
    const materialBody = node("div", "qt-study-question-material-body");
    materialDisclosure.append(summary, materialBody); body.append(materialDisclosure);
    await renderMarkdown(material.innerLines.join("\n"), materialBody);
  }
  const flags = node("div", "qt-study-flags");
  const flagButtons = new Map<string, HTMLButtonElement>();
  for (const [flag, symbol, label] of [["important", "★", "重要"], ["wholeUncertain", "○", "整题不确定"], ["unknown", "?", "不会做"]] as const) {
    const control = button(symbol, () => { if (!store.session(key).busy) void store.toggleFlag(key, q, flag).catch(report); });
    control.setAttribute("aria-label", label); control.title = label; control.dataset.flag = flag; flags.append(control); flagButtons.set(flag, control);
  }
  const history = node("select", "qt-study-history"); history.setAttribute("aria-label", "作答记录"); history.title = "选择一次作答记录";
  const stem = node("div", "qt-study-stem"); body.append(stem);
  await renderMarkdown(q.stem, stem);
  const rows: { row: HTMLElement; pick: HTMLButtonElement; uncertain: HTMLButtonElement; wrong: HTMLButtonElement }[] = [];
  for (const [index, letter] of letters.entries()) {
    const row = node("div", "qt-study-option"); row.dataset.option = letter;
    const pick = button(letter, () => { if (store.session(key).redo && !store.session(key).busy) store.pick(key, letter); });
    pick.classList.add("qt-study-letter"); pick.setAttribute("aria-label", "选择 " + letter);
    const text = node("div", "qt-study-option-body");
    await renderMarkdown(q.options[index], text);
    const uncertain = button("不确定", () => { if (!store.session(key).busy) void store.toggleUncertain(key, q, letter).catch(report); });
    uncertain.classList.add("qt-study-uncertain"); uncertain.setAttribute("aria-label", letter + " 选项不确定");
    const wrong = button("错项", () => { if (!store.session(key).busy) void store.toggleWrong(key, q, letter).catch(report); });
    wrong.classList.add("qt-study-wrong"); wrong.setAttribute("aria-label", letter + " 选项错项");
    const optionControls = node("div", "qt-study-option-controls"); optionControls.append(uncertain, wrong);
    row.append(pick, text, optionControls); body.append(row); rows.push({ row, pick, uncertain, wrong });
  }
  const bottom = node("div", "qt-study-bottom");
  const status = node("span", "qt-study-status"); status.setAttribute("role", "status");
  const check = button("核对答案", () => { void store.submit(key, q).catch(report); });
  bottom.append(status, check); body.append(bottom);
  if (disposed) return;
  body.querySelectorAll<HTMLElement>("sup.footnote-ref").forEach(ref => {
    const id = ref.querySelector("a")?.getAttribute("data-footref");
    const original = id && references.get(id)?.shift();
    if (original) ref.replaceWith(original.cloneNode(true));
  });
  const privateRefs = Array.from(body.querySelectorAll<HTMLAnchorElement>("sup a[data-footref]")).filter(a => a.getAttribute("data-footref")?.startsWith("exam-" + q.blockId + "-note-"));
  const hiddenFootnotes = new Set<Element>();
  const refreshFootnotes = () => {
    const root = callout.closest(".markdown-preview-view, .markdown-embed") ?? callout.parentElement;
    for (const ref of privateRefs) {
      const target = ref.getAttribute("href")?.slice(1);
      const definition = target && root?.querySelector("[id=" + JSON.stringify(target) + "]");
      if (definition) { hiddenFootnotes.add(definition); definition.classList.toggle("qt-study-concealed", store.session(key).redo); }
      ref.parentElement?.classList.toggle("qt-study-concealed", store.session(key).redo);
    }
  };
  const footnoteObserver = new MutationObserver(refreshFootnotes);
  child.register(() => { footnoteObserver.disconnect(); hiddenFootnotes.forEach(el => el.classList.remove("qt-study-concealed")); });
  const originalNodes = Array.from(content.childNodes);
  const title = callout.querySelector<HTMLElement>(":scope > .callout-title");
  const titleInner = title?.querySelector<HTMLElement>(":scope > .callout-title-inner");
  const originalTitleNodes = title ? Array.from(title.childNodes) : [];
  content.replaceChildren(body); callout.classList.add("qt-study-question");
  if (!q.extras.length) callout.classList.add("qt-study-question-end");
  const toggle = button("重做", () => {
    if (store.session(key).busy) return;
    if (store.session(key).redo) store.exit(key); else store.start(key);
  });
  actions.prepend(toggle);
  const toolbar = node("div", "qt-study-toolbar");
  if (titleInner) toolbar.append(titleInner);
  toolbar.append(history);
  while (actions.firstChild) toolbar.append(actions.firstChild);
  toolbar.append(flags);
  body.insertBefore(toolbar, stem);
  title?.replaceChildren();
  history.addEventListener("change", () => { store.selectRecord(key, history.value); });
  const update = () => {
    if (materialDisclosure && !materialDisclosureTouched) materialDisclosure.open = store.sharedMaterialDefaultExpanded;
    const session = store.session(key); const record = store.current(key, q);
    const selected = session.redo ? session.selected : record.selected;
    const uncertainOptions = session.redo ? session.uncertainOptions : record.uncertainOptions;
    const wrongOptions = session.redo ? session.wrongOptions : record.wrongOptions;
    const answer = session.redo ? null : record.answer;
    const important = session.redo ? session.important : record.important;
    const wholeUncertain = session.redo ? session.wholeUncertain : record.wholeUncertain;
    const unknown = session.redo ? session.unknown : record.unknown;
    const questionTone = unknown ? "unknown" : wholeUncertain ? "uncertain" : important ? "important" : "";
    if (questionTone) callout.dataset.qtQuestionTone = questionTone;
    else delete callout.dataset.qtQuestionTone;
    toggle.textContent = session.redo ? "退出重做" : "重做"; toggle.disabled = session.busy;
    flagButtons.forEach((control, flag) => { const active = session.redo ? session[flag as "important" | "wholeUncertain" | "unknown"] : record[flag as "important" | "wholeUncertain" | "unknown"]; control.setAttribute("aria-pressed", String(active)); control.classList.toggle("is-active", active); control.disabled = session.busy; });
    history.disabled = session.busy;
    const records = store.records(key, q);
    const labels = historyLabels(records);
    history.replaceChildren(...records.map((r, i) => {
      const option = node("option", "", labels[i].label); option.value = r.id;
      if (r.createdAt) option.title = [new Date(r.createdAt).toLocaleString(), r.source?.result ? `批改：${r.source.result}` : "", r.source?.note || ""].filter(Boolean).join(" · ");
      return option;
    }));
    if (session.redo) {
      const completedAttemptCount = labels.reduce((max, item) => Math.max(max, Number(item.label.match(/^第(\d+)次/)?.[1] ?? 0)), 0);
      const draft = node("option", "", `第${completedAttemptCount + 1}次 · 作答中`); draft.value = "__draft"; history.append(draft); history.value = draft.value;
    } else history.value = record.id;
    rows.forEach(({ row, pick, uncertain, wrong: wrongButton }, i) => {
      const letter = letters[i]; const wrong = !session.redo && !!answer && selected === letter && letter !== answer;
      const correct = !session.redo && letter === answer;
      const unsure = uncertainOptions.includes(letter);
      const markedWrong = wrong || wrongOptions.includes(letter);
      row.dataset.tone = correct ? "correct" : markedWrong ? (unsure ? "uncertain-wrong" : "wrong") : unsure ? "uncertain" : "none";
      row.dataset.uncertain = String(unsure);
      row.dataset.chosen = String(selected === letter);
      row.setAttribute("aria-label", [letter, unsure ? "不确定" : "", wrongOptions.includes(letter) ? "错项" : "", correct ? "正确答案" : wrong ? "错选" : "", selected === letter ? "已选" : ""].filter(Boolean).join("，"));
      pick.disabled = !session.redo || session.busy;
      pick.setAttribute("aria-pressed", String(selected === letter)); uncertain.setAttribute("aria-pressed", String(unsure)); uncertain.classList.toggle("is-active", unsure); uncertain.disabled = session.busy;
      wrongButton.setAttribute("aria-pressed", String(wrongOptions.includes(letter))); wrongButton.classList.toggle("is-active", wrongOptions.includes(letter)); wrongButton.disabled = session.busy;
    });
    bottom.hidden = !session.redo;
    status.textContent = selected ? "已选 " + selected : "未作答";
    check.textContent = session.busy ? "保存中" : q.answer ? "核对答案" : "保存作答";
    check.disabled = session.busy || (!selected && !session.important && !session.wholeUncertain && !session.unknown && !session.uncertainOptions.length && !session.wrongOptions.length);
    footnoteObserver.disconnect(); refreshFootnotes();
    const root = callout.closest(".markdown-preview-view, .markdown-embed");
    if (session.redo && privateRefs.length && root) footnoteObserver.observe(root, { childList: true, subtree: true });
  };
  child.register(store.subscribe(update)); update();
  child.register(() => { toggle.remove(); callout.classList.remove("qt-study-question", "qt-study-question-end"); delete callout.dataset.qtQuestionTone; if (body.parentNode === content) content.replaceChildren(...originalNodes); if (title) title.replaceChildren(...originalTitleNodes); });
}

function spaceTags(element: HTMLElement) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  for (const text of textNodes) {
    if (text.parentElement?.closest("a, code, pre")) continue;
    text.textContent = text.textContent?.replace(/标签[：:]\s*/g, "标签： ") ?? "";
  }
  element.querySelectorAll("a.tag").forEach(tag => {
    if (tag.nextSibling?.nodeType === Node.TEXT_NODE) {
      const next = tag.nextSibling as Text; if (!/^\s/.test(next.data)) next.data = " " + next.data;
    } else tag.after(document.createTextNode(" "));
  });
}

export async function registerQuestionStudy(plugin: Plugin) {
  let store: StudyStore;
  try { store = await getStudyStore(plugin); }
  catch (error) { console.error(error); new Notice("题迹：作答记录无法读取，已保留原数据；答题功能暂未启用"); return; }
  plugin.registerEditorExtension(codeFolding());
  plugin.registerEditorExtension(ViewPlugin.fromClass(StudyExtraCalloutEditor));
  class BoundStudyGroupEditor extends StudyGroupEditor { constructor(view: EditorView) { super(view, plugin, store); } }
  plugin.registerEditorExtension(ViewPlugin.fromClass(BoundStudyGroupEditor, { decorations: value => value.lineDecorations }));
  let cachedSource = ""; let cachedQuestions: StudyQuestion[] = []; let cachedGroups: StudyGroup[] = [];
  plugin.registerEvent(plugin.app.vault.on("rename", (file, oldPath) => { void store.rename(oldPath, file.path).catch(report); }));
  plugin.registerMarkdownPostProcessor(async (element, context) => {
    // Editable source retains native editing; nested Markdown rendering must not recurse.
    if (element.closest(".markdown-source-view, .qt-study-body, .qt-study-note-rendering")) return;
    const section = context.getSectionInfo(element);
    if (!section) return;
    if (section.text !== cachedSource) { cachedSource = section.text; cachedQuestions = studyQuestions(section.text); cachedGroups = studyGroups(section.text); }
    const questions = cachedQuestions;
    const groups = cachedGroups;
    const callouts = [...(element.matches(".callout[data-callout='exam-question']") ? [element] : []), ...Array.from(element.querySelectorAll<HTMLElement>(".callout[data-callout='exam-question']"))];
    const materialCallouts = [...(element.matches(".callout[data-callout='exam-material']") ? [element] : []), ...Array.from(element.querySelectorAll<HTMLElement>(".callout[data-callout='exam-material']"))];
    for (const callout of materialCallouts) {
      const info = context.getSectionInfo(callout);
      const group = groups.find(item => info && item.materialHeaderLine >= info.lineStart && item.materialHeaderLine <= info.lineEnd);
      if (!group || callout.querySelector(":scope > .callout-title .qt-study-group-controls")) continue;
      const child = new MarkdownRenderChild(callout); context.addChild(child);
      ensureGroupControls(plugin, callout, group, context.sourcePath, questions, store, cleanup => child.register(cleanup));
    }
    for (const callout of callouts) {
      const info = context.getSectionInfo(callout);
      const title = callout.querySelector(":scope > .callout-title > .callout-title-inner")?.textContent?.trim();
      const candidates = questions.filter(q => info && q.headerLine >= info.lineStart && q.headerLine <= info.lineEnd && q.title === title);
      if (candidates.length === 1) await mountQuestion(plugin, store, callout, candidates[0], context);
    }
    const grouped = groups.find(group => section.lineStart >= group.firstQuestionLine && section.lineEnd <= group.lastQuestionLine);
    if (grouped) {
      const child = new MarkdownRenderChild(element); context.addChild(child);
      const inner = document.createElement("span"); inner.className = "qt-study-group-content";
      const original = Array.from(element.childNodes); inner.append(...original); element.append(inner);
      const updateGroup = () => {
        const collapsed = store.folded(context.sourcePath, grouped.materialId, "group");
        const layoutChanged = element.classList.contains("qt-study-group-collapsed") !== collapsed;
        element.classList.add("qt-study-group-member");
        element.classList.toggle("qt-study-group-collapsed", collapsed);
        element.dataset.qtGroup = grouped.materialId;
        if (!layoutChanged) return;
        const root = element.closest<HTMLElement>(".markdown-preview-sizer");
        queueGroupLayout(plugin, context.sourcePath, grouped.materialId, root?.querySelector<HTMLElement>(`[data-qt-material-id="${CSS.escape(grouped.materialId)}"]`) ?? element, () => {
          root?.querySelectorAll<HTMLElement>(`.qt-study-group-member[data-qt-group="${CSS.escape(grouped.materialId)}"]`).forEach(member => member.classList.remove("qt-study-group-collapsed"));
          root?.querySelectorAll<HTMLElement>(".qt-study-group-content").forEach(content => { content.hidden = false; });
        });
      };
      child.register(store.subscribe(updateGroup)); updateGroup();
      child.register(() => { element.classList.remove("qt-study-group-member", "qt-study-group-collapsed"); delete element.dataset.qtGroup; inner.replaceWith(...Array.from(inner.childNodes)); });
    }
    const owner = questions.find(q => q.extras.some(extra => section.lineStart >= extra.start && section.lineEnd < extra.end));
    if (!owner) return;
    const child = new MarkdownRenderChild(element); context.addChild(child);
    const key = questionKey(context.sourcePath, owner.blockId);
    const metadata = owner.extras.some(extra => extra.kind === "metadata" && section.lineStart >= extra.start && section.lineEnd < extra.end);
    const raw = section.text.split("\n").slice(section.lineStart, section.lineEnd + 1).join("\n");
    if (metadata && /^标签[：:]\S/m.test(raw)) {
      const original = Array.from(element.childNodes);
      const normalized = node("div");
      await MarkdownRenderer.render(plugin.app, raw.replace(/^(标签[：:])(?=\S)/gm, "$1 "), normalized, context.sourcePath, child);
      element.replaceChildren(...Array.from(normalized.childNodes));
      child.register(() => { element.replaceChildren(...original); });
    }
    const normalizedNote = normalizeIndentedNoteCallout(raw);
    const detailContent = element.querySelector<HTMLElement>(":scope > .callout-content");
    if (normalizedNote && detailContent) {
      const references = new Map<string, HTMLElement[]>();
      detailContent.querySelectorAll<HTMLElement>("sup.footnote-ref").forEach(ref => {
        const id = ref.querySelector("a")?.getAttribute("data-footref");
        if (id) { const list = references.get(id) ?? []; list.push(ref); references.set(id, list); }
      });
      const definitions = [...references.keys()].map(id => `[^${id}]: .`).join("\n");
      const normalized = node("div", "qt-study-note-rendering");
      await MarkdownRenderer.render(plugin.app, normalizedNote + (definitions ? "\n\n" + definitions : ""), normalized, context.sourcePath, child);
      normalized.querySelectorAll(".footnotes").forEach(el => el.remove());
      normalized.querySelectorAll<HTMLElement>("sup.footnote-ref").forEach(ref => {
        const id = ref.querySelector("a")?.getAttribute("data-footref");
        const original = id && references.get(id)?.shift();
        if (original) ref.replaceWith(original.cloneNode(true));
      });
      const original = Array.from(detailContent.childNodes);
      detailContent.replaceChildren(...Array.from(normalized.childNodes));
      child.register(() => { detailContent.replaceChildren(...original); });
    }
    element.classList.add("qt-study-extra"); spaceTags(element);
    const lastExtra = owner.extras.at(-1);
    if (lastExtra && section.lineStart >= lastExtra.start && section.lineEnd < lastExtra.end) element.classList.add("qt-study-question-end");
    const update = () => { element.classList.toggle("qt-study-concealed", store.session(key).redo); };
    child.register(store.subscribe(update)); update();
    child.register(() => { element.classList.remove("qt-study-extra", "qt-study-concealed", "qt-study-question-end"); });
  }, 20);
}
