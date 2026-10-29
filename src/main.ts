import { App, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { registerCalloutFoldSync } from "./callout-fold-sync";
import { registerQuestionStudy } from "./study-view";
import { getStudyStore } from "./study-store";
import { parseAnswerCardFile } from "./study-import";
import { studyQuestions } from "./study-model";
import {
  copyQuestionMarkdown,
  createQuestionLink,
  findExamQuestions,
  findQuestionAtOffsets,
  insertOptionFootnote,
} from "./markdown.js";

const SKILL_INBOX = ".obsidian/plugins/obsidian-exam-notes/import-inbox";

function positionToOffset(source: string, position: { line: number; ch: number }): number {
  const lines = source.split("\n");
  let offset = 0;
  for (let index = 0; index < position.line; index += 1) offset += (lines[index] ?? "").length + 1;
  return offset + position.ch;
}
function questionNumberFromTitle(title: string): string | null {
  return (title.match(/第\s*(\d+)\s*题/) || [])[1] || null;
}

export default class ExamNotesPlugin extends Plugin {
  private inboxScanRunning = false;
  private inboxNotices = new Set<string>();

  async onload() {
    registerCalloutFoldSync(this);
    this.addCommand({
      id: "copy-exam-question",
      name: "复制当前题目",
      editorCallback: (editor, view) => void this.copyFromEditor(editor, view),
    });
    this.addCommand({
      id: "copy-exam-question-link",
      name: "复制当前题目链接",
      editorCallback: (editor, view) => void this.copyLinkFromEditor(editor, view),
    });
    this.addCommand({
      id: "add-exam-option-footnote",
      name: "为当前选项添加脚注",
      editorCallback: (editor, view) => void this.addFootnoteFromEditor(editor, view),
    });
    this.addCommand({ id: "import-answer-card-attempt", name: "导入答题卡作答（JSON/CSV）", callback: () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view?.file) { new Notice("请先打开目标试卷笔记"); return; }
      void this.importAnswerCard(view.file.path);
    } });
    this.addCommand({ id: "process-question-trail-sync", name: "处理题迹 Skill 同步", callback: () => void this.processQuestionTrailInbox() });

    const studyRegistered = await registerQuestionStudy(this, (callout, path, line) => this.addRenderedActions(callout, path, line));
    this.registerMarkdownPostProcessor((element, context) => {
      // Reading-view actions share the nearby study queue. Live Preview retains
      // its native timing, and copy actions remain available if study data fails.
      if (studyRegistered && !element.closest(".markdown-source-view")) return;
      const callouts: HTMLElement[] = [];
      if (element.matches(".callout[data-callout='exam-question']")) callouts.push(element);
      callouts.push(...Array.from(element.querySelectorAll<HTMLElement>(".callout[data-callout='exam-question']")));
      for (const callout of callouts) {
        const section = context.getSectionInfo(callout);
        this.addRenderedActions(callout, context.sourcePath, section?.lineStart);
      }
    });

    this.addSettingTab(new ExamNotesSettingTab(this.app, this));
    this.registerEvent(this.app.vault.on("create", file => { if (file.path.startsWith(SKILL_INBOX + "/")) void this.scanQuestionTrailInbox(); }));
    this.registerEvent(this.app.vault.on("rename", file => { if (file.path.startsWith(SKILL_INBOX + "/")) void this.scanQuestionTrailInbox(); }));
    this.registerInterval(window.setInterval(() => void this.scanQuestionTrailInbox(), 15000));
    this.app.workspace.onLayoutReady(() => void this.scanQuestionTrailInbox());

    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, view) => {
      const source = editor.getValue();
      const cursor = editor.getCursor();
      const offset = positionToOffset(source, cursor);
      const question = findQuestionAtOffsets(source, offset, offset);
      if (!question) return;
      menu.addItem((item) => item.setTitle("复制当前题目").setIcon("copy").onClick(() => void this.copyFromEditor(editor, view)));
      menu.addItem((item) => item.setTitle("复制当前题目链接").setIcon("link").onClick(() => void this.copyLinkFromEditor(editor, view)));
      menu.addItem((item) => item.setTitle("为当前选项添加脚注").setIcon("pencil").onClick(() => void this.addFootnoteFromEditor(editor, view)));
    }));
  }

  private async importAnswerCard(sourcePath: string, inboxPath?: string) {
    const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(sourceFile instanceof TFile)) return;
    const source = await this.app.vault.read(sourceFile);
    const questions = studyQuestions(source);
    if (!questions.length) { new Notice("当前笔记没有可对应的 A–D 单选题"); return; }
    const store = await getStudyStore(this);
    const modal = new Modal(this.app);
    modal.titleEl.setText("导入答题卡作答");
    const root = modal.contentEl; root.empty();
    const input = root.createEl("input", { attr: { type:"file", accept:".json,.csv,application/json,text/csv" } });
    const preview = root.createDiv({ cls:"qt-import-preview" });
    const showPreview = (text: string, fileName: string) => {
      try {
        const exercise = parseAnswerCardFile(text,fileName);
        input.hidden = true;
        preview.empty();
        const kindLabel = exercise.sourceKind === "question-trail-sync" ? "批改 Skill 同步" : `答题卡 ${exercise.schemaVersion===2?"v2":"v3"}`;
        preview.createEl("p", { text:`${exercise.name} · ${exercise.questions.length} 题 · ${kindLabel} · ${sourceFile.path}` });
        const rows:{ imported:typeof exercise.questions[number]; select:HTMLSelectElement; include:HTMLInputElement }[]=[];
        const identities = new Set<string>();
        for (const item of exercise.questions) {
          const identity=JSON.stringify([exercise.paperId,exercise.paperVersion,item.questionId]);
          const row=preview.createDiv({cls:"qt-import-row"}); const include=row.createEl("input",{attr:{type:"checkbox"}}); include.checked=true;
          row.createEl("span",{text:`${item.number} · ${item.questionId}${item.supported?"":" · "+item.reason}`});
          const select=row.createEl("select"); select.createEl("option",{text:"选择笔记题目",attr:{value:""}});
          const binding=store.binding(identity);
          for(const q of questions) select.createEl("option",{text:`${q.title} · ^${q.blockId}`,attr:{value:q.blockId}});
          if(binding){
            if(binding.path!==sourcePath){row.createEl("span",{text:`已有绑定到 ${binding.path}`});include.checked=false;}
            else if(questions.filter(q=>q.blockId===binding.blockId).length!==1){row.createEl("span",{text:`绑定题块 ^${binding.blockId} 缺失或重复`});include.checked=false;}
            else select.value=binding.blockId;
          }
          if(identities.has(identity)){include.checked=false;row.createEl("span",{text:"重复来源身份"});} identities.add(identity);
          rows.push({imported:item,select,include});
        }
        const confirm=preview.createEl("button",{text:"确认导入"});
        const status=preview.createDiv({cls:"qt-import-status"});
        confirm.onclick=()=>{
          const selected=rows.filter(r=>r.include.checked);
          if(!selected.length){status.setText("请至少选择一条记录");return;}
          if(selected.some(r=>!r.imported.supported||!r.imported.questionId||!r.select.value)){status.setText("请先排除不支持/重复条目，并为每题明确选择目标");return;}
          const ids=selected.map(r=>r.select.value); if(new Set(ids).size!==ids.length){status.setText("多个来源题目不能绑定到同一个笔记题目");return;}
          const targets=selected.map(r=>questions.find(q=>q.blockId===r.select.value)!);
          void store.importBatch(exercise,sourcePath,selected.map((r,i)=>({imported:r.imported,question:targets[i]}))).then(async result=>{
            if(inboxPath) {
              try { await this.archiveInboxFile(inboxPath); }
              catch(error) { new Notice(`作答已导入，但收件箱文件仍待归档：${String(error)}`); }
            }
            new Notice(`导入完成：新增 ${result.added}，重复跳过 ${result.skipped}`);modal.close();
          }).catch(error=>{console.error(error);status.setText("保存失败；记录未导入，请重试");});
        };
      } catch(error) { preview.empty(); preview.createEl("p",{text:`无法读取导入文件：${String(error)}`}); }
    };
    input.addEventListener("change", () => {
      const file = input.files?.[0]; if (file) void file.text().then(text => showPreview(text, file.name)).catch(error=>{preview.empty();preview.createEl("p",{text:`无法读取导入文件：${String(error)}`});});
    });
    modal.open();
    if (inboxPath) void this.app.vault.adapter.read(inboxPath).then(text => showPreview(text, inboxPath.split("/").pop() ?? inboxPath)).catch(error => { preview.setText(`读取收件箱失败：${String(error)}`); });
  }

  private async processQuestionTrailInbox() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) { new Notice("请先打开目标试卷笔记，再处理 Skill 同步"); return; }
    try {
      const { files } = await this.app.vault.adapter.list(SKILL_INBOX);
      const pending = files.filter(path => path.toLowerCase().endsWith(".json")).sort()[0];
      if (!pending) { new Notice("题迹收件箱没有待处理同步"); return; }
      await this.importAnswerCard(view.file.path, pending);
    } catch (error) { new Notice(`读取题迹收件箱失败：${String(error)}`); }
  }

  private async scanQuestionTrailInbox() {
    if (this.inboxScanRunning) return;
    this.inboxScanRunning = true;
    try {
      const { files } = await this.app.vault.adapter.list(SKILL_INBOX);
      for (const path of files.filter(file => file.toLowerCase().endsWith(".json")).sort()) await this.autoImportBoundSync(path);
    } catch { /* The Skill inbox is optional until the first confirmed sync. */ }
    finally { this.inboxScanRunning = false; }
  }

  private async autoImportBoundSync(path: string) {
    try {
      const exercise = parseAnswerCardFile(await this.app.vault.adapter.read(path), path);
      if (exercise.sourceKind !== "question-trail-sync") return;
      const supported = exercise.questions.filter(question => question.supported);
      if (!supported.length || supported.length !== exercise.questions.length) {
        if (!this.inboxNotices.has(path)) { this.inboxNotices.add(path); new Notice("Skill 同步包含不支持或待核对题目；请执行“处理题迹 Skill 同步”选择可导入条目"); }
        return;
      }
      const store = await getStudyStore(this);
      const bound = supported.map(imported => ({ imported, binding: store.binding(JSON.stringify([exercise.paperId, exercise.paperVersion, imported.questionId])) }));
      if (bound.some(row => !row.binding)) {
        if (!this.inboxNotices.has(path)) { this.inboxNotices.add(path); new Notice("收到新的 Skill 作答同步；请打开目标试卷笔记并执行“处理题迹 Skill 同步”完成首次绑定"); }
        return;
      }
      const targetPaths = new Set(bound.map(row => row.binding!.path));
      if (targetPaths.size !== 1) {
        if (!this.inboxNotices.has(path)) { this.inboxNotices.add(path); new Notice("Skill 同步记录绑定到了多份笔记，请使用“处理题迹 Skill 同步”逐份核对"); }
        return;
      }
      const targetPath = [...targetPaths][0];
      const targetFile = this.app.vault.getAbstractFileByPath(targetPath);
      if (!(targetFile instanceof TFile)) {
        if (!this.inboxNotices.has(path)) { this.inboxNotices.add(path); new Notice("Skill 同步目标笔记已不存在；请打开目标试卷笔记并重新核对绑定"); }
        return;
      }
      const source = await this.app.vault.read(targetFile);
      const questions = studyQuestions(source);
      const mappings = bound.map(row => {
        const matches = questions.filter(question => question.blockId === row.binding!.blockId);
        if (matches.length !== 1) throw new Error(`目标块 ^${row.binding!.blockId} 缺失或重复`);
        return { imported: row.imported, question: matches[0] };
      });
      const result = await store.importBatch(exercise, targetPath, mappings);
      const unsupported = exercise.questions.length - supported.length;
      let archiveNote = "";
      try { await this.archiveInboxFile(path); }
      catch(error) { archiveNote = `；收件箱文件归档失败：${String(error)}`; }
      new Notice(`Skill 同步完成：新增 ${result.added} 条，未变化 ${result.skipped} 条${unsupported ? `；${unsupported} 道不支持题型保留在归档文件中` : ""}${archiveNote}`);
    } catch (error) {
      console.error("题迹：Skill 同步处理失败", error);
      if (!this.inboxNotices.has(path)) { this.inboxNotices.add(path); new Notice(`Skill 同步未导入，原文件保留：${String(error)}`); }
    }
  }

  private async archiveInboxFile(path: string) {
    const archive = `${SKILL_INBOX}/processed`;
    if (!(await this.app.vault.adapter.exists(archive))) await this.app.vault.adapter.mkdir(archive);
    const basename = path.split("/").pop() ?? "sync.json";
    let target = `${archive}/${basename}`;
    if (await this.app.vault.adapter.exists(target)) target = `${archive}/${Date.now()}-${basename}`;
    await this.app.vault.adapter.rename(path, target);
    this.inboxNotices.delete(path);
  }

  private async readFile(path: string): Promise<{ file: TFile; source: string } | null> {
    const abstract = this.app.vault.getAbstractFileByPath(path);
    if (!(abstract instanceof TFile)) return null;
    return { file: abstract, source: await this.app.vault.read(abstract) };
  }

  private async writeClipboard(value: string, message: string) {
    await navigator.clipboard.writeText(value);
    new Notice(message);
  }

  private questionFromEditor(editor: any) {
    const source = editor.getValue();
    const cursor = editor.getCursor();
    const offset = positionToOffset(source, cursor);
    return { source, offset, question: findQuestionAtOffsets(source, offset, offset) };
  }

  private async copyFromEditor(editor: any, _view: any) {
    const current = this.questionFromEditor(editor);
    if (!current.question) {
      new Notice("请把光标放在 exam-question 题目卡片内");
      return;
    }
    try {
      await this.writeClipboard(copyQuestionMarkdown(current.source, current.question), "题目已复制");
    } catch (error) {
      new Notice(`复制失败：${String(error)}`);
    }
  }

  private async copyLinkFromEditor(editor: any, view: any) {
    const current = this.questionFromEditor(editor);
    if (!current.question?.blockId || !view.file) {
      new Notice("当前光标不在可引用的题目卡片内");
      return;
    }
    try {
      const link = createQuestionLink(view.file.path, current.question.blockId, current.question.title);
      await this.writeClipboard(link, "题目链接已复制");
    } catch (error) {
      new Notice(`复制链接失败：${String(error)}`);
    }
  }

  private async addFootnoteFromEditor(editor: any, _view: any) {
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
        new Notice("请选择一个选项片段，或把光标放在 A-D 选项行");
        return;
      }
      start = positionToOffset(source, { line: cursor.line, ch: option.index ?? 0 });
      end = start + option[0].length;
      from = { line: cursor.line, ch: option.index ?? 0 };
      to = { line: cursor.line, ch: (option.index ?? 0) + option[0].length };
    }
    const question = findQuestionAtOffsets(source, start, end);
    if (!question) {
      new Notice("选项必须完全位于同一道 exam-question 题目内");
      return;
    }
    const note = window.prompt("选项脚注", "")?.trim();
    if (!note) return;
    try {
      const result = insertOptionFootnote(source, question, start, end, note);
      editor.replaceRange(result.marker, to, to);
      const lastLine = editor.lastLine();
      const endPosition = { line: lastLine, ch: editor.getLine(lastLine).length };
      const separator = editor.getValue().endsWith("\n") ? "\n" : "\n\n";
      editor.replaceRange(`${separator}${result.definition}\n`, endPosition, endPosition);
      new Notice("选项脚注已添加");
    } catch (error) {
      new Notice(`添加脚注失败：${String(error)}`);
    }
  }

  private addRenderedActions(callout: HTMLElement, sourcePath: string, sourceLine?: number) {
    if (callout.dataset.examActions === "true") return;
    const titleElement = callout.querySelector<HTMLElement>(".callout-title");
    const titleText = callout.querySelector<HTMLElement>(".callout-title-inner")?.textContent?.trim() || "";
    if (!titleElement || !titleText) return;
    callout.dataset.examActions = "true";
    const actions = document.createElement("span");
    actions.className = "exam-question-actions";
    actions.dataset.examAction = "toolbar";
    actions.append(
      this.actionButton("复制题目", async () => this.copyRenderedQuestion(sourcePath, titleText, sourceLine)),
      this.actionButton("复制链接", async () => this.copyRenderedLink(sourcePath, titleText, sourceLine)),
    );
    titleElement.appendChild(actions);
  }

  private actionButton(label: string, action: () => Promise<void>) {
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

  private async findRenderedQuestion(sourcePath: string, title: string, sourceLine?: number) {
    const loaded = await this.readFile(sourcePath);
    if (!loaded) return null;
    const questions = findExamQuestions(loaded.source);
    if (typeof sourceLine === "number") {
      const byLine = questions.find((item) => item.headerLine <= sourceLine && sourceLine < item.endLine);
      if (byLine) return { ...loaded, question: byLine };
    }
    const number = questionNumberFromTitle(title);
    const candidates = questions.filter((item) => item.title === title || (number && item.number === number));
    const question = candidates.length === 1 ? candidates[0] : null;
    return question ? { ...loaded, question } : null;
  }

  private async copyRenderedQuestion(sourcePath: string, title: string, sourceLine?: number) {
    const found = await this.findRenderedQuestion(sourcePath, title, sourceLine);
    if (!found) {
      new Notice("找不到对应的题目源文本");
      return;
    }
    try {
      await this.writeClipboard(copyQuestionMarkdown(found.source, found.question), "题目已复制");
    } catch (error) {
      new Notice(`复制失败：${String(error)}`);
    }
  }

  private async copyRenderedLink(sourcePath: string, title: string, sourceLine?: number) {
    const found = await this.findRenderedQuestion(sourcePath, title, sourceLine);
    if (!found?.question.blockId) {
      new Notice("找不到对应的题目块编号");
      return;
    }
    try {
      await this.writeClipboard(createQuestionLink(found.file.path, found.question.blockId, found.question.title), "题目链接已复制");
    } catch (error) {
      new Notice(`复制链接失败：${String(error)}`);
    }
  }
}

class ExamNotesSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ExamNotesPlugin) { super(app, plugin); }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "题迹" });
    new Setting(containerEl)
      .setName("默认展开共用题干")
      .setDesc("控制阅读视图中每道子题上方“共用题干”的默认状态；手动开合只影响当前显示。")
      .addToggle(toggle => {
        let current = true;
        toggle.setValue(current);
        void getStudyStore(this.plugin).then(store => {
          current = store.sharedMaterialDefaultExpanded;
          toggle.setValue(current);
        }).catch(error => {
          console.error("题迹：读取共用题干设置失败", error);
          new Notice("题迹设置读取失败");
        });
        toggle.onChange(async value => {
          const previous = current;
          try {
            const store = await getStudyStore(this.plugin);
            await store.setSharedMaterialDefaultExpanded(value);
            current = value;
          } catch (error) {
            console.error("题迹：保存共用题干设置失败", error);
            toggle.setValue(previous);
            new Notice("共用题干设置未保存，请重试");
          }
        });
      });
  }
}
