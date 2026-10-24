import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { EditorState, StateField, Transaction } from "@codemirror/state";
import { registerCalloutFoldSync } from "../src/callout-fold-sync";
import { findCallouts } from "../src/callout-folds.js";

/** Native Obsidian renderer + isolated CodeMirror editors; no vault writes or focus. */
export async function run(native: any, app: any) {
  const results: string[] = [];
  const components: any[] = [];
  const editors: EditorView[] = [];
  const host = document.createElement("div");
  host.dataset.questionTrailFoldTest = "true";
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:600px;opacity:0;pointer-events:none";
  document.body.append(host);
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 40));
  const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const states = (element: HTMLElement) => [...element.querySelectorAll(".callout")].map((el) => el.classList.contains("is-collapsed"));
  const expectStates = (element: HTMLElement, expected: boolean[], label: string) => {
    assert(JSON.stringify(states(element)) === JSON.stringify(expected), `${label}: ${JSON.stringify(states(element))}`);
  };
  const source = "> [!note]- 我的笔记\n> 第一题笔记\n\n> [!note]- 我的笔记\n> 第二题笔记\n";
  let stored = source;
  const processors: any[] = [];
  const extensions: any[] = [];
  const file = new native.TFile(app.vault, "__question_trail_fold_test__.md");
  registerCalloutFoldSync({
    app: { vault: {
      getAbstractFileByPath: (path: string) => path === file.path ? file : null,
      process: async (_file: any, change: (value: string) => string) => { stored = change(stored); return stored; },
    } },
    registerEditorExtension: (extension: any) => extensions.push(extension),
    registerMarkdownPostProcessor: (processor: any) => processors.push(processor),
  } as any);

  const render = async (text: string, withSync: boolean) => {
    const element = host.appendChild(document.createElement("div"));
    element.className = "markdown-preview-view markdown-rendered";
    const component = new native.Component();
    component.load();
    components.push(component);
    await native.Renderer.render(app, text, element, file.path, component);
    if (withSync) {
      for (const processor of processors) processor(element, {
        sourcePath: file.path,
        getSectionInfo: () => ({ text, lineStart: 0, lineEnd: text.split("\n").length - 1 }),
        addChild: (child: any) => component.addChild(child),
      });
    }
    return element;
  };

  class NativeCalloutWidget extends WidgetType {
    component: any;
    constructor(readonly text: string) { super(); }
    toDOM(view: EditorView) {
      const element = document.createElement("div");
      element.className = "markdown-rendered";
      this.component = new native.Component();
      this.component.load();
      void native.Renderer.render(app, this.text, element, file.path, this.component).then(() => view.requestMeasure());
      return element;
    }
    destroy() { this.component?.unload(); }
  }

  const buildWidgets = (state: EditorState) => {
      const text = state.doc.toString();
      return Decoration.set(findCallouts(text).filter((item) => item.depth === 1).map((item) => {
        const end = state.doc.line(item.endLine).to;
        return Decoration.replace({ widget: new NativeCalloutWidget(text.slice(item.from, end)), block: true }).range(item.from, end);
      }));
    };
  const widgets = StateField.define({
    create: buildWidgets,
    update: (value, transaction) => transaction.docChanged ? buildWidgets(transaction.state) : value,
    provide: (field) => EditorView.decorations.from(field),
  });

  try {
    const before = await render(source, false);
    (before.querySelector(".callout-fold") as HTMLElement).click();
    await settle();
    expectStates(before, [false, true], "native click");
    expectStates(await render(source, false), [true, true], "native rerender resets state");
    results.push("复现原生点击展开后重新渲染又折叠的问题");

    const editor = new EditorView({ parent: host, state: EditorState.create({ doc: source, extensions }) });
    editors.push(editor);
    const at = source.indexOf("第一题笔记") + "第一题笔记".length;
    editor.dispatch({ changes: { from: at, insert: "，已编辑" }, annotations: Transaction.userEvent.of("input.type") });
    await settle();
    stored = editor.state.doc.toString();
    assert(JSON.stringify(findCallouts(stored).map((r) => r.fold)) === JSON.stringify(["+", "-"]), "editing must only expand the edited block");
    const reading = await render(stored, true);
    expectStates(reading, [false, true], "edit to reading");
    results.push("编辑第一块后，阅读渲染保持展开；同名第二块保持折叠");

    (reading.querySelectorAll(".callout-title")[1] as HTMLElement).click();
    await settle();
    assert(findCallouts(stored)[1].fold === "+", "delayed native title click must persist");
    expectStates(await render(stored, true), [false, false], "reading rerender");
    results.push("阅读模式点击标题展开后，重新渲染保留状态");

    const live = new EditorView({ parent: host, state: EditorState.create({ doc: stored, extensions: [...extensions, widgets] }) });
    editors.push(live);
    await settle();
    expectStates(live.dom, [false, false], "reading to live widgets");
    (live.dom.querySelector(".callout-fold") as HTMLElement).click();
    await settle();
    stored = live.state.doc.toString();
    assert(findCallouts(stored)[0].fold === "-", "Live Preview arrow must save collapse");
    expectStates(await render(stored, true), [true, false], "live to reading");
    results.push("实时预览点击折叠箭头后，阅读渲染保持同一展开组合");

    (live.dom.querySelectorAll(".callout-title")[1] as HTMLElement).click();
    await settle();
    assert(findCallouts(live.state.doc.toString())[1].fold === "-", "Live Preview title must save collapse");
    results.push("实时预览标题的延迟折叠事件同样保存成功");

    const nestedSource = "> [!note]- 外层\n> > [!tip]- 内层\n> > 内容\n> 尾部\n";
    const nested = new EditorView({ parent: host, state: EditorState.create({ doc: nestedSource, extensions }) });
    editors.push(nested);
    nested.dispatch({ changes: { from: nestedSource.indexOf("内容"), insert: "新增" }, annotations: Transaction.userEvent.of("input.type") });
    await settle();
    assert(findCallouts(nested.state.doc.toString()).every((r) => r.fold === "+"), "editing nested content must open both ancestors");
    results.push("编辑嵌套块内容时，其折叠父级也保持展开");

    const marker = findCallouts(nested.state.doc.toString())[0].marker;
    nested.dispatch({ changes: { from: marker, to: marker + 1, insert: "-" }, annotations: Transaction.userEvent.of("input.type") });
    await settle();
    assert(findCallouts(nested.state.doc.toString())[0].fold === "-", "manual minus must not be overwritten");
    results.push("手工输入折叠标记仍然有效");
    return { passed: results.length, results };
  } finally {
    for (const editor of editors) editor.destroy();
    for (const component of components) component.unload();
    host.remove();
  }
}
