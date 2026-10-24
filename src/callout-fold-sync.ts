import { MarkdownRenderChild, Notice, Plugin, TFile } from "obsidian";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { findCallouts, matchRenderedCallout, setCalloutFold } from "./callout-folds.js";

function calloutsWithin(element: HTMLElement): HTMLElement[] {
  return [
    ...(element.matches(".callout") ? [element] : []),
    ...Array.from(element.querySelectorAll<HTMLElement>(".callout")),
  ];
}

function clickedCallout(event: MouseEvent): HTMLElement | null {
  const target = event.target as HTMLElement | null;
  if (event.button !== 0 || !target?.closest) return null;
  if (target.closest("a, button, input, select, textarea")) return null;
  const title = target.closest(".callout-title");
  const callout = title?.parentElement;
  return callout?.matches(".callout.is-collapsible") ? callout : null;
}

/** Obsidian's title handler toggles in a timer; read the state after it runs. */
function afterNativeToggle(callout: HTMLElement, before: boolean, isDisposed: () => boolean, save: (collapsed: boolean) => void) {
  setTimeout(() => {
    if (isDisposed()) return;
    setTimeout(() => {
      if (isDisposed()) return;
      const collapsed = callout.classList.contains("is-collapsed");
      if (collapsed !== before) save(collapsed);
    }, 0);
  }, 0);
}

export class CalloutFoldEditor {
  private disposed = false;
  constructor(private view: EditorView) {
    view.dom.addEventListener("click", this.onClick, true);
  }

  private onClick = (event: MouseEvent) => {
    const callout = clickedCallout(event);
    if (!callout || callout.closest(".internal-embed, .markdown-embed")) return;
    let root = callout;
    while (root.parentElement?.closest(".callout")) root = root.parentElement.closest(".callout") as HTMLElement;
    const source = this.view.state.doc.toString();
    let line: number;
    try {
      line = this.view.state.doc.lineAt(this.view.posAtDOM(root, 0)).number - 1;
    } catch { return; }
    const records = findCallouts(source);
    const parent = records.find((item) => item.line === line);
    if (!parent) return;
    const rendered = calloutsWithin(root);
    const record = matchRenderedCallout(
      records.filter((item) => item.line >= parent.line && item.line < parent.endLine),
      rendered.map((el) => el.dataset.callout ?? ""), rendered.indexOf(callout),
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

  update(update: ViewUpdate) {
    if (!update.docChanged || !update.transactions.some((tr) => tr.isUserEvent("input") || tr.isUserEvent("delete"))) return;
    const records = findCallouts(update.state.doc.toString());
    const markers = new Set<number>();
    update.changes.iterChangedRanges((_fromA, _toA, from, to) => {
      for (const record of records) {
        if (record.fold !== "-" || from >= record.to || to <= record.from) continue;
        // Explicitly typing '+'/'-' is itself a fold choice; do not override it.
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
}

export function registerCalloutFoldSync(plugin: Plugin) {
  plugin.registerEditorExtension(ViewPlugin.fromClass(CalloutFoldEditor));
  plugin.registerMarkdownPostProcessor((element, context) => {
    if (!element.matches(".callout.is-collapsible") && !element.querySelector(".callout.is-collapsible")) return;
    // Live Preview has no section info. Its editor extension resolves source positions.
    if (!context.getSectionInfo(element)) return;
    const child = new MarkdownRenderChild(element);
    let disposed = false;
    child.register(() => { disposed = true; });
    child.registerDomEvent(element, "click", (event) => {
      const callout = clickedCallout(event);
      if (!callout || !element.contains(callout)) return;
      const section = context.getSectionInfo(callout);
      if (!section) return;
      const rendered = calloutsWithin(element);
      const record = matchRenderedCallout(
        findCallouts(section.text).filter((item) => item.line >= section.lineStart && item.line <= section.lineEnd),
        rendered.map((el) => el.dataset.callout ?? ""), rendered.indexOf(callout),
      );
      if (!record?.fold) return;
      afterNativeToggle(callout, callout.classList.contains("is-collapsed"), () => disposed, (collapsed) => {
        const file = plugin.app.vault.getAbstractFileByPath(context.sourcePath);
        if (!(file instanceof TFile)) return;
        void plugin.app.vault.process(file, (current) => {
          const updated = setCalloutFold(current, section.text, record, collapsed);
          if (updated === null) throw new Error("文档已变化，未写入过期的折叠位置");
          return updated;
        }).catch((error) => {
          console.error("题迹：Callout 状态同步失败", error);
          new Notice("题迹：展开状态未能保存，请在文档更新后再试一次");
        });
      });
    }, true);
    context.addChild(child);
  });
}
