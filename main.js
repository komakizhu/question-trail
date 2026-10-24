"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ExamNotesPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian2 = require("obsidian");

// src/callout-fold-sync.ts
var import_obsidian = require("obsidian");
var import_view = require("@codemirror/view");

// src/callout-folds.js
function findCallouts(source) {
  const records = [];
  const stack = [];
  let offset = 0;
  let previousDepth = 0;
  let fence = null;
  const lines = source.split("\n");
  for (let line = 0; line < lines.length; line += 1) {
    const raw = lines[line];
    const prefix = raw.match(/^(?: {0,3}>[ \t]?)+/)?.[0] ?? "";
    const depth = (prefix.match(/>/g) ?? []).length;
    const content = raw.slice(prefix.length).replace(/\r$/, "");
    while (stack.length && stack.at(-1).depth > depth) {
      Object.assign(stack.pop(), { endLine: line, to: offset });
    }
    if (fence && depth < fence.depth) fence = null;
    if (fence) {
      const closing = content.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (depth === fence.depth && closing?.[1][0] === fence.char && closing[1].length >= fence.length) fence = null;
    } else {
      const opening = content.match(/^ {0,3}(`{3,}|~{3,})/);
      if (opening) {
        fence = { depth, char: opening[1][0], length: opening[1].length };
      } else if (depth > previousDepth) {
        const header = content.match(/^(\[!([^\]|]+)(?:\|[^\]]*)?\])([+-]?)(?:[ \t]|$)/);
        if (header) {
          const record = {
            line,
            endLine: lines.length,
            from: offset,
            to: source.length,
            depth,
            type: header[2].toLowerCase(),
            fold: header[3],
            marker: offset + prefix.length + header[1].length
          };
          records.push(record);
          stack.push(record);
        }
      }
    }
    previousDepth = depth;
    offset += raw.length + 1;
  }
  return records;
}
function withoutFoldStates(source) {
  const parts = [];
  let from = 0;
  for (const item of findCallouts(source)) {
    if (!item.fold) continue;
    parts.push(source.slice(from, item.marker), "?");
    from = item.marker + 1;
  }
  parts.push(source.slice(from));
  return parts.join("");
}
function setCalloutFold(current, snapshot, record, collapsed) {
  if (!record?.fold) return null;
  if (current !== snapshot && withoutFoldStates(current) !== withoutFoldStates(snapshot)) return null;
  const sign = collapsed ? "-" : "+";
  return current.slice(0, record.marker) + sign + current.slice(record.marker + 1);
}
function matchRenderedCallout(records, renderedTypes, index) {
  if (index < 0 || records.length !== renderedTypes.length) return null;
  if (records.some((item, i) => item.type !== renderedTypes[i])) return null;
  return records[index] ?? null;
}

// src/callout-fold-sync.ts
function calloutsWithin(element) {
  return [
    ...element.matches(".callout") ? [element] : [],
    ...Array.from(element.querySelectorAll(".callout"))
  ];
}
function clickedCallout(event) {
  const target = event.target;
  if (event.button !== 0 || !target?.closest) return null;
  if (target.closest("a, button, input, select, textarea")) return null;
  const title = target.closest(".callout-title");
  const callout = title?.parentElement;
  return callout?.matches(".callout.is-collapsible") ? callout : null;
}
function afterNativeToggle(callout, before, isDisposed, save) {
  setTimeout(() => {
    if (isDisposed()) return;
    setTimeout(() => {
      if (isDisposed()) return;
      const collapsed = callout.classList.contains("is-collapsed");
      if (collapsed !== before) save(collapsed);
    }, 0);
  }, 0);
}
var CalloutFoldEditor = class {
  constructor(view) {
    this.view = view;
    this.disposed = false;
    this.onClick = (event) => {
      const callout = clickedCallout(event);
      if (!callout || callout.closest(".internal-embed, .markdown-embed")) return;
      let root = callout;
      while (root.parentElement?.closest(".callout")) root = root.parentElement.closest(".callout");
      const source = this.view.state.doc.toString();
      let line;
      try {
        line = this.view.state.doc.lineAt(this.view.posAtDOM(root, 0)).number - 1;
      } catch {
        return;
      }
      const records = findCallouts(source);
      const parent = records.find((item) => item.line === line);
      if (!parent) return;
      const rendered = calloutsWithin(root);
      const record = matchRenderedCallout(
        records.filter((item) => item.line >= parent.line && item.line < parent.endLine),
        rendered.map((el) => el.dataset.callout ?? ""),
        rendered.indexOf(callout)
      );
      if (!record?.fold) return;
      afterNativeToggle(callout, callout.classList.contains("is-collapsed"), () => this.disposed, (collapsed) => {
        const current = this.view.state.doc.toString();
        const updated = setCalloutFold(current, source, record, collapsed);
        if (updated !== null && updated !== current) {
          this.view.dispatch({ changes: { from: record.marker, to: record.marker + 1, insert: collapsed ? "-" : "+" } });
        }
      });
    };
    view.dom.addEventListener("click", this.onClick, true);
  }
  update(update) {
    if (!update.docChanged || !update.transactions.some((tr) => tr.isUserEvent("input") || tr.isUserEvent("delete"))) return;
    const records = findCallouts(update.state.doc.toString());
    const markers = /* @__PURE__ */ new Set();
    update.changes.iterChangedRanges((_fromA, _toA, from, to) => {
      for (const record of records) {
        if (record.fold !== "-" || from >= record.to || to <= record.from) continue;
        if (from >= record.marker && to <= record.marker + 1) continue;
        markers.add(record.marker);
      }
    });
    if (!markers.size) return;
    queueMicrotask(() => {
      if (this.disposed || this.view.state.doc !== update.state.doc) return;
      this.view.dispatch({ changes: [...markers].sort((a, b) => a - b).map((from) => ({ from, to: from + 1, insert: "+" })) });
    });
  }
  destroy() {
    this.disposed = true;
    this.view.dom.removeEventListener("click", this.onClick, true);
  }
};
function registerCalloutFoldSync(plugin) {
  plugin.registerEditorExtension(import_view.ViewPlugin.fromClass(CalloutFoldEditor));
  plugin.registerMarkdownPostProcessor((element, context) => {
    if (!element.matches(".callout.is-collapsible") && !element.querySelector(".callout.is-collapsible")) return;
    if (!context.getSectionInfo(element)) return;
    const child = new import_obsidian.MarkdownRenderChild(element);
    let disposed = false;
    child.register(() => {
      disposed = true;
    });
    child.registerDomEvent(element, "click", (event) => {
      const callout = clickedCallout(event);
      if (!callout || !element.contains(callout)) return;
      const section = context.getSectionInfo(callout);
      if (!section) return;
      const rendered = calloutsWithin(element);
      const record = matchRenderedCallout(
        findCallouts(section.text).filter((item) => item.line >= section.lineStart && item.line <= section.lineEnd),
        rendered.map((el) => el.dataset.callout ?? ""),
        rendered.indexOf(callout)
      );
      if (!record?.fold) return;
      afterNativeToggle(callout, callout.classList.contains("is-collapsed"), () => disposed, (collapsed) => {
        const file = plugin.app.vault.getAbstractFileByPath(context.sourcePath);
        if (!(file instanceof import_obsidian.TFile)) return;
        void plugin.app.vault.process(file, (current) => {
          const updated = setCalloutFold(current, section.text, record, collapsed);
          if (updated === null) throw new Error("\u6587\u6863\u5DF2\u53D8\u5316\uFF0C\u672A\u5199\u5165\u8FC7\u671F\u7684\u6298\u53E0\u4F4D\u7F6E");
          return updated;
        }).catch((error) => {
          console.error("\u9898\u8FF9\uFF1ACallout \u72B6\u6001\u540C\u6B65\u5931\u8D25", error);
          new import_obsidian.Notice("\u9898\u8FF9\uFF1A\u5C55\u5F00\u72B6\u6001\u672A\u80FD\u4FDD\u5B58\uFF0C\u8BF7\u5728\u6587\u6863\u66F4\u65B0\u540E\u518D\u8BD5\u4E00\u6B21");
        });
      });
    }, true);
    context.addChild(child);
  });
}

// src/markdown.js
var QUESTION_HEADER = /^>\s*\[!exam-question\][+-]?\s*(?<title>.*)$/;
var CALLOUT_LINE = /^>\s?(.*)$/;
var BLOCK_ID = /^\^([A-Za-z0-9_-]+)\s*$/;
var PERSONAL_FOOTNOTE = /^exam-[A-Za-z0-9_-]+-note-(\d+)$/;
function linesWithOffsets(source) {
  const lines = [];
  let offset = 0;
  for (const line of source.split("\n")) {
    lines.push({ line, start: offset, end: offset + line.length });
    offset += line.length + 1;
  }
  return lines;
}
function stripQuote(line) {
  const match = line.match(CALLOUT_LINE);
  return match ? match[1] : line;
}
function parseQuestionAt(lines, index) {
  const header = lines[index].line.match(QUESTION_HEADER);
  if (!header) return null;
  let cursor = index + 1;
  const innerLines = [];
  while (cursor < lines.length && (lines[cursor].line === "" || lines[cursor].line.startsWith(">"))) {
    if (lines[cursor].line === "") break;
    innerLines.push(stripQuote(lines[cursor].line));
    cursor += 1;
  }
  let blockLine = cursor;
  while (blockLine < Math.min(lines.length, cursor + 4) && lines[blockLine].line.trim() === "") blockLine += 1;
  const blockMatch = blockLine < lines.length ? lines[blockLine].line.trim().match(BLOCK_ID) : null;
  const blockId = blockMatch ? blockMatch[1] : null;
  let scan = blockLine + (blockMatch ? 1 : 0);
  const materialIds = [];
  while (scan < Math.min(lines.length, blockLine + 8)) {
    const materialLine = lines[scan].line.match(/^材料：(.+)$/);
    if (materialLine) {
      for (const match of materialLine[1].matchAll(/#\^([A-Za-z0-9_-]+)/g)) materialIds.push(match[1]);
    }
    if (lines[scan].line.startsWith("> [!success]") || lines[scan].line.startsWith("> [!note]")) break;
    scan += 1;
  }
  const title = header.groups?.title ?? header[1] ?? "";
  const number = (title.match(/第\s*(\d+)\s*题/) || [])[1] || null;
  return {
    title: title.trim(),
    number,
    blockId,
    materialIds,
    innerLines,
    headerLine: index,
    endLine: cursor,
    startOffset: lines[index].start,
    endOffset: lines[Math.min(cursor, lines.length - 1)]?.start ?? lines[lines.length - 1]?.end ?? 0
  };
}
function findExamQuestions(source) {
  const lines = linesWithOffsets(source);
  const questions = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (QUESTION_HEADER.test(lines[index].line)) {
      const question = parseQuestionAt(lines, index);
      if (question) questions.push(question);
    }
  }
  return questions;
}
function parseExamQuestion(source, lineOrOffset = 0) {
  const questions = findExamQuestions(source);
  const line = typeof lineOrOffset === "number" && lineOrOffset >= 0 ? source.slice(0, lineOrOffset).split("\n").length - 1 : 0;
  return questions.find((question) => question.headerLine <= line && line <= question.endLine + 12) || questions[0] || null;
}
function offsetToLine(source, offset) {
  return source.slice(0, Math.max(0, offset)).split("\n").length - 1;
}
function findQuestionAtOffsets(source, start, end = start) {
  const questions = findExamQuestions(source);
  const leftLine = offsetToLine(source, start);
  const rightLine = offsetToLine(source, end);
  const question = questions.find((item) => item.headerLine <= leftLine && rightLine <= item.endLine);
  return question || null;
}
function calloutByBlockId(source, blockId) {
  const lines = linesWithOffsets(source);
  const target = lines.findIndex((item) => item.line.trim() === `^${blockId}`);
  if (target < 0) return null;
  let header = target - 1;
  while (header >= 0 && lines[header].line.trim() === "") header -= 1;
  while (header >= 0 && lines[header].line.startsWith(">")) header -= 1;
  header += 1;
  const headerMatch = lines[header]?.line.match(/^>\s*\[!([^\]]+)\][+-]?\s*(.*)$/);
  if (!headerMatch) return null;
  const innerLines = [];
  let cursor = header + 1;
  while (cursor < target && (lines[cursor].line === "" || lines[cursor].line.startsWith(">"))) {
    if (lines[cursor].line !== "") innerLines.push(stripQuote(lines[cursor].line));
    cursor += 1;
  }
  return { blockId, kind: headerMatch[1], title: headerMatch[2].trim(), innerLines, headerLine: header, blockLine: target };
}
function extractBlockById(source, blockId) {
  return calloutByBlockId(source, String(blockId).replace(/^\^/, ""));
}
function stripPersonalFootnotesSafe(text) {
  const value = String(text);
  const ids = /* @__PURE__ */ new Set();
  for (const match of value.matchAll(/\[\^([^\]]+)\]/g)) {
    if (PERSONAL_FOOTNOTE.test(match[1])) ids.add(match[1]);
  }
  const kept = value.split("\n").filter((line) => ![...ids].some((id) => line.startsWith(`[^${id}]:`)));
  let result = kept.join("\n");
  for (const id of ids) result = result.replaceAll(`[^${id}]`, "");
  return result.replace(/\n{3,}/g, "\n\n").trim();
}
function stripPersonalFootnotes(text) {
  return stripPersonalFootnotesSafe(text);
}
function stripQuestionDecorations(question) {
  const body = question.innerLines.join("\n").trim();
  return stripPersonalFootnotes(body).split("\n").filter((line) => !/^材料：/.test(line) && !/^标签：/.test(line) && !/^关联：/.test(line)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
function appendReferencedSourceFootnotes(copied, source) {
  const ids = [];
  for (const match of copied.matchAll(/\[\^([^\]]+)\]/g)) {
    if (!PERSONAL_FOOTNOTE.test(match[1]) && !ids.includes(match[1])) ids.push(match[1]);
  }
  const definitions = [];
  for (const id of ids) {
    const line = String(source).split("\n").find((candidate) => candidate.startsWith(`[^${id}]:`));
    if (line) definitions.push(line);
  }
  return definitions.length ? `${copied.trim()}

${definitions.join("\n")}
` : `${copied.trim()}
`;
}
function copyQuestionMarkdown(source, question) {
  const current = question || parseExamQuestion(source, 0);
  if (!current) throw new Error("\u5F53\u524D\u6587\u4EF6\u6CA1\u6709 exam-question \u9898\u76EE\u5361\u7247");
  const materialBlocks = [];
  for (const id of current.materialIds || []) {
    const block = extractBlockById(source, id);
    if (!block) continue;
    const body2 = stripPersonalFootnotes(block.innerLines.join("\n").trim());
    if (body2) materialBlocks.push(body2);
  }
  const body = stripQuestionDecorations(current);
  const number = current.number ? `${current.number}. ` : "";
  const copied = [...materialBlocks, `${number}${body}`].filter(Boolean).join("\n\n").trim();
  return appendReferencedSourceFootnotes(copied, source);
}
function createQuestionLink(filePath, blockId, title = "\u9898\u76EE") {
  const id = String(blockId).replace(/^\^/, "");
  if (!id) throw new Error("\u9898\u76EE\u7F3A\u5C11\u5757\u7F16\u53F7");
  return `[[${filePath}#^${id}|${title}]]`;
}
function nextOptionFootnoteId(source, blockId) {
  const prefix = `exam-${String(blockId).replace(/^\^/, "")}-note-`;
  let next = 1;
  for (const match of String(source).matchAll(/\[\^(exam-[A-Za-z0-9_-]+-note-(\d+))\]/g)) {
    if (match[1].startsWith(prefix)) next = Math.max(next, Number(match[2]) + 1);
  }
  return `${prefix}${next}`;
}
function insertOptionFootnote(source, question, start, end, note) {
  if (!question || !question.blockId) throw new Error("\u9898\u76EE\u7F3A\u5C11\u5757\u7F16\u53F7");
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < question.startOffset || end < start || end > source.length) {
    throw new Error("\u9009\u533A\u4E0D\u5728\u9898\u76EE\u5361\u7247\u5185");
  }
  if (offsetToLine(source, end) > question.endLine) throw new Error("\u9009\u533A\u4E0D\u80FD\u8DE8\u51FA\u9898\u76EE\u5361\u7247");
  const value = String(note || "").trim();
  if (!value) throw new Error("\u7B14\u8BB0\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A");
  const id = nextOptionFootnoteId(source, question.blockId);
  const marker = `[^${id}]`;
  const definition = `[^${id}]: ${value}`;
  const withMarker = source.slice(0, end) + marker + source.slice(end);
  const separator = withMarker.endsWith("\n") ? "\n" : "\n\n";
  return { source: withMarker + separator + definition + "\n", id, marker, definition };
}

// src/main.ts
function positionToOffset(source, position) {
  const lines = source.split("\n");
  let offset = 0;
  for (let index = 0; index < position.line; index += 1) offset += (lines[index] ?? "").length + 1;
  return offset + position.ch;
}
function questionNumberFromTitle(title) {
  return (title.match(/第\s*(\d+)\s*题/) || [])[1] || null;
}
var ExamNotesPlugin = class extends import_obsidian2.Plugin {
  async onload() {
    registerCalloutFoldSync(this);
    this.addCommand({
      id: "copy-exam-question",
      name: "\u590D\u5236\u5F53\u524D\u9898\u76EE",
      editorCallback: (editor, view) => void this.copyFromEditor(editor, view)
    });
    this.addCommand({
      id: "copy-exam-question-link",
      name: "\u590D\u5236\u5F53\u524D\u9898\u76EE\u94FE\u63A5",
      editorCallback: (editor, view) => void this.copyLinkFromEditor(editor, view)
    });
    this.addCommand({
      id: "add-exam-option-footnote",
      name: "\u4E3A\u5F53\u524D\u9009\u9879\u6DFB\u52A0\u811A\u6CE8",
      editorCallback: (editor, view) => void this.addFootnoteFromEditor(editor, view)
    });
    this.registerMarkdownPostProcessor((element, context) => {
      const callouts = [];
      if (element.matches(".callout[data-callout='exam-question']")) callouts.push(element);
      callouts.push(...Array.from(element.querySelectorAll(".callout[data-callout='exam-question']")));
      for (const callout of callouts) {
        const section = context.getSectionInfo(callout);
        this.addRenderedActions(callout, context.sourcePath, section?.lineStart);
      }
    });
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, view) => {
      const source = editor.getValue();
      const cursor = editor.getCursor();
      const offset = positionToOffset(source, cursor);
      const question = findQuestionAtOffsets(source, offset, offset);
      if (!question) return;
      menu.addItem((item) => item.setTitle("\u590D\u5236\u5F53\u524D\u9898\u76EE").setIcon("copy").onClick(() => void this.copyFromEditor(editor, view)));
      menu.addItem((item) => item.setTitle("\u590D\u5236\u5F53\u524D\u9898\u76EE\u94FE\u63A5").setIcon("link").onClick(() => void this.copyLinkFromEditor(editor, view)));
      menu.addItem((item) => item.setTitle("\u4E3A\u5F53\u524D\u9009\u9879\u6DFB\u52A0\u811A\u6CE8").setIcon("pencil").onClick(() => void this.addFootnoteFromEditor(editor, view)));
    }));
  }
  async readFile(path) {
    const abstract = this.app.vault.getAbstractFileByPath(path);
    if (!(abstract instanceof import_obsidian2.TFile)) return null;
    return { file: abstract, source: await this.app.vault.read(abstract) };
  }
  async writeClipboard(value, message) {
    await navigator.clipboard.writeText(value);
    new import_obsidian2.Notice(message);
  }
  questionFromEditor(editor) {
    const source = editor.getValue();
    const cursor = editor.getCursor();
    const offset = positionToOffset(source, cursor);
    return { source, offset, question: findQuestionAtOffsets(source, offset, offset) };
  }
  async copyFromEditor(editor, _view) {
    const current = this.questionFromEditor(editor);
    if (!current.question) {
      new import_obsidian2.Notice("\u8BF7\u628A\u5149\u6807\u653E\u5728 exam-question \u9898\u76EE\u5361\u7247\u5185");
      return;
    }
    try {
      await this.writeClipboard(copyQuestionMarkdown(current.source, current.question), "\u9898\u76EE\u5DF2\u590D\u5236");
    } catch (error) {
      new import_obsidian2.Notice(`\u590D\u5236\u5931\u8D25\uFF1A${String(error)}`);
    }
  }
  async copyLinkFromEditor(editor, view) {
    const current = this.questionFromEditor(editor);
    if (!current.question?.blockId || !view.file) {
      new import_obsidian2.Notice("\u5F53\u524D\u5149\u6807\u4E0D\u5728\u53EF\u5F15\u7528\u7684\u9898\u76EE\u5361\u7247\u5185");
      return;
    }
    try {
      const link = createQuestionLink(view.file.path, current.question.blockId, current.question.title);
      await this.writeClipboard(link, "\u9898\u76EE\u94FE\u63A5\u5DF2\u590D\u5236");
    } catch (error) {
      new import_obsidian2.Notice(`\u590D\u5236\u94FE\u63A5\u5931\u8D25\uFF1A${String(error)}`);
    }
  }
  async addFootnoteFromEditor(editor, _view) {
    const source = editor.getValue();
    const cursor = editor.getCursor();
    let from = editor.getCursor("from");
    let to = editor.getCursor("to");
    let start = positionToOffset(source, from);
    let end = positionToOffset(source, to);
    if (start === end) {
      const line = editor.getLine(cursor.line);
      const option = line.match(/\b[A-D]\.[^\n]*/);
      if (!option) {
        new import_obsidian2.Notice("\u8BF7\u9009\u62E9\u4E00\u4E2A\u9009\u9879\u7247\u6BB5\uFF0C\u6216\u628A\u5149\u6807\u653E\u5728 A-D \u9009\u9879\u884C");
        return;
      }
      start = positionToOffset(source, { line: cursor.line, ch: option.index ?? 0 });
      end = start + option[0].length;
      from = { line: cursor.line, ch: option.index ?? 0 };
      to = { line: cursor.line, ch: (option.index ?? 0) + option[0].length };
    }
    const question = findQuestionAtOffsets(source, start, end);
    if (!question) {
      new import_obsidian2.Notice("\u9009\u9879\u5FC5\u987B\u5B8C\u5168\u4F4D\u4E8E\u540C\u4E00\u9053 exam-question \u9898\u76EE\u5185");
      return;
    }
    const note = window.prompt("\u9009\u9879\u811A\u6CE8", "")?.trim();
    if (!note) return;
    try {
      const result = insertOptionFootnote(source, question, start, end, note);
      editor.replaceRange(result.marker, to, to);
      const lastLine = editor.lastLine();
      const endPosition = { line: lastLine, ch: editor.getLine(lastLine).length };
      const separator = editor.getValue().endsWith("\n") ? "\n" : "\n\n";
      editor.replaceRange(`${separator}${result.definition}
`, endPosition, endPosition);
      new import_obsidian2.Notice("\u9009\u9879\u811A\u6CE8\u5DF2\u6DFB\u52A0");
    } catch (error) {
      new import_obsidian2.Notice(`\u6DFB\u52A0\u811A\u6CE8\u5931\u8D25\uFF1A${String(error)}`);
    }
  }
  async addRenderedActions(callout, sourcePath, sourceLine) {
    if (callout.dataset.examActions === "true") return;
    const titleElement = callout.querySelector(".callout-title");
    const titleText = callout.querySelector(".callout-title-inner")?.textContent?.trim() || "";
    if (!titleElement || !titleText) return;
    callout.dataset.examActions = "true";
    const actions = document.createElement("span");
    actions.className = "exam-question-actions";
    actions.dataset.examAction = "toolbar";
    actions.append(
      this.actionButton("\u590D\u5236\u9898\u76EE", async () => this.copyRenderedQuestion(sourcePath, titleText, sourceLine)),
      this.actionButton("\u590D\u5236\u94FE\u63A5", async () => this.copyRenderedLink(sourcePath, titleText, sourceLine))
    );
    titleElement.appendChild(actions);
  }
  actionButton(label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "exam-question-action";
    button.dataset.examAction = label;
    button.textContent = label;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void action();
    });
    return button;
  }
  async findRenderedQuestion(sourcePath, title, sourceLine) {
    const loaded = await this.readFile(sourcePath);
    if (!loaded) return null;
    const questions = findExamQuestions(loaded.source);
    if (typeof sourceLine === "number") {
      const byLine = questions.find((item) => item.headerLine <= sourceLine && sourceLine <= item.endLine + 12);
      if (byLine) return { ...loaded, question: byLine };
    }
    const number = questionNumberFromTitle(title);
    const question = questions.find((item) => item.title === title || number && item.number === number);
    return question ? { ...loaded, question } : null;
  }
  async copyRenderedQuestion(sourcePath, title, sourceLine) {
    const found = await this.findRenderedQuestion(sourcePath, title, sourceLine);
    if (!found) {
      new import_obsidian2.Notice("\u627E\u4E0D\u5230\u5BF9\u5E94\u7684\u9898\u76EE\u6E90\u6587\u672C");
      return;
    }
    try {
      await this.writeClipboard(copyQuestionMarkdown(found.source, found.question), "\u9898\u76EE\u5DF2\u590D\u5236");
    } catch (error) {
      new import_obsidian2.Notice(`\u590D\u5236\u5931\u8D25\uFF1A${String(error)}`);
    }
  }
  async copyRenderedLink(sourcePath, title, sourceLine) {
    const found = await this.findRenderedQuestion(sourcePath, title, sourceLine);
    if (!found?.question.blockId) {
      new import_obsidian2.Notice("\u627E\u4E0D\u5230\u5BF9\u5E94\u7684\u9898\u76EE\u5757\u7F16\u53F7");
      return;
    }
    try {
      await this.writeClipboard(createQuestionLink(found.file.path, found.question.blockId, found.question.title), "\u9898\u76EE\u94FE\u63A5\u5DF2\u590D\u5236");
    } catch (error) {
      new import_obsidian2.Notice(`\u590D\u5236\u94FE\u63A5\u5931\u8D25\uFF1A${String(error)}`);
    }
  }
};
