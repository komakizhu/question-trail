import { studyGroups, studyQuestions } from "./study-model";
import { extractBlockById } from "./markdown.js";

/** Per-file, bounded cache. Content equality also protects unsaved/embedded renders. */
export class StudyRenderCache {
  private entries = new Map<string, ReturnType<typeof createEntry>>();
  get(path: string, source: string) {
    let entry = this.entries.get(path);
    if (!entry || entry.source !== source) entry = createEntry(source);
    this.entries.delete(path);
    this.entries.set(path, entry);
    if (this.entries.size > 8) this.entries.delete(this.entries.keys().next().value!);
    return entry;
  }
  clear() { this.entries.clear(); }
}
function createEntry(source: string) {
  const questions = studyQuestions(source);
  const lines = source.split("\n");
  const counts = new Map<string, number>();
  for (const line of lines) {
    const id = line.trim().match(/^\^([A-Za-z0-9_-]+)$/)?.[1];
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const materials = new Map<string, ReturnType<typeof extractBlockById>>();
  const groups = studyGroups(source, questions);
  const byTitle = new Map<string, typeof questions>();
  const groupAtLine = new Map<number, typeof groups[number]>();
  const extraAtLine = new Map<number, { question: typeof questions[number]; extra: typeof questions[number]["extras"][number] }>();
  const materialHeaders = [...groups].sort((a, b) => a.materialHeaderLine - b.materialHeaderLine);
  for (const question of questions) {
    const sameTitle = byTitle.get(question.title) ?? [];
    sameTitle.push(question); byTitle.set(question.title, sameTitle);
    for (const extra of question.extras) {
      for (let line = extra.start; line < extra.end; line++) extraAtLine.set(line, { question, extra });
    }
  }
  for (const group of groups) {
    for (let line = group.firstQuestionLine; line <= group.lastQuestionLine; line++) groupAtLine.set(line, group);
  }
  return { source, lines, questions, groups,
    questionAt(title: string, start: number, end: number) {
      const candidates = (byTitle.get(title) ?? []).filter(question => question.headerLine >= start && question.headerLine <= end);
      return candidates.length === 1 ? candidates[0] : null;
    },
    materialGroupAt(start: number, end: number) {
      let low = 0, high = materialHeaders.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (materialHeaders[middle].materialHeaderLine < start) low = middle + 1;
        else high = middle;
      }
      const group = materialHeaders[low];
      return group && group.materialHeaderLine <= end ? group : null;
    },
    groupAt(start: number, end: number) {
      const group = groupAtLine.get(start);
      return group && end <= group.lastQuestionLine ? group : null;
    },
    extraAt(start: number, end: number) {
      const owned = extraAtLine.get(start);
      return owned && end < owned.extra.end ? owned : null;
    },
    material(id: string) {
      if (!materials.has(id)) materials.set(id, counts.get(id) === 1 ? extractBlockById(source, id) : null);
      return materials.get(id) ?? null;
    },
  };
}
export type StudyRenderEntry = ReturnType<StudyRenderCache["get"]>;

/** Copy already-rendered markup; keep native originals intact for component cleanup.
 * Ambiguous layouts fall back to the existing renderer, only when near the viewport.
 */
export function nativeQuestionParts(content: HTMLElement, optionCount: number): DocumentFragment[] | null {
  if (content.querySelector("canvas, iframe, video, audio")) return null;
  if (!optionCount) { const range = document.createRange(); range.selectNodeContents(content); return [range.cloneContents()]; }
  const markers: { node: Text; start: number; end: number; letter: string }[] = [];
  let lineStart = true;
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text;
      const re = /(^|\n)[ \t]{0,3}([A-Z])[.．、)）][ \t]*/g;
      for (const match of text.data.matchAll(re)) {
        if (match.index === 0 && !lineStart) continue;
        markers.push({ node: text, start: match.index! + match[1].length, end: match.index! + match[0].length, letter: match[2] });
      }
      if (text.data.trim()) lineStart = /\n[ \t]*$/.test(text.data);
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.matches("pre, code, table, .math, .internal-embed, svg")) { lineStart = false; return; }
    if (node.tagName === "BR") { lineStart = true; return; }
    const block = /^(P|DIV|LI|BLOCKQUOTE|H[1-6])$/.test(node.tagName);
    if (block) lineStart = true;
    for (const child of Array.from(node.childNodes)) visit(child);
    if (block) lineStart = true;
  };
  for (const child of Array.from(content.childNodes)) visit(child);
  if (markers.length !== optionCount || markers.some((m, i) => m.letter !== String.fromCharCode(65 + i))) return null;
  const parts: DocumentFragment[] = [];
  for (let i = 0; i <= markers.length; i++) {
    const range = document.createRange();
    range.selectNodeContents(content);
    if (i) range.setStart(markers[i - 1].node, markers[i - 1].end);
    if (i < markers.length) range.setEnd(markers[i].node, markers[i].start);
    const fragment = range.cloneContents();
    // Native soft line breaks at option boundaries are not part of the next row.
    while (fragment.lastChild?.nodeType === Node.TEXT_NODE && !fragment.lastChild.textContent?.trim()) fragment.lastChild.remove();
    const last = fragment.lastElementChild;
    if (last?.lastElementChild?.tagName === "BR") last.lastElementChild.remove();
    parts.push(fragment);
  }
  return parts;
}

/** No scroll writes. IO follows Obsidian's virtualized sections as they attach/detach. */
export class NearbyQuestions {
  private pending = new Map<HTMLElement, () => Promise<void>>();
  private ready = new Set<HTMLElement>();
  private frame = 0;
  private disposed = false;
  constructor(private whenReady: (element: HTMLElement, resume: () => void) => boolean = () => true) {}
  private observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) this.ready.add(entry.target as HTMLElement);
      else this.ready.delete(entry.target as HTMLElement);
    }
    this.schedule();
  }, { rootMargin: "350px 0px" });
  add(element: HTMLElement, mount: () => Promise<void>) {
    if (this.pending.has(element)) return () => {};
    this.pending.set(element, mount);
    this.observer.observe(element);
    return () => { this.observer.unobserve(element); this.pending.delete(element); this.ready.delete(element); };
  }
  private schedule() {
    if (!this.disposed && !this.frame && this.ready.size) this.frame = requestAnimationFrame(() => this.drain());
  }
  private drain() {
    this.frame = 0;
    let count = 0;
    for (const element of this.ready) {
      this.ready.delete(element);
      const mount = this.pending.get(element);
      if (!mount || !element.isConnected) continue;
      if (!this.whenReady(element, () => {
        if (!this.disposed && this.pending.has(element)) { this.ready.add(element); this.schedule(); }
      })) continue;
      const viewport = element.closest<HTMLElement>(".markdown-preview-view");
      const bounds = element.getBoundingClientRect();
      const area = viewport?.getBoundingClientRect();
      if (!bounds.height || (area && (bounds.bottom < area.top - 350 || bounds.top > area.bottom + 350))) continue;
      this.pending.delete(element); this.observer.unobserve(element);
      void mount().catch(error => console.error("题迹：附近题目初始化失败", error));
      if (++count === 2) break;
    }
    this.schedule();
  }
  destroy() {
    this.disposed = true; this.observer.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.pending.clear(); this.ready.clear();
  }
}
