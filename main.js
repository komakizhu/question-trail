"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
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
var import_obsidian3 = require("obsidian");

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
    const content2 = raw.slice(prefix.length).replace(/\r$/, "");
    while (stack.length && stack.at(-1).depth > depth) {
      Object.assign(stack.pop(), { endLine: line, to: offset });
    }
    if (fence && depth < fence.depth) fence = null;
    if (fence) {
      const closing = content2.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (depth === fence.depth && closing?.[1][0] === fence.char && closing[1].length >= fence.length) fence = null;
    } else {
      const opening = content2.match(/^ {0,3}(`{3,}|~{3,})/);
      if (opening) {
        fence = { depth, char: opening[1][0], length: opening[1].length };
      } else if (depth > previousDepth) {
        const header = content2.match(/^(\[!([^\]|]+)(?:\|[^\]]*)?\])([+-]?)(?:[ \t]|$)/);
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

// src/study-view.ts
var import_obsidian2 = require("obsidian");

// node_modules/@lezer/common/dist/index.js
var DefaultBufferLength = 1024;
var nextPropID = 0;
var Range = class {
  constructor(from, to) {
    this.from = from;
    this.to = to;
  }
};
var NodeProp = class {
  /**
  Create a new node prop type.
  */
  constructor(config = {}) {
    this.id = nextPropID++;
    this.perNode = !!config.perNode;
    this.deserialize = config.deserialize || (() => {
      throw new Error("This node type doesn't define a deserialize function");
    });
    this.combine = config.combine || null;
  }
  /**
  This is meant to be used with
  [`NodeSet.extend`](#common.NodeSet.extend) or
  [`LRParser.configure`](#lr.ParserConfig.props) to compute
  prop values for each node type in the set. Takes a [match
  object](#common.NodeType^match) or function that returns undefined
  if the node type doesn't get this prop, and the prop's value if
  it does.
  */
  add(match) {
    if (this.perNode)
      throw new RangeError("Can't add per-node props to node types");
    if (typeof match != "function")
      match = NodeType.match(match);
    return (type) => {
      let result = match(type);
      return result === void 0 ? null : [this, result];
    };
  }
};
NodeProp.closedBy = new NodeProp({ deserialize: (str) => str.split(" ") });
NodeProp.openedBy = new NodeProp({ deserialize: (str) => str.split(" ") });
NodeProp.group = new NodeProp({ deserialize: (str) => str.split(" ") });
NodeProp.isolate = new NodeProp({ deserialize: (value) => {
  if (value && value != "rtl" && value != "ltr" && value != "auto")
    throw new RangeError("Invalid value for isolate: " + value);
  return value || "auto";
} });
NodeProp.contextHash = new NodeProp({ perNode: true });
NodeProp.lookAhead = new NodeProp({ perNode: true });
NodeProp.mounted = new NodeProp({ perNode: true });
var MountedTree = class {
  constructor(tree, overlay, parser, bracketed = false) {
    this.tree = tree;
    this.overlay = overlay;
    this.parser = parser;
    this.bracketed = bracketed;
  }
  /**
  @internal
  */
  static get(tree) {
    return tree && tree.props && tree.props[NodeProp.mounted.id];
  }
};
var noProps = /* @__PURE__ */ Object.create(null);
var NodeType = class _NodeType {
  /**
  @internal
  */
  constructor(name2, props, id, flags = 0) {
    this.name = name2;
    this.props = props;
    this.id = id;
    this.flags = flags;
  }
  /**
  Define a node type.
  */
  static define(spec) {
    let props = spec.props && spec.props.length ? /* @__PURE__ */ Object.create(null) : noProps;
    let flags = (spec.top ? 1 : 0) | (spec.skipped ? 2 : 0) | (spec.error ? 4 : 0) | (spec.name == null ? 8 : 0);
    let type = new _NodeType(spec.name || "", props, spec.id, flags);
    if (spec.props)
      for (let src of spec.props) {
        if (!Array.isArray(src))
          src = src(type);
        if (src) {
          if (src[0].perNode)
            throw new RangeError("Can't store a per-node prop on a node type");
          props[src[0].id] = src[1];
        }
      }
    return type;
  }
  /**
  Retrieves a node prop for this type. Will return `undefined` if
  the prop isn't present on this node.
  */
  prop(prop) {
    return this.props[prop.id];
  }
  /**
  True when this is the top node of a grammar.
  */
  get isTop() {
    return (this.flags & 1) > 0;
  }
  /**
  True when this node is produced by a skip rule.
  */
  get isSkipped() {
    return (this.flags & 2) > 0;
  }
  /**
  Indicates whether this is an error node.
  */
  get isError() {
    return (this.flags & 4) > 0;
  }
  /**
  When true, this node type doesn't correspond to a user-declared
  named node, for example because it is used to cache repetition.
  */
  get isAnonymous() {
    return (this.flags & 8) > 0;
  }
  /**
  Returns true when this node's name or one of its
  [groups](#common.NodeProp^group) matches the given string.
  */
  is(name2) {
    if (typeof name2 == "string") {
      if (this.name == name2)
        return true;
      let group = this.prop(NodeProp.group);
      return group ? group.indexOf(name2) > -1 : false;
    }
    return this.id == name2;
  }
  /**
  Create a function from node types to arbitrary values by
  specifying an object whose property names are node or
  [group](#common.NodeProp^group) names. Often useful with
  [`NodeProp.add`](#common.NodeProp.add). You can put multiple
  names, separated by spaces, in a single property name to map
  multiple node names to a single value.
  */
  static match(map) {
    let direct = /* @__PURE__ */ Object.create(null);
    for (let prop in map)
      for (let name2 of prop.split(" "))
        direct[name2] = map[prop];
    return (node2) => {
      for (let groups = node2.prop(NodeProp.group), i = -1; i < (groups ? groups.length : 0); i++) {
        let found = direct[i < 0 ? node2.name : groups[i]];
        if (found)
          return found;
      }
    };
  }
};
NodeType.none = new NodeType(
  "",
  /* @__PURE__ */ Object.create(null),
  0,
  8
  /* NodeFlag.Anonymous */
);
var CachedNode = /* @__PURE__ */ new WeakMap();
var CachedInnerNode = /* @__PURE__ */ new WeakMap();
var IterMode;
(function(IterMode2) {
  IterMode2[IterMode2["ExcludeBuffers"] = 1] = "ExcludeBuffers";
  IterMode2[IterMode2["IncludeAnonymous"] = 2] = "IncludeAnonymous";
  IterMode2[IterMode2["IgnoreMounts"] = 4] = "IgnoreMounts";
  IterMode2[IterMode2["IgnoreOverlays"] = 8] = "IgnoreOverlays";
  IterMode2[IterMode2["EnterBracketed"] = 16] = "EnterBracketed";
})(IterMode || (IterMode = {}));
var Tree = class _Tree {
  /**
  Construct a new tree. See also [`Tree.build`](#common.Tree^build).
  */
  constructor(type, children, positions, length, props) {
    this.type = type;
    this.children = children;
    this.positions = positions;
    this.length = length;
    this.props = null;
    if (props && props.length) {
      this.props = /* @__PURE__ */ Object.create(null);
      for (let [prop, value] of props)
        this.props[typeof prop == "number" ? prop : prop.id] = value;
    }
  }
  /**
  @internal
  */
  toString() {
    let mounted = MountedTree.get(this);
    if (mounted && !mounted.overlay)
      return mounted.tree.toString();
    let children = "";
    for (let ch of this.children) {
      let str = ch.toString();
      if (str) {
        if (children)
          children += ",";
        children += str;
      }
    }
    return !this.type.name ? children : (/\W/.test(this.type.name) && !this.type.isError ? JSON.stringify(this.type.name) : this.type.name) + (children.length ? "(" + children + ")" : "");
  }
  /**
  Get a [tree cursor](#common.TreeCursor) positioned at the top of
  the tree. Mode can be used to [control](#common.IterMode) which
  nodes the cursor visits.
  */
  cursor(mode = 0) {
    return new TreeCursor(this.topNode, mode);
  }
  /**
  Get a [tree cursor](#common.TreeCursor) pointing into this tree
  at the given position and side (see
  [`moveTo`](#common.TreeCursor.moveTo).
  */
  cursorAt(pos, side = 0, mode = 0) {
    let scope = CachedNode.get(this) || this.topNode;
    let cursor = new TreeCursor(scope);
    cursor.moveTo(pos, side);
    CachedNode.set(this, cursor._tree);
    return cursor;
  }
  /**
  Get a [syntax node](#common.SyntaxNode) object for the top of the
  tree.
  */
  get topNode() {
    return new TreeNode(this, 0, 0, null);
  }
  /**
  Get the [syntax node](#common.SyntaxNode) at the given position.
  If `side` is -1, this will move into nodes that end at the
  position. If 1, it'll move into nodes that start at the
  position. With 0, it'll only enter nodes that cover the position
  from both sides.

  Note that this will not enter
  [overlays](#common.MountedTree.overlay), and you often want
  [`resolveInner`](#common.Tree.resolveInner) instead.
  */
  resolve(pos, side = 0) {
    let node2 = resolveNode(CachedNode.get(this) || this.topNode, pos, side, false);
    CachedNode.set(this, node2);
    return node2;
  }
  /**
  Like [`resolve`](#common.Tree.resolve), but will enter
  [overlaid](#common.MountedTree.overlay) nodes, producing a syntax node
  pointing into the innermost overlaid tree at the given position
  (with parent links going through all parent structure, including
  the host trees).
  */
  resolveInner(pos, side = 0) {
    let node2 = resolveNode(CachedInnerNode.get(this) || this.topNode, pos, side, true);
    CachedInnerNode.set(this, node2);
    return node2;
  }
  /**
  In some situations, it can be useful to iterate through all
  nodes around a position, including those in overlays that don't
  directly cover the position. This method gives you an iterator
  that will produce all nodes, from small to big, around the given
  position.
  */
  resolveStack(pos, side = 0) {
    return stackIterator(this, pos, side);
  }
  /**
  Iterate over the tree and its children, calling `enter` for any
  node that touches the `from`/`to` region (if given) before
  running over such a node's children, and `leave` (if given) when
  leaving the node. When `enter` returns `false`, that node will
  not have its children iterated over (or `leave` called).
  */
  iterate(spec) {
    let { enter, leave, from = 0, to = this.length } = spec;
    let mode = spec.mode || 0, anon = (mode & IterMode.IncludeAnonymous) > 0;
    for (let c = this.cursor(mode | IterMode.IncludeAnonymous); ; ) {
      let entered = false;
      if (c.from <= to && c.to >= from && (!anon && c.type.isAnonymous || enter(c) !== false)) {
        if (c.firstChild())
          continue;
        entered = true;
      }
      for (; ; ) {
        if (entered && leave && (anon || !c.type.isAnonymous))
          leave(c);
        if (c.nextSibling())
          break;
        if (!c.parent())
          return;
        entered = true;
      }
    }
  }
  /**
  Get the value of the given [node prop](#common.NodeProp) for this
  node. Works with both per-node and per-type props.
  */
  prop(prop) {
    return !prop.perNode ? this.type.prop(prop) : this.props ? this.props[prop.id] : void 0;
  }
  /**
  Returns the node's [per-node props](#common.NodeProp.perNode) in a
  format that can be passed to the [`Tree`](#common.Tree)
  constructor.
  */
  get propValues() {
    let result = [];
    if (this.props)
      for (let id in this.props)
        result.push([+id, this.props[id]]);
    return result;
  }
  /**
  Balance the direct children of this tree, producing a copy of
  which may have children grouped into subtrees with type
  [`NodeType.none`](#common.NodeType^none).
  */
  balance(config = {}) {
    return this.children.length <= 8 ? this : balanceRange(NodeType.none, this.children, this.positions, 0, this.children.length, 0, this.length, (children, positions, length) => new _Tree(this.type, children, positions, length, this.propValues), config.makeTree || ((children, positions, length) => new _Tree(NodeType.none, children, positions, length)));
  }
  /**
  Build a tree from a postfix-ordered buffer of node information,
  or a cursor over such a buffer.
  */
  static build(data) {
    return buildTree(data);
  }
};
Tree.empty = new Tree(NodeType.none, [], [], 0);
var FlatBufferCursor = class _FlatBufferCursor {
  constructor(buffer, index) {
    this.buffer = buffer;
    this.index = index;
  }
  get id() {
    return this.buffer[this.index - 4];
  }
  get start() {
    return this.buffer[this.index - 3];
  }
  get end() {
    return this.buffer[this.index - 2];
  }
  get size() {
    return this.buffer[this.index - 1];
  }
  get pos() {
    return this.index;
  }
  next() {
    this.index -= 4;
  }
  fork() {
    return new _FlatBufferCursor(this.buffer, this.index);
  }
};
var TreeBuffer = class _TreeBuffer {
  /**
  Create a tree buffer.
  */
  constructor(buffer, length, set) {
    this.buffer = buffer;
    this.length = length;
    this.set = set;
  }
  /**
  @internal
  */
  get type() {
    return NodeType.none;
  }
  /**
  @internal
  */
  toString() {
    let result = [];
    for (let index = 0; index < this.buffer.length; ) {
      result.push(this.childString(index));
      index = this.buffer[index + 3];
    }
    return result.join(",");
  }
  /**
  @internal
  */
  childString(index) {
    let id = this.buffer[index], endIndex = this.buffer[index + 3];
    let type = this.set.types[id], result = type.name;
    if (/\W/.test(result) && !type.isError)
      result = JSON.stringify(result);
    index += 4;
    if (endIndex == index)
      return result;
    let children = [];
    while (index < endIndex) {
      children.push(this.childString(index));
      index = this.buffer[index + 3];
    }
    return result + "(" + children.join(",") + ")";
  }
  /**
  @internal
  */
  findChild(startIndex, endIndex, dir, pos, side) {
    let { buffer } = this, pick = -1;
    for (let i = startIndex; i != endIndex; i = buffer[i + 3]) {
      if (checkSide(side, pos, buffer[i + 1], buffer[i + 2])) {
        pick = i;
        if (dir > 0)
          break;
      }
    }
    return pick;
  }
  /**
  @internal
  */
  slice(startI, endI, from) {
    let b = this.buffer;
    let copy = new Uint16Array(endI - startI), len = 0;
    for (let i = startI, j = 0; i < endI; ) {
      copy[j++] = b[i++];
      copy[j++] = b[i++] - from;
      let to = copy[j++] = b[i++] - from;
      copy[j++] = b[i++] - startI;
      len = Math.max(len, to);
    }
    return new _TreeBuffer(copy, len, this.set);
  }
};
function checkSide(side, pos, from, to) {
  switch (side) {
    case -2:
      return from < pos;
    case -1:
      return to >= pos && from < pos;
    case 0:
      return from < pos && to > pos;
    case 1:
      return from <= pos && to > pos;
    case 2:
      return to > pos;
    case 4:
      return true;
  }
}
function resolveNode(node2, pos, side, overlays) {
  var _a2;
  while (node2.from == node2.to || (side < 1 ? node2.from >= pos : node2.from > pos) || (side > -1 ? node2.to <= pos : node2.to < pos)) {
    let parent = !overlays && node2 instanceof TreeNode && node2.index < 0 ? null : node2.parent;
    if (!parent)
      return node2;
    node2 = parent;
  }
  let mode = overlays ? 0 : IterMode.IgnoreOverlays;
  if (overlays)
    for (let scan = node2, parent = scan.parent; parent; scan = parent, parent = scan.parent) {
      if (scan instanceof TreeNode && scan.index < 0 && ((_a2 = parent.enter(pos, side, mode)) === null || _a2 === void 0 ? void 0 : _a2.from) != scan.from)
        node2 = parent;
    }
  for (; ; ) {
    let inner = node2.enter(pos, side, mode);
    if (!inner)
      return node2;
    node2 = inner;
  }
}
var BaseNode = class {
  cursor(mode = 0) {
    return new TreeCursor(this, mode);
  }
  getChild(type, before = null, after = null) {
    let r = getChildren(this, type, before, after);
    return r.length ? r[0] : null;
  }
  getChildren(type, before = null, after = null) {
    return getChildren(this, type, before, after);
  }
  resolve(pos, side = 0) {
    return resolveNode(this, pos, side, false);
  }
  resolveInner(pos, side = 0) {
    return resolveNode(this, pos, side, true);
  }
  matchContext(context) {
    return matchNodeContext(this.parent, context);
  }
  enterUnfinishedNodesBefore(pos) {
    let scan = this.childBefore(pos), node2 = this;
    while (scan) {
      let last = scan.lastChild;
      if (!last || last.to != scan.to)
        break;
      if (last.type.isError && last.from == last.to) {
        node2 = scan;
        scan = last.prevSibling;
      } else {
        scan = last;
      }
    }
    return node2;
  }
  get node() {
    return this;
  }
  get next() {
    return this.parent;
  }
};
var TreeNode = class _TreeNode extends BaseNode {
  constructor(_tree, from, index, _parent) {
    super();
    this._tree = _tree;
    this.from = from;
    this.index = index;
    this._parent = _parent;
  }
  get type() {
    return this._tree.type;
  }
  get name() {
    return this._tree.type.name;
  }
  get to() {
    return this.from + this._tree.length;
  }
  nextChild(i, dir, pos, side, mode = 0) {
    for (let parent = this; ; ) {
      for (let { children, positions } = parent._tree, e = dir > 0 ? children.length : -1; i != e; i += dir) {
        let next = children[i], start = positions[i] + parent.from, mounted;
        if (!(mode & IterMode.EnterBracketed && next instanceof Tree && (mounted = MountedTree.get(next)) && !mounted.overlay && mounted.bracketed && pos >= start && pos <= start + next.length) && !checkSide(side, pos, start, start + next.length))
          continue;
        if (next instanceof TreeBuffer) {
          if (mode & IterMode.ExcludeBuffers)
            continue;
          let index = next.findChild(0, next.buffer.length, dir, pos - start, side);
          if (index > -1)
            return new BufferNode(new BufferContext(parent, next, i, start), null, index);
        } else if (mode & IterMode.IncludeAnonymous || (!next.type.isAnonymous || hasChild(next))) {
          let mounted2;
          if (!(mode & IterMode.IgnoreMounts) && (mounted2 = MountedTree.get(next)) && !mounted2.overlay)
            return new _TreeNode(mounted2.tree, start, i, parent);
          let inner = new _TreeNode(next, start, i, parent);
          return mode & IterMode.IncludeAnonymous || !inner.type.isAnonymous ? inner : inner.nextChild(dir < 0 ? next.children.length - 1 : 0, dir, pos, side, mode);
        }
      }
      if (mode & IterMode.IncludeAnonymous || !parent.type.isAnonymous)
        return null;
      if (parent.index >= 0)
        i = parent.index + dir;
      else
        i = dir < 0 ? -1 : parent._parent._tree.children.length;
      parent = parent._parent;
      if (!parent)
        return null;
    }
  }
  get firstChild() {
    return this.nextChild(
      0,
      1,
      0,
      4
      /* Side.DontCare */
    );
  }
  get lastChild() {
    return this.nextChild(
      this._tree.children.length - 1,
      -1,
      0,
      4
      /* Side.DontCare */
    );
  }
  childAfter(pos) {
    return this.nextChild(
      0,
      1,
      pos,
      2
      /* Side.After */
    );
  }
  childBefore(pos) {
    return this.nextChild(
      this._tree.children.length - 1,
      -1,
      pos,
      -2
      /* Side.Before */
    );
  }
  prop(prop) {
    return this._tree.prop(prop);
  }
  enter(pos, side, mode = 0) {
    let mounted;
    if (!(mode & IterMode.IgnoreOverlays) && (mounted = MountedTree.get(this._tree)) && mounted.overlay) {
      let rPos = pos - this.from, enterBracketed = mode & IterMode.EnterBracketed && mounted.bracketed;
      for (let { from, to } of mounted.overlay) {
        if ((side > 0 || enterBracketed ? from <= rPos : from < rPos) && (side < 0 || enterBracketed ? to >= rPos : to > rPos))
          return new _TreeNode(mounted.tree, mounted.overlay[0].from + this.from, -1, this);
      }
    }
    return this.nextChild(0, 1, pos, side, mode);
  }
  nextSignificantParent() {
    let val = this;
    while (val.type.isAnonymous && val._parent)
      val = val._parent;
    return val;
  }
  get parent() {
    return this._parent ? this._parent.nextSignificantParent() : null;
  }
  get nextSibling() {
    return this._parent && this.index >= 0 ? this._parent.nextChild(
      this.index + 1,
      1,
      0,
      4
      /* Side.DontCare */
    ) : null;
  }
  get prevSibling() {
    return this._parent && this.index >= 0 ? this._parent.nextChild(
      this.index - 1,
      -1,
      0,
      4
      /* Side.DontCare */
    ) : null;
  }
  get tree() {
    return this._tree;
  }
  toTree() {
    return this._tree;
  }
  /**
  @internal
  */
  toString() {
    return this._tree.toString();
  }
};
function getChildren(node2, type, before, after) {
  let cur = node2.cursor(), result = [];
  if (!cur.firstChild())
    return result;
  if (before != null)
    for (let found = false; !found; ) {
      found = cur.type.is(before);
      if (!cur.nextSibling())
        return result;
    }
  for (; ; ) {
    if (after != null && cur.type.is(after))
      return result;
    if (cur.type.is(type))
      result.push(cur.node);
    if (!cur.nextSibling())
      return after == null ? result : [];
  }
}
function matchNodeContext(node2, context, i = context.length - 1) {
  for (let p = node2; i >= 0; p = p.parent) {
    if (!p)
      return false;
    if (!p.type.isAnonymous) {
      if (context[i] && context[i] != p.name)
        return false;
      i--;
    }
  }
  return true;
}
var BufferContext = class {
  constructor(parent, buffer, index, start) {
    this.parent = parent;
    this.buffer = buffer;
    this.index = index;
    this.start = start;
  }
};
var BufferNode = class _BufferNode extends BaseNode {
  get name() {
    return this.type.name;
  }
  get from() {
    return this.context.start + this.context.buffer.buffer[this.index + 1];
  }
  get to() {
    return this.context.start + this.context.buffer.buffer[this.index + 2];
  }
  constructor(context, _parent, index) {
    super();
    this.context = context;
    this._parent = _parent;
    this.index = index;
    this.type = context.buffer.set.types[context.buffer.buffer[index]];
  }
  child(dir, pos, side) {
    let { buffer } = this.context;
    let index = buffer.findChild(this.index + 4, buffer.buffer[this.index + 3], dir, pos - this.context.start, side);
    return index < 0 ? null : new _BufferNode(this.context, this, index);
  }
  get firstChild() {
    return this.child(
      1,
      0,
      4
      /* Side.DontCare */
    );
  }
  get lastChild() {
    return this.child(
      -1,
      0,
      4
      /* Side.DontCare */
    );
  }
  childAfter(pos) {
    return this.child(
      1,
      pos,
      2
      /* Side.After */
    );
  }
  childBefore(pos) {
    return this.child(
      -1,
      pos,
      -2
      /* Side.Before */
    );
  }
  prop(prop) {
    return this.type.prop(prop);
  }
  enter(pos, side, mode = 0) {
    if (mode & IterMode.ExcludeBuffers)
      return null;
    let { buffer } = this.context;
    let index = buffer.findChild(this.index + 4, buffer.buffer[this.index + 3], side > 0 ? 1 : -1, pos - this.context.start, side);
    return index < 0 ? null : new _BufferNode(this.context, this, index);
  }
  get parent() {
    return this._parent || this.context.parent.nextSignificantParent();
  }
  externalSibling(dir) {
    return this._parent ? null : this.context.parent.nextChild(
      this.context.index + dir,
      dir,
      0,
      4
      /* Side.DontCare */
    );
  }
  get nextSibling() {
    let { buffer } = this.context;
    let after = buffer.buffer[this.index + 3];
    if (after < (this._parent ? buffer.buffer[this._parent.index + 3] : buffer.buffer.length))
      return new _BufferNode(this.context, this._parent, after);
    return this.externalSibling(1);
  }
  get prevSibling() {
    let { buffer } = this.context;
    let parentStart = this._parent ? this._parent.index + 4 : 0;
    if (this.index == parentStart)
      return this.externalSibling(-1);
    return new _BufferNode(this.context, this._parent, buffer.findChild(
      parentStart,
      this.index,
      -1,
      0,
      4
      /* Side.DontCare */
    ));
  }
  get tree() {
    return null;
  }
  toTree() {
    let children = [], positions = [];
    let { buffer } = this.context;
    let startI = this.index + 4, endI = buffer.buffer[this.index + 3];
    if (endI > startI) {
      let from = buffer.buffer[this.index + 1];
      children.push(buffer.slice(startI, endI, from));
      positions.push(0);
    }
    return new Tree(this.type, children, positions, this.to - this.from);
  }
  /**
  @internal
  */
  toString() {
    return this.context.buffer.childString(this.index);
  }
};
function iterStack(heads) {
  if (!heads.length)
    return null;
  let pick = 0, picked = heads[0];
  for (let i = 1; i < heads.length; i++) {
    let node2 = heads[i];
    if (node2.from > picked.from || node2.to < picked.to) {
      picked = node2;
      pick = i;
    }
  }
  let next = picked instanceof TreeNode && picked.index < 0 ? null : picked.parent;
  let newHeads = heads.slice();
  if (next)
    newHeads[pick] = next;
  else
    newHeads.splice(pick, 1);
  return new StackIterator(newHeads, picked);
}
var StackIterator = class {
  constructor(heads, node2) {
    this.heads = heads;
    this.node = node2;
  }
  get next() {
    return iterStack(this.heads);
  }
};
function stackIterator(tree, pos, side) {
  let inner = tree.resolveInner(pos, side), layers = null;
  for (let scan = inner instanceof TreeNode ? inner : inner.context.parent; scan; scan = scan.parent) {
    if (scan.index < 0) {
      let parent = scan.parent;
      (layers || (layers = [inner])).push(parent.resolve(pos, side));
      scan = parent;
    } else {
      let mount = MountedTree.get(scan.tree);
      if (mount && mount.overlay && mount.overlay[0].from <= pos && mount.overlay[mount.overlay.length - 1].to >= pos) {
        let root = new TreeNode(mount.tree, mount.overlay[0].from + scan.from, -1, scan);
        (layers || (layers = [inner])).push(resolveNode(root, pos, side, false));
      }
    }
  }
  return layers ? iterStack(layers) : inner;
}
var TreeCursor = class {
  /**
  Shorthand for `.type.name`.
  */
  get name() {
    return this.type.name;
  }
  /**
  @internal
  */
  constructor(node2, mode = 0) {
    this.buffer = null;
    this.stack = [];
    this.index = 0;
    this.bufferNode = null;
    this.mode = mode & ~IterMode.EnterBracketed;
    if (node2 instanceof TreeNode) {
      this.yieldNode(node2);
    } else {
      this._tree = node2.context.parent;
      this.buffer = node2.context;
      for (let n = node2._parent; n; n = n._parent)
        this.stack.unshift(n.index);
      this.bufferNode = node2;
      this.yieldBuf(node2.index);
    }
  }
  yieldNode(node2) {
    if (!node2)
      return false;
    this._tree = node2;
    this.type = node2.type;
    this.from = node2.from;
    this.to = node2.to;
    return true;
  }
  yieldBuf(index, type) {
    this.index = index;
    let { start, buffer } = this.buffer;
    this.type = type || buffer.set.types[buffer.buffer[index]];
    this.from = start + buffer.buffer[index + 1];
    this.to = start + buffer.buffer[index + 2];
    return true;
  }
  /**
  @internal
  */
  yield(node2) {
    if (!node2)
      return false;
    if (node2 instanceof TreeNode) {
      this.buffer = null;
      return this.yieldNode(node2);
    }
    this.buffer = node2.context;
    return this.yieldBuf(node2.index, node2.type);
  }
  /**
  @internal
  */
  toString() {
    return this.buffer ? this.buffer.buffer.childString(this.index) : this._tree.toString();
  }
  /**
  @internal
  */
  enterChild(dir, pos, side) {
    if (!this.buffer)
      return this.yield(this._tree.nextChild(dir < 0 ? this._tree._tree.children.length - 1 : 0, dir, pos, side, this.mode));
    let { buffer } = this.buffer;
    let index = buffer.findChild(this.index + 4, buffer.buffer[this.index + 3], dir, pos - this.buffer.start, side);
    if (index < 0)
      return false;
    this.stack.push(this.index);
    return this.yieldBuf(index);
  }
  /**
  Move the cursor to this node's first child. When this returns
  false, the node has no child, and the cursor has not been moved.
  */
  firstChild() {
    return this.enterChild(
      1,
      0,
      4
      /* Side.DontCare */
    );
  }
  /**
  Move the cursor to this node's last child.
  */
  lastChild() {
    return this.enterChild(
      -1,
      0,
      4
      /* Side.DontCare */
    );
  }
  /**
  Move the cursor to the first child that ends after `pos`.
  */
  childAfter(pos) {
    return this.enterChild(
      1,
      pos,
      2
      /* Side.After */
    );
  }
  /**
  Move to the last child that starts before `pos`.
  */
  childBefore(pos) {
    return this.enterChild(
      -1,
      pos,
      -2
      /* Side.Before */
    );
  }
  /**
  Move the cursor to the child around `pos`. If side is -1 the
  child may end at that position, when 1 it may start there. This
  will also enter [overlaid](#common.MountedTree.overlay)
  [mounted](#common.NodeProp^mounted) trees unless `overlays` is
  set to false.
  */
  enter(pos, side, mode = this.mode) {
    if (!this.buffer)
      return this.yield(this._tree.enter(pos, side, mode));
    return mode & IterMode.ExcludeBuffers ? false : this.enterChild(1, pos, side);
  }
  /**
  Move to the node's parent node, if this isn't the top node.
  */
  parent() {
    if (!this.buffer)
      return this.yieldNode(this.mode & IterMode.IncludeAnonymous ? this._tree._parent : this._tree.parent);
    if (this.stack.length)
      return this.yieldBuf(this.stack.pop());
    let parent = this.mode & IterMode.IncludeAnonymous ? this.buffer.parent : this.buffer.parent.nextSignificantParent();
    this.buffer = null;
    return this.yieldNode(parent);
  }
  /**
  @internal
  */
  sibling(dir) {
    if (!this.buffer)
      return !this._tree._parent ? false : this.yield(this._tree.index < 0 ? null : this._tree._parent.nextChild(this._tree.index + dir, dir, 0, 4, this.mode));
    let { buffer } = this.buffer, d = this.stack.length - 1;
    if (dir < 0) {
      let parentStart = d < 0 ? 0 : this.stack[d] + 4;
      if (this.index != parentStart)
        return this.yieldBuf(buffer.findChild(
          parentStart,
          this.index,
          -1,
          0,
          4
          /* Side.DontCare */
        ));
    } else {
      let after = buffer.buffer[this.index + 3];
      if (after < (d < 0 ? buffer.buffer.length : buffer.buffer[this.stack[d] + 3]))
        return this.yieldBuf(after);
    }
    return d < 0 ? this.yield(this.buffer.parent.nextChild(this.buffer.index + dir, dir, 0, 4, this.mode)) : false;
  }
  /**
  Move to this node's next sibling, if any.
  */
  nextSibling() {
    return this.sibling(1);
  }
  /**
  Move to this node's previous sibling, if any.
  */
  prevSibling() {
    return this.sibling(-1);
  }
  atLastNode(dir) {
    let index, parent, { buffer } = this;
    if (buffer) {
      if (dir > 0) {
        if (this.index < buffer.buffer.buffer.length)
          return false;
      } else {
        for (let i = 0; i < this.index; i++)
          if (buffer.buffer.buffer[i + 3] < this.index)
            return false;
      }
      ({ index, parent } = buffer);
    } else {
      ({ index, _parent: parent } = this._tree);
    }
    for (; parent; { index, _parent: parent } = parent) {
      if (index > -1)
        for (let i = index + dir, e = dir < 0 ? -1 : parent._tree.children.length; i != e; i += dir) {
          let child = parent._tree.children[i];
          if (this.mode & IterMode.IncludeAnonymous || child instanceof TreeBuffer || !child.type.isAnonymous || hasChild(child))
            return false;
        }
    }
    return true;
  }
  move(dir, enter) {
    if (enter && this.enterChild(
      dir,
      0,
      4
      /* Side.DontCare */
    ))
      return true;
    for (; ; ) {
      if (this.sibling(dir))
        return true;
      if (this.atLastNode(dir) || !this.parent())
        return false;
    }
  }
  /**
  Move to the next node in a
  [pre-order](https://en.wikipedia.org/wiki/Tree_traversal#Pre-order,_NLR)
  traversal, going from a node to its first child or, if the
  current node is empty or `enter` is false, its next sibling or
  the next sibling of the first parent node that has one.
  */
  next(enter = true) {
    return this.move(1, enter);
  }
  /**
  Move to the next node in a last-to-first pre-order traversal. A
  node is followed by its last child or, if it has none, its
  previous sibling or the previous sibling of the first parent
  node that has one.
  */
  prev(enter = true) {
    return this.move(-1, enter);
  }
  /**
  Move the cursor to the innermost node that covers `pos`. If
  `side` is -1, it will enter nodes that end at `pos`. If it is 1,
  it will enter nodes that start at `pos`.
  */
  moveTo(pos, side = 0) {
    while (this.from == this.to || (side < 1 ? this.from >= pos : this.from > pos) || (side > -1 ? this.to <= pos : this.to < pos))
      if (!this.parent())
        break;
    while (this.enterChild(1, pos, side)) {
    }
    return this;
  }
  /**
  Get a [syntax node](#common.SyntaxNode) at the cursor's current
  position.
  */
  get node() {
    if (!this.buffer)
      return this._tree;
    let cache = this.bufferNode, result = null, depth = 0;
    if (cache && cache.context == this.buffer) {
      scan: for (let index = this.index, d = this.stack.length; d >= 0; ) {
        for (let c = cache; c; c = c._parent)
          if (c.index == index) {
            if (index == this.index)
              return c;
            result = c;
            depth = d + 1;
            break scan;
          }
        index = this.stack[--d];
      }
    }
    for (let i = depth; i < this.stack.length; i++)
      result = new BufferNode(this.buffer, result, this.stack[i]);
    return this.bufferNode = new BufferNode(this.buffer, result, this.index);
  }
  /**
  Get the [tree](#common.Tree) that represents the current node, if
  any. Will return null when the node is in a [tree
  buffer](#common.TreeBuffer).
  */
  get tree() {
    return this.buffer ? null : this._tree._tree;
  }
  /**
  Iterate over the current node and all its descendants, calling
  `enter` when entering a node and `leave`, if given, when leaving
  one. When `enter` returns `false`, any children of that node are
  skipped, and `leave` isn't called for it.
  */
  iterate(enter, leave) {
    for (let depth = 0; ; ) {
      let mustLeave = false;
      if (this.type.isAnonymous || enter(this) !== false) {
        if (this.firstChild()) {
          depth++;
          continue;
        }
        if (!this.type.isAnonymous)
          mustLeave = true;
      }
      for (; ; ) {
        if (mustLeave && leave)
          leave(this);
        mustLeave = this.type.isAnonymous;
        if (!depth)
          return;
        if (this.nextSibling())
          break;
        this.parent();
        depth--;
        mustLeave = true;
      }
    }
  }
  /**
  Test whether the current node matches a given context—a sequence
  of direct parent node names. Empty strings in the context array
  are treated as wildcards.
  */
  matchContext(context) {
    if (!this.buffer)
      return matchNodeContext(this.node.parent, context);
    let { buffer } = this.buffer, { types } = buffer.set;
    for (let i = context.length - 1, d = this.stack.length - 1; i >= 0; d--) {
      if (d < 0)
        return matchNodeContext(this._tree, context, i);
      let type = types[buffer.buffer[this.stack[d]]];
      if (!type.isAnonymous) {
        if (context[i] && context[i] != type.name)
          return false;
        i--;
      }
    }
    return true;
  }
};
function hasChild(tree) {
  return tree.children.some((ch) => ch instanceof TreeBuffer || !ch.type.isAnonymous || hasChild(ch));
}
function buildTree(data) {
  var _a2;
  let { buffer, nodeSet, maxBufferLength = DefaultBufferLength, reused = [], minRepeatType = nodeSet.types.length } = data;
  let cursor = Array.isArray(buffer) ? new FlatBufferCursor(buffer, buffer.length) : buffer;
  let types = nodeSet.types;
  let contextHash = 0, lookAhead = 0;
  function takeNode(parentStart, minPos, children2, positions2, inRepeat, depth) {
    let { id, start, end, size } = cursor;
    let lookAheadAtStart = lookAhead, contextAtStart = contextHash;
    if (size < 0) {
      cursor.next();
      if (size == -1) {
        let node3 = reused[id];
        children2.push(node3);
        positions2.push(start - parentStart);
        return;
      } else if (size == -3) {
        contextHash = id;
        return;
      } else if (size == -4) {
        lookAhead = id;
        return;
      } else {
        throw new RangeError(`Unrecognized record size: ${size}`);
      }
    }
    let type = types[id], node2, buffer2;
    let startPos = start - parentStart;
    if (end - start <= maxBufferLength && (buffer2 = findBufferSize(cursor.pos - minPos, inRepeat))) {
      let data2 = new Uint16Array(buffer2.size - buffer2.skip);
      let endPos = cursor.pos - buffer2.size, index = data2.length;
      while (cursor.pos > endPos)
        index = copyToBuffer(buffer2.start, data2, index);
      node2 = new TreeBuffer(data2, end - buffer2.start, nodeSet);
      startPos = buffer2.start - parentStart;
    } else {
      let endPos = cursor.pos - size;
      cursor.next();
      let localChildren = [], localPositions = [];
      let localInRepeat = id >= minRepeatType ? id : -1;
      let lastGroup = 0, lastEnd = end, groupLookAhead = lookAheadAtStart;
      while (cursor.pos > endPos) {
        if (localInRepeat >= 0 && cursor.id == localInRepeat && cursor.size >= 0) {
          if (cursor.end <= lastEnd - maxBufferLength) {
            makeRepeatLeaf(localChildren, localPositions, start, lastGroup, cursor.end, lastEnd, localInRepeat, groupLookAhead, contextAtStart);
            lastGroup = localChildren.length;
            lastEnd = cursor.end;
            groupLookAhead = lookAhead;
          }
          cursor.next();
        } else if (depth > 2500) {
          takeFlatNode(start, endPos, localChildren, localPositions);
        } else {
          takeNode(start, endPos, localChildren, localPositions, localInRepeat, depth + 1);
        }
      }
      if (localInRepeat >= 0 && lastGroup > 0 && lastGroup < localChildren.length)
        makeRepeatLeaf(localChildren, localPositions, start, lastGroup, start, lastEnd, localInRepeat, groupLookAhead, contextAtStart);
      localChildren.reverse();
      localPositions.reverse();
      if (localInRepeat > -1 && lastGroup > 0) {
        let make = makeBalanced(type, contextAtStart);
        node2 = balanceRange(type, localChildren, localPositions, 0, localChildren.length, 0, end - start, make, make);
      } else {
        node2 = makeTree(type, localChildren, localPositions, end - start, lookAheadAtStart - end, contextAtStart);
      }
    }
    children2.push(node2);
    positions2.push(startPos);
  }
  function takeFlatNode(parentStart, minPos, children2, positions2) {
    let nodes = [];
    let nodeCount = 0, stopAt = -1;
    while (cursor.pos > minPos) {
      let { id, start, end, size } = cursor;
      if (size > 4) {
        cursor.next();
      } else if (stopAt > -1 && start < stopAt) {
        break;
      } else {
        if (stopAt < 0)
          stopAt = end - maxBufferLength;
        nodes.push(id, start, end);
        nodeCount++;
        cursor.next();
      }
    }
    if (nodeCount) {
      let buffer2 = new Uint16Array(nodeCount * 4);
      let start = nodes[nodes.length - 2];
      for (let i = nodes.length - 3, j = 0; i >= 0; i -= 3) {
        buffer2[j++] = nodes[i];
        buffer2[j++] = nodes[i + 1] - start;
        buffer2[j++] = nodes[i + 2] - start;
        buffer2[j++] = j;
      }
      children2.push(new TreeBuffer(buffer2, nodes[2] - start, nodeSet));
      positions2.push(start - parentStart);
    }
  }
  function makeBalanced(type, contextHash2) {
    return (children2, positions2, length2) => {
      let lookAhead2 = 0, lastI = children2.length - 1, last, lookAheadProp;
      if (lastI >= 0 && (last = children2[lastI]) instanceof Tree) {
        if (!lastI && last.type == type && last.length == length2)
          return last;
        if (lookAheadProp = last.prop(NodeProp.lookAhead))
          lookAhead2 = positions2[lastI] + last.length + lookAheadProp - length2;
      }
      return makeTree(type, children2, positions2, length2, lookAhead2, contextHash2);
    };
  }
  function makeRepeatLeaf(children2, positions2, base, i, from, to, type, lookAhead2, contextHash2) {
    let localChildren = [], localPositions = [];
    while (children2.length > i) {
      localChildren.push(children2.pop());
      localPositions.push(positions2.pop() + base - from);
    }
    children2.push(makeTree(nodeSet.types[type], localChildren, localPositions, to - from, lookAhead2 - to, contextHash2));
    positions2.push(from - base);
  }
  function makeTree(type, children2, positions2, length2, lookAhead2, contextHash2, props) {
    if (contextHash2) {
      let pair = [NodeProp.contextHash, contextHash2];
      props = props ? [pair].concat(props) : [pair];
    }
    if (lookAhead2 > 25) {
      let pair = [NodeProp.lookAhead, lookAhead2];
      props = props ? [pair].concat(props) : [pair];
    }
    return new Tree(type, children2, positions2, length2, props);
  }
  function findBufferSize(maxSize, inRepeat) {
    let fork = cursor.fork();
    let size = 0, start = 0, skip = 0, minStart = fork.end - maxBufferLength;
    let result = { size: 0, start: 0, skip: 0 };
    scan: for (let minPos = fork.pos - maxSize; fork.pos > minPos; ) {
      let nodeSize2 = fork.size;
      if (fork.id == inRepeat && nodeSize2 >= 0) {
        result.size = size;
        result.start = start;
        result.skip = skip;
        skip += 4;
        size += 4;
        fork.next();
        continue;
      }
      let startPos = fork.pos - nodeSize2;
      if (nodeSize2 < 0 || startPos < minPos || fork.start < minStart)
        break;
      let localSkipped = fork.id >= minRepeatType ? 4 : 0;
      let nodeStart = fork.start;
      fork.next();
      while (fork.pos > startPos) {
        if (fork.size < 0) {
          if (fork.size == -3 || fork.size == -4)
            localSkipped += 4;
          else
            break scan;
        } else if (fork.id >= minRepeatType) {
          localSkipped += 4;
        }
        fork.next();
      }
      start = nodeStart;
      size += nodeSize2;
      skip += localSkipped;
    }
    if (inRepeat < 0 || size == maxSize) {
      result.size = size;
      result.start = start;
      result.skip = skip;
    }
    return result.size > 4 ? result : void 0;
  }
  function copyToBuffer(bufferStart, buffer2, index) {
    let { id, start, end, size } = cursor;
    cursor.next();
    if (size >= 0 && id < minRepeatType) {
      let startIndex = index;
      if (size > 4) {
        let endPos = cursor.pos - (size - 4);
        while (cursor.pos > endPos)
          index = copyToBuffer(bufferStart, buffer2, index);
      }
      buffer2[--index] = startIndex;
      buffer2[--index] = end - bufferStart;
      buffer2[--index] = start - bufferStart;
      buffer2[--index] = id;
    } else if (size == -3) {
      contextHash = id;
    } else if (size == -4) {
      lookAhead = id;
    }
    return index;
  }
  let children = [], positions = [];
  while (cursor.pos > 0)
    takeNode(data.start || 0, data.bufferStart || 0, children, positions, -1, 0);
  let length = (_a2 = data.length) !== null && _a2 !== void 0 ? _a2 : children.length ? positions[0] + children[0].length : 0;
  return new Tree(types[data.topID], children.reverse(), positions.reverse(), length);
}
var nodeSizeCache = /* @__PURE__ */ new WeakMap();
function nodeSize(balanceType, node2) {
  if (!balanceType.isAnonymous || node2 instanceof TreeBuffer || node2.type != balanceType)
    return 1;
  let size = nodeSizeCache.get(node2);
  if (size == null) {
    size = 1;
    for (let child of node2.children) {
      if (child.type != balanceType || !(child instanceof Tree)) {
        size = 1;
        break;
      }
      size += nodeSize(balanceType, child);
    }
    nodeSizeCache.set(node2, size);
  }
  return size;
}
function balanceRange(balanceType, children, positions, from, to, start, length, mkTop, mkTree) {
  let total = 0;
  for (let i = from; i < to; i++)
    total += nodeSize(balanceType, children[i]);
  let maxChild = Math.ceil(
    total * 1.5 / 8
    /* Balance.BranchFactor */
  );
  let localChildren = [], localPositions = [];
  function divide(children2, positions2, from2, to2, offset) {
    for (let i = from2; i < to2; ) {
      let groupFrom = i, groupStart = positions2[i], groupSize = nodeSize(balanceType, children2[i]);
      i++;
      for (; i < to2; i++) {
        let nextSize = nodeSize(balanceType, children2[i]);
        if (groupSize + nextSize >= maxChild)
          break;
        groupSize += nextSize;
      }
      if (i == groupFrom + 1) {
        if (groupSize > maxChild) {
          let only = children2[groupFrom];
          divide(only.children, only.positions, 0, only.children.length, positions2[groupFrom] + offset);
          continue;
        }
        localChildren.push(children2[groupFrom]);
      } else {
        let length2 = positions2[i - 1] + children2[i - 1].length - groupStart;
        localChildren.push(balanceRange(balanceType, children2, positions2, groupFrom, i, groupStart, length2, null, mkTree));
      }
      localPositions.push(groupStart + offset - start);
    }
  }
  divide(children, positions, from, to, 0);
  return (mkTop || mkTree)(localChildren, localPositions, length);
}
var TreeFragment = class _TreeFragment {
  /**
  Construct a tree fragment. You'll usually want to use
  [`addTree`](#common.TreeFragment^addTree) and
  [`applyChanges`](#common.TreeFragment^applyChanges) instead of
  calling this directly.
  */
  constructor(from, to, tree, offset, openStart = false, openEnd = false) {
    this.from = from;
    this.to = to;
    this.tree = tree;
    this.offset = offset;
    this.open = (openStart ? 1 : 0) | (openEnd ? 2 : 0);
  }
  /**
  Whether the start of the fragment represents the start of a
  parse, or the end of a change. (In the second case, it may not
  be safe to reuse some nodes at the start, depending on the
  parsing algorithm.)
  */
  get openStart() {
    return (this.open & 1) > 0;
  }
  /**
  Whether the end of the fragment represents the end of a
  full-document parse, or the start of a change.
  */
  get openEnd() {
    return (this.open & 2) > 0;
  }
  /**
  Create a set of fragments from a freshly parsed tree, or update
  an existing set of fragments by replacing the ones that overlap
  with a tree with content from the new tree. When `partial` is
  true, the parse is treated as incomplete, and the resulting
  fragment has [`openEnd`](#common.TreeFragment.openEnd) set to
  true.
  */
  static addTree(tree, fragments = [], partial = false) {
    let result = [new _TreeFragment(0, tree.length, tree, 0, false, partial)];
    for (let f of fragments)
      if (f.to > tree.length)
        result.push(f);
    return result;
  }
  /**
  Apply a set of edits to an array of fragments, removing or
  splitting fragments as necessary to remove edited ranges, and
  adjusting offsets for fragments that moved.
  */
  static applyChanges(fragments, changes, minGap = 128) {
    if (!changes.length)
      return fragments;
    let result = [];
    let fI = 1, nextF = fragments.length ? fragments[0] : null;
    for (let cI = 0, pos = 0, off = 0; ; cI++) {
      let nextC = cI < changes.length ? changes[cI] : null;
      let nextPos = nextC ? nextC.fromA : 1e9;
      if (nextPos - pos >= minGap)
        while (nextF && nextF.from < nextPos) {
          let cut = nextF;
          if (pos >= cut.from || nextPos <= cut.to || off) {
            let fFrom = Math.max(cut.from, pos) - off, fTo = Math.min(cut.to, nextPos) - off;
            cut = fFrom >= fTo ? null : new _TreeFragment(fFrom, fTo, cut.tree, cut.offset + off, cI > 0, !!nextC);
          }
          if (cut)
            result.push(cut);
          if (nextF.to > nextPos)
            break;
          nextF = fI < fragments.length ? fragments[fI++] : null;
        }
      if (!nextC)
        break;
      pos = nextC.toA;
      off = nextC.toA - nextC.toB;
    }
    return result;
  }
};
var Parser = class {
  /**
  Start a parse, returning a [partial parse](#common.PartialParse)
  object. [`fragments`](#common.TreeFragment) can be passed in to
  make the parse incremental.

  By default, the entire input is parsed. You can pass `ranges`,
  which should be a sorted array of non-empty, non-overlapping
  ranges, to parse only those ranges. The tree returned in that
  case will start at `ranges[0].from`.
  */
  startParse(input, fragments, ranges) {
    if (typeof input == "string")
      input = new StringInput(input);
    ranges = !ranges ? [new Range(0, input.length)] : ranges.length ? ranges.map((r) => new Range(r.from, r.to)) : [new Range(0, 0)];
    return this.createParse(input, fragments || [], ranges);
  }
  /**
  Run a full parse, returning the resulting tree.
  */
  parse(input, fragments, ranges) {
    let parse = this.startParse(input, fragments, ranges);
    for (; ; ) {
      let done = parse.advance();
      if (done)
        return done;
    }
  }
};
var StringInput = class {
  constructor(string2) {
    this.string = string2;
  }
  get length() {
    return this.string.length;
  }
  chunk(from) {
    return this.string.slice(from);
  }
  get lineChunks() {
    return false;
  }
  read(from, to) {
    return this.string.slice(from, to);
  }
};
var stoppedInner = new NodeProp({ perNode: true });

// node_modules/@codemirror/language/dist/index.js
var import_state = require("@codemirror/state");
var import_view2 = require("@codemirror/view");

// node_modules/@lezer/highlight/dist/index.js
var nextTagID = 0;
var Tag = class _Tag {
  /**
  @internal
  */
  constructor(name2, set, base, modified) {
    this.name = name2;
    this.set = set;
    this.base = base;
    this.modified = modified;
    this.id = nextTagID++;
  }
  toString() {
    let { name: name2 } = this;
    for (let mod of this.modified)
      if (mod.name)
        name2 = `${mod.name}(${name2})`;
    return name2;
  }
  static define(nameOrParent, parent) {
    let name2 = typeof nameOrParent == "string" ? nameOrParent : "?";
    if (nameOrParent instanceof _Tag)
      parent = nameOrParent;
    if (parent === null || parent === void 0 ? void 0 : parent.base)
      throw new Error("Can not derive from a modified tag");
    let tag = new _Tag(name2, [], null, []);
    tag.set.push(tag);
    if (parent)
      for (let t2 of parent.set)
        tag.set.push(t2);
    return tag;
  }
  /**
  Define a tag _modifier_, which is a function that, given a tag,
  will return a tag that is a subtag of the original. Applying the
  same modifier to a twice tag will return the same value (`m1(t1)
  == m1(t1)`) and applying multiple modifiers will, regardless or
  order, produce the same tag (`m1(m2(t1)) == m2(m1(t1))`).

  When multiple modifiers are applied to a given base tag, each
  smaller set of modifiers is registered as a parent, so that for
  example `m1(m2(m3(t1)))` is a subtype of `m1(m2(t1))`,
  `m1(m3(t1)`, and so on.
  */
  static defineModifier(name2) {
    let mod = new Modifier(name2);
    return (tag) => {
      if (tag.modified.indexOf(mod) > -1)
        return tag;
      return Modifier.get(tag.base || tag, tag.modified.concat(mod).sort((a, b) => a.id - b.id));
    };
  }
};
var nextModifierID = 0;
var Modifier = class _Modifier {
  constructor(name2) {
    this.name = name2;
    this.instances = [];
    this.id = nextModifierID++;
  }
  static get(base, mods) {
    if (!mods.length)
      return base;
    let exists = mods[0].instances.find((t2) => t2.base == base && sameArray(mods, t2.modified));
    if (exists)
      return exists;
    let set = [], tag = new Tag(base.name, set, base, mods);
    for (let m of mods)
      m.instances.push(tag);
    let configs = powerSet(mods);
    for (let parent of base.set)
      if (!parent.modified.length)
        for (let config of configs)
          set.push(_Modifier.get(parent, config));
    return tag;
  }
};
function sameArray(a, b) {
  return a.length == b.length && a.every((x, i) => x == b[i]);
}
function powerSet(array) {
  let sets = [[]];
  for (let i = 0; i < array.length; i++) {
    for (let j = 0, e = sets.length; j < e; j++) {
      sets.push(sets[j].concat(array[i]));
    }
  }
  return sets.sort((a, b) => b.length - a.length);
}
function styleTags(spec) {
  let byName = /* @__PURE__ */ Object.create(null);
  for (let prop in spec) {
    let tags2 = spec[prop];
    if (!Array.isArray(tags2))
      tags2 = [tags2];
    for (let part of prop.split(" "))
      if (part) {
        let pieces = [], mode = 2, rest = part;
        for (let pos = 0; ; ) {
          if (rest == "..." && pos > 0 && pos + 3 == part.length) {
            mode = 1;
            break;
          }
          let m = /^"(?:[^"\\]|\\.)*?"|[^\/!]+/.exec(rest);
          if (!m)
            throw new RangeError("Invalid path: " + part);
          pieces.push(m[0] == "*" ? "" : m[0][0] == '"' ? JSON.parse(m[0]) : m[0]);
          pos += m[0].length;
          if (pos == part.length)
            break;
          let next = part[pos++];
          if (pos == part.length && next == "!") {
            mode = 0;
            break;
          }
          if (next != "/")
            throw new RangeError("Invalid path: " + part);
          rest = part.slice(pos);
        }
        let last = pieces.length - 1, inner = pieces[last];
        if (!inner)
          throw new RangeError("Invalid path: " + part);
        let rule = new Rule(tags2, mode, last > 0 ? pieces.slice(0, last) : null);
        byName[inner] = rule.sort(byName[inner]);
      }
  }
  return ruleNodeProp.add(byName);
}
var ruleNodeProp = new NodeProp({
  combine(a, b) {
    let cur, root, take;
    while (a || b) {
      if (!a || b && a.depth <= b.depth) {
        take = b;
        b = b.next;
      } else {
        take = a;
        a = a.next;
      }
      if (cur && cur.mode == take.mode && !take.context && !cur.context)
        continue;
      let copy = new Rule(take.tags, take.mode, take.context);
      if (cur)
        cur.next = copy;
      else
        root = copy;
      cur = copy;
    }
    return root;
  }
});
var Rule = class {
  constructor(tags2, mode, context, next) {
    this.tags = tags2;
    this.mode = mode;
    this.context = context;
    this.next = next;
  }
  get opaque() {
    return this.mode == 0;
  }
  get inherit() {
    return this.mode == 1;
  }
  sort(other) {
    if (!other || other.depth < this.depth) {
      this.next = other;
      return this;
    }
    other.next = this.sort(other.next);
    return other;
  }
  get depth() {
    return this.context ? this.context.length : 0;
  }
};
Rule.empty = new Rule([], 2, null);
function tagHighlighter(tags2, options) {
  let map = /* @__PURE__ */ Object.create(null);
  for (let style of tags2) {
    if (!Array.isArray(style.tag))
      map[style.tag.id] = style.class;
    else
      for (let tag of style.tag)
        map[tag.id] = style.class;
  }
  let { scope, all = null } = options || {};
  return {
    style: (tags3) => {
      let cls = all;
      for (let tag of tags3) {
        for (let sub of tag.set) {
          let tagClass = map[sub.id];
          if (tagClass) {
            cls = cls ? cls + " " + tagClass : tagClass;
            break;
          }
        }
      }
      return cls;
    },
    scope
  };
}
var t = Tag.define;
var comment = t();
var name = t();
var typeName = t(name);
var propertyName = t(name);
var literal = t();
var string = t(literal);
var number = t(literal);
var content = t();
var heading = t(content);
var keyword = t();
var operator = t();
var punctuation = t();
var bracket = t(punctuation);
var meta = t();
var tags = {
  /**
  A comment.
  */
  comment,
  /**
  A line [comment](#highlight.tags.comment).
  */
  lineComment: t(comment),
  /**
  A block [comment](#highlight.tags.comment).
  */
  blockComment: t(comment),
  /**
  A documentation [comment](#highlight.tags.comment).
  */
  docComment: t(comment),
  /**
  Any kind of identifier.
  */
  name,
  /**
  The [name](#highlight.tags.name) of a variable.
  */
  variableName: t(name),
  /**
  A type [name](#highlight.tags.name).
  */
  typeName,
  /**
  A tag name (subtag of [`typeName`](#highlight.tags.typeName)).
  */
  tagName: t(typeName),
  /**
  A property or field [name](#highlight.tags.name).
  */
  propertyName,
  /**
  An attribute name (subtag of [`propertyName`](#highlight.tags.propertyName)).
  */
  attributeName: t(propertyName),
  /**
  The [name](#highlight.tags.name) of a class.
  */
  className: t(name),
  /**
  A label [name](#highlight.tags.name).
  */
  labelName: t(name),
  /**
  A namespace [name](#highlight.tags.name).
  */
  namespace: t(name),
  /**
  The [name](#highlight.tags.name) of a macro.
  */
  macroName: t(name),
  /**
  A literal value.
  */
  literal,
  /**
  A string [literal](#highlight.tags.literal).
  */
  string,
  /**
  A documentation [string](#highlight.tags.string).
  */
  docString: t(string),
  /**
  A character literal (subtag of [string](#highlight.tags.string)).
  */
  character: t(string),
  /**
  An attribute value (subtag of [string](#highlight.tags.string)).
  */
  attributeValue: t(string),
  /**
  A number [literal](#highlight.tags.literal).
  */
  number,
  /**
  An integer [number](#highlight.tags.number) literal.
  */
  integer: t(number),
  /**
  A floating-point [number](#highlight.tags.number) literal.
  */
  float: t(number),
  /**
  A boolean [literal](#highlight.tags.literal).
  */
  bool: t(literal),
  /**
  Regular expression [literal](#highlight.tags.literal).
  */
  regexp: t(literal),
  /**
  An escape [literal](#highlight.tags.literal), for example a
  backslash escape in a string.
  */
  escape: t(literal),
  /**
  A color [literal](#highlight.tags.literal).
  */
  color: t(literal),
  /**
  A URL [literal](#highlight.tags.literal).
  */
  url: t(literal),
  /**
  A language keyword.
  */
  keyword,
  /**
  The [keyword](#highlight.tags.keyword) for the self or this
  object.
  */
  self: t(keyword),
  /**
  The [keyword](#highlight.tags.keyword) for null.
  */
  null: t(keyword),
  /**
  A [keyword](#highlight.tags.keyword) denoting some atomic value.
  */
  atom: t(keyword),
  /**
  A [keyword](#highlight.tags.keyword) that represents a unit.
  */
  unit: t(keyword),
  /**
  A modifier [keyword](#highlight.tags.keyword).
  */
  modifier: t(keyword),
  /**
  A [keyword](#highlight.tags.keyword) that acts as an operator.
  */
  operatorKeyword: t(keyword),
  /**
  A control-flow related [keyword](#highlight.tags.keyword).
  */
  controlKeyword: t(keyword),
  /**
  A [keyword](#highlight.tags.keyword) that defines something.
  */
  definitionKeyword: t(keyword),
  /**
  A [keyword](#highlight.tags.keyword) related to defining or
  interfacing with modules.
  */
  moduleKeyword: t(keyword),
  /**
  An operator.
  */
  operator,
  /**
  An [operator](#highlight.tags.operator) that dereferences something.
  */
  derefOperator: t(operator),
  /**
  Arithmetic-related [operator](#highlight.tags.operator).
  */
  arithmeticOperator: t(operator),
  /**
  Logical [operator](#highlight.tags.operator).
  */
  logicOperator: t(operator),
  /**
  Bit [operator](#highlight.tags.operator).
  */
  bitwiseOperator: t(operator),
  /**
  Comparison [operator](#highlight.tags.operator).
  */
  compareOperator: t(operator),
  /**
  [Operator](#highlight.tags.operator) that updates its operand.
  */
  updateOperator: t(operator),
  /**
  [Operator](#highlight.tags.operator) that defines something.
  */
  definitionOperator: t(operator),
  /**
  Type-related [operator](#highlight.tags.operator).
  */
  typeOperator: t(operator),
  /**
  Control-flow [operator](#highlight.tags.operator).
  */
  controlOperator: t(operator),
  /**
  Program or markup punctuation.
  */
  punctuation,
  /**
  [Punctuation](#highlight.tags.punctuation) that separates
  things.
  */
  separator: t(punctuation),
  /**
  Bracket-style [punctuation](#highlight.tags.punctuation).
  */
  bracket,
  /**
  Angle [brackets](#highlight.tags.bracket) (usually `<` and `>`
  tokens).
  */
  angleBracket: t(bracket),
  /**
  Square [brackets](#highlight.tags.bracket) (usually `[` and `]`
  tokens).
  */
  squareBracket: t(bracket),
  /**
  Parentheses (usually `(` and `)` tokens). Subtag of
  [bracket](#highlight.tags.bracket).
  */
  paren: t(bracket),
  /**
  Braces (usually `{` and `}` tokens). Subtag of
  [bracket](#highlight.tags.bracket).
  */
  brace: t(bracket),
  /**
  Content, for example plain text in XML or markup documents.
  */
  content,
  /**
  [Content](#highlight.tags.content) that represents a heading.
  */
  heading,
  /**
  A level 1 [heading](#highlight.tags.heading).
  */
  heading1: t(heading),
  /**
  A level 2 [heading](#highlight.tags.heading).
  */
  heading2: t(heading),
  /**
  A level 3 [heading](#highlight.tags.heading).
  */
  heading3: t(heading),
  /**
  A level 4 [heading](#highlight.tags.heading).
  */
  heading4: t(heading),
  /**
  A level 5 [heading](#highlight.tags.heading).
  */
  heading5: t(heading),
  /**
  A level 6 [heading](#highlight.tags.heading).
  */
  heading6: t(heading),
  /**
  A prose [content](#highlight.tags.content) separator (such as a horizontal rule).
  */
  contentSeparator: t(content),
  /**
  [Content](#highlight.tags.content) that represents a list.
  */
  list: t(content),
  /**
  [Content](#highlight.tags.content) that represents a quote.
  */
  quote: t(content),
  /**
  [Content](#highlight.tags.content) that is emphasized.
  */
  emphasis: t(content),
  /**
  [Content](#highlight.tags.content) that is styled strong.
  */
  strong: t(content),
  /**
  [Content](#highlight.tags.content) that is part of a link.
  */
  link: t(content),
  /**
  [Content](#highlight.tags.content) that is styled as code or
  monospace.
  */
  monospace: t(content),
  /**
  [Content](#highlight.tags.content) that has a strike-through
  style.
  */
  strikethrough: t(content),
  /**
  Inserted text in a change-tracking format.
  */
  inserted: t(),
  /**
  Deleted text.
  */
  deleted: t(),
  /**
  Changed text.
  */
  changed: t(),
  /**
  An invalid or unsyntactic element.
  */
  invalid: t(),
  /**
  Metadata or meta-instruction.
  */
  meta,
  /**
  [Metadata](#highlight.tags.meta) that applies to the entire
  document.
  */
  documentMeta: t(meta),
  /**
  [Metadata](#highlight.tags.meta) that annotates or adds
  attributes to a given syntactic element.
  */
  annotation: t(meta),
  /**
  Processing instruction or preprocessor directive. Subtag of
  [meta](#highlight.tags.meta).
  */
  processingInstruction: t(meta),
  /**
  [Modifier](#highlight.Tag^defineModifier) that indicates that a
  given element is being defined. Expected to be used with the
  various [name](#highlight.tags.name) tags.
  */
  definition: Tag.defineModifier("definition"),
  /**
  [Modifier](#highlight.Tag^defineModifier) that indicates that
  something is constant. Mostly expected to be used with
  [variable names](#highlight.tags.variableName).
  */
  constant: Tag.defineModifier("constant"),
  /**
  [Modifier](#highlight.Tag^defineModifier) used to indicate that
  a [variable](#highlight.tags.variableName) or [property
  name](#highlight.tags.propertyName) is being called or defined
  as a function.
  */
  function: Tag.defineModifier("function"),
  /**
  [Modifier](#highlight.Tag^defineModifier) that can be applied to
  [names](#highlight.tags.name) to indicate that they belong to
  the language's standard environment.
  */
  standard: Tag.defineModifier("standard"),
  /**
  [Modifier](#highlight.Tag^defineModifier) that indicates a given
  [names](#highlight.tags.name) is local to some scope.
  */
  local: Tag.defineModifier("local"),
  /**
  A generic variant [modifier](#highlight.Tag^defineModifier) that
  can be used to tag language-specific alternative variants of
  some common tag. It is recommended for themes to define special
  forms of at least the [string](#highlight.tags.string) and
  [variable name](#highlight.tags.variableName) tags, since those
  come up a lot.
  */
  special: Tag.defineModifier("special")
};
for (let name2 in tags) {
  let val = tags[name2];
  if (val instanceof Tag)
    val.name = name2;
}
var classHighlighter = tagHighlighter([
  { tag: tags.link, class: "tok-link" },
  { tag: tags.heading, class: "tok-heading" },
  { tag: tags.emphasis, class: "tok-emphasis" },
  { tag: tags.strong, class: "tok-strong" },
  { tag: tags.keyword, class: "tok-keyword" },
  { tag: tags.atom, class: "tok-atom" },
  { tag: tags.bool, class: "tok-bool" },
  { tag: tags.url, class: "tok-url" },
  { tag: tags.labelName, class: "tok-labelName" },
  { tag: tags.inserted, class: "tok-inserted" },
  { tag: tags.deleted, class: "tok-deleted" },
  { tag: tags.literal, class: "tok-literal" },
  { tag: tags.string, class: "tok-string" },
  { tag: tags.number, class: "tok-number" },
  { tag: [tags.regexp, tags.escape, tags.special(tags.string)], class: "tok-string2" },
  { tag: tags.variableName, class: "tok-variableName" },
  { tag: tags.local(tags.variableName), class: "tok-variableName tok-local" },
  { tag: tags.definition(tags.variableName), class: "tok-variableName tok-definition" },
  { tag: tags.special(tags.variableName), class: "tok-variableName2" },
  { tag: tags.definition(tags.propertyName), class: "tok-propertyName tok-definition" },
  { tag: tags.typeName, class: "tok-typeName" },
  { tag: tags.namespace, class: "tok-namespace" },
  { tag: tags.className, class: "tok-className" },
  { tag: tags.macroName, class: "tok-macroName" },
  { tag: tags.propertyName, class: "tok-propertyName" },
  { tag: tags.operator, class: "tok-operator" },
  { tag: tags.comment, class: "tok-comment" },
  { tag: tags.meta, class: "tok-meta" },
  { tag: tags.invalid, class: "tok-invalid" },
  { tag: tags.punctuation, class: "tok-punctuation" }
]);

// node_modules/style-mod/src/style-mod.js
var C = "\u037C";
var COUNT = typeof Symbol == "undefined" ? "__" + C : Symbol.for(C);
var SET = typeof Symbol == "undefined" ? "__styleSet" + Math.floor(Math.random() * 1e8) : Symbol("styleSet");
var top = typeof globalThis != "undefined" ? globalThis : typeof window != "undefined" ? window : {};
var StyleModule = class {
  // :: (Object<Style>, ?{finish: ?(string) → string})
  // Create a style module from the given spec.
  //
  // When `finish` is given, it is called on regular (non-`@`)
  // selectors (after `&` expansion) to compute the final selector.
  constructor(spec, options) {
    this.rules = [];
    let { finish } = options || {};
    function splitSelector(selector) {
      return /^@/.test(selector) ? [selector] : selector.split(/,\s*/);
    }
    function render(selectors, spec2, target, isKeyframes) {
      let local = [], isAt = /^@(\w+)\b/.exec(selectors[0]), keyframes = isAt && isAt[1] == "keyframes";
      if (isAt && spec2 == null) return target.push(selectors[0] + ";");
      for (let prop in spec2) {
        let value = spec2[prop];
        if (/&/.test(prop)) {
          render(
            prop.split(/,\s*/).map((part) => selectors.map((sel) => part.replace(/&/, sel))).reduce((a, b) => a.concat(b)),
            value,
            target
          );
        } else if (value && typeof value == "object") {
          if (!isAt) throw new RangeError("The value of a property (" + prop + ") should be a primitive value.");
          render(splitSelector(prop), value, local, keyframes);
        } else if (value != null) {
          local.push(prop.replace(/_.*/, "").replace(/[A-Z]/g, (l) => "-" + l.toLowerCase()) + ": " + value + ";");
        }
      }
      if (local.length || keyframes) {
        target.push((finish && !isAt && !isKeyframes ? selectors.map(finish) : selectors).join(", ") + " {" + local.join(" ") + "}");
      }
    }
    for (let prop in spec) render(splitSelector(prop), spec[prop], this.rules);
  }
  // :: () → string
  // Returns a string containing the module's CSS rules.
  getRules() {
    return this.rules.join("\n");
  }
  // :: () → string
  // Generate a new unique CSS class name.
  static newName() {
    let id = top[COUNT] || 1;
    top[COUNT] = id + 1;
    return C + id.toString(36);
  }
  // :: (union<Document, ShadowRoot>, union<[StyleModule], StyleModule>, ?{nonce: ?string})
  //
  // Mount the given set of modules in the given DOM root, which ensures
  // that the CSS rules defined by the module are available in that
  // context.
  //
  // Rules are only added to the document once per root.
  //
  // Rule order will follow the order of the modules, so that rules from
  // modules later in the array take precedence of those from earlier
  // modules. If you call this function multiple times for the same root
  // in a way that changes the order of already mounted modules, the old
  // order will be changed.
  //
  // If a Content Security Policy nonce is provided, it is added to
  // the `<style>` tag generated by the library.
  static mount(root, modules, options) {
    let set = root[SET], nonce = options && options.nonce;
    if (!set) set = new StyleSet(root, nonce);
    else if (nonce) set.setNonce(nonce);
    set.mount(Array.isArray(modules) ? modules : [modules], root);
  }
};
var adoptedSet = /* @__PURE__ */ new Map();
var StyleSet = class {
  constructor(root, nonce) {
    let doc = root.ownerDocument || root, win = doc.defaultView;
    if (!root.head && root.adoptedStyleSheets && win.CSSStyleSheet) {
      let adopted = adoptedSet.get(doc);
      if (adopted) return root[SET] = adopted;
      this.sheet = new win.CSSStyleSheet();
      adoptedSet.set(doc, this);
    } else {
      this.styleTag = doc.createElement("style");
      if (nonce) this.styleTag.setAttribute("nonce", nonce);
    }
    this.modules = [];
    root[SET] = this;
  }
  mount(modules, root) {
    let sheet = this.sheet;
    let pos = 0, j = 0;
    let changed = false;
    for (let i = 0; i < modules.length; i++) {
      let mod = modules[i], index = this.modules.indexOf(mod);
      if (index < j && index > -1) {
        this.modules.splice(index, 1);
        changed = true;
        j--;
        index = -1;
      }
      if (index == -1) {
        this.modules.splice(j++, 0, mod);
        changed = true;
        if (sheet) for (let k = 0; k < mod.rules.length; k++)
          sheet.insertRule(mod.rules[k], pos++);
      } else {
        while (j < index) pos += this.modules[j++].rules.length;
        pos += mod.rules.length;
        j++;
      }
    }
    if (sheet) {
      if (root.adoptedStyleSheets.indexOf(this.sheet) < 0)
        root.adoptedStyleSheets = [this.sheet, ...root.adoptedStyleSheets];
    } else {
      if (changed) {
        let text = "";
        for (let i = 0; i < this.modules.length; i++)
          text += this.modules[i].getRules() + "\n";
        this.styleTag.textContent = text;
      }
      let target = root.head || root;
      if (this.styleTag.parentNode != target)
        target.insertBefore(this.styleTag, target.firstChild);
    }
  }
  setNonce(nonce) {
    if (this.styleTag && this.styleTag.getAttribute("nonce") != nonce)
      this.styleTag.setAttribute("nonce", nonce);
  }
};

// node_modules/@codemirror/language/dist/index.js
var _a;
var languageDataProp = /* @__PURE__ */ new NodeProp();
var sublanguageProp = /* @__PURE__ */ new NodeProp();
var Language = class {
  /**
  Construct a language object. If you need to invoke this
  directly, first define a data facet with
  [`defineLanguageFacet`](https://codemirror.net/6/docs/ref/#language.defineLanguageFacet), and then
  configure your parser to [attach](https://codemirror.net/6/docs/ref/#language.languageDataProp) it
  to the language's outer syntax node.
  */
  constructor(data, parser, extraExtensions = [], name2 = "") {
    this.data = data;
    this.name = name2;
    if (!import_state.EditorState.prototype.hasOwnProperty("tree"))
      Object.defineProperty(import_state.EditorState.prototype, "tree", { get() {
        return syntaxTree(this);
      } });
    this.parser = parser;
    this.extension = [
      language.of(this),
      import_state.EditorState.languageData.of((state, pos, side) => {
        let top2 = topNodeAt(state, pos, side), data2 = top2.type.prop(languageDataProp);
        if (!data2)
          return [];
        let base = state.facet(data2), sub = top2.type.prop(sublanguageProp);
        if (sub) {
          let innerNode = top2.resolve(pos - top2.from, side);
          for (let sublang of sub)
            if (sublang.test(innerNode, state)) {
              let data3 = state.facet(sublang.facet);
              return sublang.type == "replace" ? data3 : data3.concat(base);
            }
        }
        return base;
      })
    ].concat(extraExtensions);
  }
  /**
  Query whether this language is active at the given position.
  */
  isActiveAt(state, pos, side = -1) {
    return topNodeAt(state, pos, side).type.prop(languageDataProp) == this.data;
  }
  /**
  Find the document regions that were parsed using this language.
  The returned regions will _include_ any nested languages rooted
  in this language, when those exist.
  */
  findRegions(state) {
    let lang = state.facet(language);
    if ((lang === null || lang === void 0 ? void 0 : lang.data) == this.data)
      return [{ from: 0, to: state.doc.length }];
    if (!lang || !lang.allowsNesting)
      return [];
    let result = [];
    let explore = (tree, from) => {
      if (tree.prop(languageDataProp) == this.data) {
        result.push({ from, to: from + tree.length });
        return;
      }
      let mount = tree.prop(NodeProp.mounted);
      if (mount) {
        if (mount.tree.prop(languageDataProp) == this.data) {
          if (mount.overlay)
            for (let r of mount.overlay)
              result.push({ from: r.from + from, to: r.to + from });
          else
            result.push({ from, to: from + tree.length });
          return;
        } else if (mount.overlay) {
          let size = result.length;
          explore(mount.tree, mount.overlay[0].from + from);
          if (result.length > size)
            return;
        }
      }
      for (let i = 0; i < tree.children.length; i++) {
        let ch = tree.children[i];
        if (ch instanceof Tree)
          explore(ch, tree.positions[i] + from);
      }
    };
    explore(syntaxTree(state), 0);
    return result;
  }
  /**
  Indicates whether this language allows nested languages. The
  default implementation returns true.
  */
  get allowsNesting() {
    return true;
  }
};
Language.setState = /* @__PURE__ */ import_state.StateEffect.define();
function topNodeAt(state, pos, side) {
  let topLang = state.facet(language), tree = syntaxTree(state).topNode;
  if (!topLang || topLang.allowsNesting) {
    for (let node2 = tree; node2; node2 = node2.enter(pos, side, IterMode.ExcludeBuffers | IterMode.EnterBracketed))
      if (node2.type.isTop)
        tree = node2;
  }
  return tree;
}
function syntaxTree(state) {
  let field = state.field(Language.state, false);
  return field ? field.tree : Tree.empty;
}
var DocInput = class {
  /**
  Create an input object for the given document.
  */
  constructor(doc) {
    this.doc = doc;
    this.cursorPos = 0;
    this.string = "";
    this.cursor = doc.iter();
  }
  get length() {
    return this.doc.length;
  }
  syncTo(pos) {
    this.string = this.cursor.next(pos - this.cursorPos).value;
    this.cursorPos = pos + this.string.length;
    return this.cursorPos - this.string.length;
  }
  chunk(pos) {
    this.syncTo(pos);
    return this.string;
  }
  get lineChunks() {
    return true;
  }
  read(from, to) {
    let stringStart = this.cursorPos - this.string.length;
    if (from < stringStart || to >= this.cursorPos)
      return this.doc.sliceString(from, to);
    else
      return this.string.slice(from - stringStart, to - stringStart);
  }
};
var currentContext = null;
var ParseContext = class _ParseContext {
  constructor(parser, state, fragments = [], tree, treeLen, viewport, skipped, scheduleOn) {
    this.parser = parser;
    this.state = state;
    this.fragments = fragments;
    this.tree = tree;
    this.treeLen = treeLen;
    this.viewport = viewport;
    this.skipped = skipped;
    this.scheduleOn = scheduleOn;
    this.parse = null;
    this.tempSkipped = [];
  }
  /**
  @internal
  */
  static create(parser, state, viewport) {
    return new _ParseContext(parser, state, [], Tree.empty, 0, viewport, [], null);
  }
  startParse() {
    return this.parser.startParse(new DocInput(this.state.doc), this.fragments);
  }
  /**
  @internal
  */
  work(until, upto) {
    if (upto != null && upto >= this.state.doc.length)
      upto = void 0;
    if (this.tree != Tree.empty && this.isDone(upto !== null && upto !== void 0 ? upto : this.state.doc.length)) {
      this.takeTree();
      return true;
    }
    return this.withContext(() => {
      var _a2;
      if (typeof until == "number") {
        let endTime = Date.now() + until;
        until = () => Date.now() > endTime;
      }
      if (!this.parse)
        this.parse = this.startParse();
      if (upto != null && (this.parse.stoppedAt == null || this.parse.stoppedAt > upto) && upto < this.state.doc.length)
        this.parse.stopAt(upto);
      for (; ; ) {
        let done = this.parse.advance();
        if (done) {
          this.fragments = this.withoutTempSkipped(TreeFragment.addTree(done, this.fragments, this.parse.stoppedAt != null));
          this.treeLen = (_a2 = this.parse.stoppedAt) !== null && _a2 !== void 0 ? _a2 : this.state.doc.length;
          this.tree = done;
          this.parse = null;
          if (this.treeLen < (upto !== null && upto !== void 0 ? upto : this.state.doc.length))
            this.parse = this.startParse();
          else
            return true;
        }
        if (until())
          return false;
      }
    });
  }
  /**
  @internal
  */
  takeTree() {
    let pos, tree;
    if (this.parse && (pos = this.parse.parsedPos) >= this.treeLen) {
      if (this.parse.stoppedAt == null || this.parse.stoppedAt > pos)
        this.parse.stopAt(pos);
      this.withContext(() => {
        while (!(tree = this.parse.advance())) {
        }
      });
      this.treeLen = pos;
      this.tree = tree;
      this.fragments = this.withoutTempSkipped(TreeFragment.addTree(this.tree, this.fragments, true));
      this.parse = null;
    }
  }
  withContext(f) {
    let prev = currentContext;
    currentContext = this;
    try {
      return f();
    } finally {
      currentContext = prev;
    }
  }
  withoutTempSkipped(fragments) {
    for (let r; r = this.tempSkipped.pop(); )
      fragments = cutFragments(fragments, r.from, r.to);
    return fragments;
  }
  /**
  @internal
  */
  changes(changes, newState) {
    let { fragments, tree, treeLen, viewport, skipped } = this;
    this.takeTree();
    if (!changes.empty) {
      let ranges = [];
      changes.iterChangedRanges((fromA, toA, fromB, toB) => ranges.push({ fromA, toA, fromB, toB }));
      fragments = TreeFragment.applyChanges(fragments, ranges);
      tree = Tree.empty;
      treeLen = 0;
      viewport = { from: changes.mapPos(viewport.from, -1), to: changes.mapPos(viewport.to, 1) };
      if (this.skipped.length) {
        skipped = [];
        for (let r of this.skipped) {
          let from = changes.mapPos(r.from, 1), to = changes.mapPos(r.to, -1);
          if (from < to)
            skipped.push({ from, to });
        }
      }
    }
    return new _ParseContext(this.parser, newState, fragments, tree, treeLen, viewport, skipped, this.scheduleOn);
  }
  /**
  @internal
  */
  updateViewport(viewport) {
    if (this.viewport.from == viewport.from && this.viewport.to == viewport.to)
      return false;
    this.viewport = viewport;
    let startLen = this.skipped.length;
    for (let i = 0; i < this.skipped.length; i++) {
      let { from, to } = this.skipped[i];
      if (from < viewport.to && to > viewport.from) {
        this.fragments = cutFragments(this.fragments, from, to);
        this.skipped.splice(i--, 1);
      }
    }
    if (this.skipped.length >= startLen)
      return false;
    this.reset();
    return true;
  }
  /**
  @internal
  */
  reset() {
    if (this.parse) {
      this.takeTree();
      this.parse = null;
    }
  }
  /**
  Notify the parse scheduler that the given region was skipped
  because it wasn't in view, and the parse should be restarted
  when it comes into view.
  */
  skipUntilInView(from, to) {
    this.skipped.push({ from, to });
  }
  /**
  Returns a parser intended to be used as placeholder when
  asynchronously loading a nested parser. It'll skip its input and
  mark it as not-really-parsed, so that the next update will parse
  it again.

  When `until` is given, a reparse will be scheduled when that
  promise resolves.
  */
  static getSkippingParser(until) {
    return new class extends Parser {
      createParse(input, fragments, ranges) {
        let from = ranges[0].from, to = ranges[ranges.length - 1].to;
        let parser = {
          parsedPos: from,
          advance() {
            let cx = currentContext;
            if (cx) {
              for (let r of ranges)
                cx.tempSkipped.push(r);
              if (until)
                cx.scheduleOn = cx.scheduleOn ? Promise.all([cx.scheduleOn, until]) : until;
            }
            this.parsedPos = to;
            return new Tree(NodeType.none, [], [], to - from);
          },
          stoppedAt: null,
          stopAt() {
          }
        };
        return parser;
      }
    }();
  }
  /**
  @internal
  */
  isDone(upto) {
    upto = Math.min(upto, this.state.doc.length);
    let frags = this.fragments;
    return this.treeLen >= upto && frags.length && frags[0].from == 0 && frags[0].to >= upto;
  }
  /**
  Get the context for the current parse, or `null` if no editor
  parse is in progress.
  */
  static get() {
    return currentContext;
  }
};
function cutFragments(fragments, from, to) {
  return TreeFragment.applyChanges(fragments, [{ fromA: from, toA: to, fromB: from, toB: to }]);
}
var LanguageState = class _LanguageState {
  constructor(context) {
    this.context = context;
    this.tree = context.tree;
  }
  apply(tr) {
    if (!tr.docChanged && this.tree == this.context.tree)
      return this;
    let newCx = this.context.changes(tr.changes, tr.state);
    let upto = this.context.treeLen == tr.startState.doc.length ? void 0 : Math.max(tr.changes.mapPos(this.context.treeLen), newCx.viewport.to);
    if (!newCx.work(20, upto))
      newCx.takeTree();
    return new _LanguageState(newCx);
  }
  static init(state) {
    let vpTo = Math.min(3e3, state.doc.length);
    let parseState = ParseContext.create(state.facet(language).parser, state, { from: 0, to: vpTo });
    if (!parseState.work(20, vpTo))
      parseState.takeTree();
    return new _LanguageState(parseState);
  }
};
Language.state = /* @__PURE__ */ import_state.StateField.define({
  create: LanguageState.init,
  update(value, tr) {
    for (let e of tr.effects)
      if (e.is(Language.setState))
        return e.value;
    if (tr.startState.facet(language) != tr.state.facet(language))
      return LanguageState.init(tr.state);
    return value.apply(tr);
  }
});
var requestIdle = (callback) => {
  let timeout = setTimeout(
    () => callback(),
    500
    /* Work.MaxPause */
  );
  return () => clearTimeout(timeout);
};
if (typeof requestIdleCallback != "undefined")
  requestIdle = (callback) => {
    let idle = -1, timeout = setTimeout(
      () => {
        idle = requestIdleCallback(callback, {
          timeout: 500 - 100
          /* Work.MinPause */
        });
      },
      100
      /* Work.MinPause */
    );
    return () => idle < 0 ? clearTimeout(timeout) : cancelIdleCallback(idle);
  };
var isInputPending = typeof navigator != "undefined" && ((_a = navigator.scheduling) === null || _a === void 0 ? void 0 : _a.isInputPending) ? () => navigator.scheduling.isInputPending() : null;
var parseWorker = /* @__PURE__ */ import_view2.ViewPlugin.fromClass(class ParseWorker {
  constructor(view) {
    this.view = view;
    this.working = null;
    this.workScheduled = 0;
    this.chunkEnd = -1;
    this.chunkBudget = -1;
    this.work = this.work.bind(this);
    this.scheduleWork();
  }
  update(update) {
    let cx = this.view.state.field(Language.state).context;
    if (cx.updateViewport(update.view.viewport) || this.view.viewport.to > cx.treeLen)
      this.scheduleWork();
    if (update.docChanged || update.selectionSet) {
      if (this.view.hasFocus)
        this.chunkBudget += 50;
      this.scheduleWork();
    }
    this.checkAsyncSchedule(cx);
  }
  scheduleWork() {
    if (this.working)
      return;
    let { state } = this.view, field = state.field(Language.state);
    if (field.tree != field.context.tree || !field.context.isDone(state.doc.length))
      this.working = requestIdle(this.work);
  }
  work(deadline) {
    this.working = null;
    let now = Date.now();
    if (this.chunkEnd < now && (this.chunkEnd < 0 || this.view.hasFocus)) {
      this.chunkEnd = now + 3e4;
      this.chunkBudget = 3e3;
    }
    if (this.chunkBudget <= 0)
      return;
    let { state, viewport: { to: vpTo } } = this.view, field = state.field(Language.state);
    if (field.tree == field.context.tree && field.context.isDone(
      vpTo + 1e5
      /* Work.MaxParseAhead */
    ))
      return;
    let endTime = Date.now() + Math.min(this.chunkBudget, 100, deadline && !isInputPending ? Math.max(25, deadline.timeRemaining() - 5) : 1e9);
    let viewportFirst = field.context.treeLen < vpTo && state.doc.length > vpTo + 1e3;
    let done = field.context.work(() => {
      return isInputPending && isInputPending() || Date.now() > endTime;
    }, vpTo + (viewportFirst ? 0 : 1e5));
    this.chunkBudget -= Date.now() - now;
    if (done || this.chunkBudget <= 0) {
      field.context.takeTree();
      this.view.dispatch({ effects: Language.setState.of(new LanguageState(field.context)) });
    }
    if (this.chunkBudget > 0 && !(done && !viewportFirst))
      this.scheduleWork();
    this.checkAsyncSchedule(field.context);
  }
  checkAsyncSchedule(cx) {
    if (cx.scheduleOn) {
      this.workScheduled++;
      cx.scheduleOn.then(() => this.scheduleWork()).catch((err) => (0, import_view2.logException)(this.view.state, err)).then(() => this.workScheduled--);
      cx.scheduleOn = null;
    }
  }
  destroy() {
    if (this.working)
      this.working();
  }
  isWorking() {
    return !!(this.working || this.workScheduled > 0);
  }
}, {
  eventHandlers: { focus() {
    this.scheduleWork();
  } }
});
var language = /* @__PURE__ */ import_state.Facet.define({
  combine(languages) {
    return languages.length ? languages[0] : null;
  },
  enables: (language2) => [
    Language.state,
    parseWorker,
    import_view2.EditorView.contentAttributes.compute([language2], (state) => {
      let lang = state.facet(language2);
      return lang && lang.name ? { "data-language": lang.name } : {};
    })
  ]
});
function mapRange(range, mapping) {
  let from = mapping.mapPos(range.from, 1), to = mapping.mapPos(range.to, -1);
  return from >= to ? void 0 : { from, to };
}
var foldEffect = /* @__PURE__ */ import_state.StateEffect.define({ map: mapRange });
var unfoldEffect = /* @__PURE__ */ import_state.StateEffect.define({ map: mapRange });
var foldState = /* @__PURE__ */ import_state.StateField.define({
  create() {
    return import_view2.Decoration.none;
  },
  update(folded, tr) {
    if (tr.isUserEvent("delete"))
      tr.changes.iterChangedRanges((fromA, toA) => folded = clearTouchedFolds(folded, fromA, toA));
    folded = folded.map(tr.changes);
    let rangesToFold = [];
    for (let e of tr.effects) {
      if (e.is(foldEffect) && !foldExists(folded, e.value.from, e.value.to)) {
        rangesToFold.push(e.value);
      } else if (e.is(unfoldEffect)) {
        folded = folded.update({
          filter: (from, to) => e.value.from != from || e.value.to != to,
          filterFrom: e.value.from,
          filterTo: e.value.to
        });
      }
    }
    if (rangesToFold.length) {
      let { preparePlaceholder } = tr.state.facet(foldConfig);
      let decorations = rangesToFold.map((value) => {
        let widget = !preparePlaceholder ? foldWidget : import_view2.Decoration.replace({ widget: new PreparedFoldWidget(preparePlaceholder(tr.state, value)) });
        return widget.range(value.from, value.to);
      });
      folded = folded.update({ add: decorations });
    }
    if (tr.selection)
      folded = clearTouchedFolds(folded, tr.selection.main.head);
    return folded;
  },
  provide: (f) => import_view2.EditorView.decorations.from(f),
  toJSON(folded, state) {
    let ranges = [];
    folded.between(0, state.doc.length, (from, to) => {
      ranges.push(from, to);
    });
    return ranges;
  },
  fromJSON(value) {
    if (!Array.isArray(value) || value.length % 2)
      throw new RangeError("Invalid JSON for fold state");
    let ranges = [];
    for (let i = 0; i < value.length; ) {
      let from = value[i++], to = value[i++];
      if (typeof from != "number" || typeof to != "number")
        throw new RangeError("Invalid JSON for fold state");
      ranges.push(foldWidget.range(from, to));
    }
    return import_view2.Decoration.set(ranges, true);
  }
});
function clearTouchedFolds(folded, from, to = from) {
  let touched = false;
  folded.between(from, to, (a, b) => {
    if (a < to && b > from)
      touched = true;
  });
  return !touched ? folded : folded.update({
    filterFrom: from,
    filterTo: to,
    filter: (a, b) => a >= to || b <= from
  });
}
function findFold(state, from, to) {
  var _a2;
  let found = null;
  (_a2 = state.field(foldState, false)) === null || _a2 === void 0 ? void 0 : _a2.between(from, to, (from2, to2) => {
    if (!found || found.from > from2)
      found = { from: from2, to: to2 };
  });
  return found;
}
function foldExists(folded, from, to) {
  let found = false;
  folded.between(from, from, (a, b) => {
    if (a == from && b == to)
      found = true;
  });
  return found;
}
var defaultConfig = {
  placeholderDOM: null,
  preparePlaceholder: null,
  placeholderText: "\u2026"
};
var foldConfig = /* @__PURE__ */ import_state.Facet.define({
  combine(values) {
    return (0, import_state.combineConfig)(values, defaultConfig);
  }
});
function codeFolding(config) {
  let result = [foldState, baseTheme$1];
  if (config)
    result.push(foldConfig.of(config));
  return result;
}
function widgetToDOM(view, prepared) {
  let { state } = view, conf = state.facet(foldConfig);
  let onclick = (event) => {
    let line = view.lineBlockAt(view.posAtDOM(event.target));
    let folded = findFold(view.state, line.from, line.to);
    if (folded)
      view.dispatch({ effects: unfoldEffect.of(folded) });
    event.preventDefault();
  };
  if (conf.placeholderDOM)
    return conf.placeholderDOM(view, onclick, prepared);
  let element = document.createElement("span");
  element.textContent = conf.placeholderText;
  element.setAttribute("aria-label", state.phrase("folded code"));
  element.title = state.phrase("unfold");
  element.className = "cm-foldPlaceholder";
  element.onclick = onclick;
  return element;
}
var foldWidget = /* @__PURE__ */ import_view2.Decoration.replace({ widget: /* @__PURE__ */ new class extends import_view2.WidgetType {
  toDOM(view) {
    return widgetToDOM(view, null);
  }
}() });
var PreparedFoldWidget = class extends import_view2.WidgetType {
  constructor(value) {
    super();
    this.value = value;
  }
  eq(other) {
    return this.value == other.value;
  }
  toDOM(view) {
    return widgetToDOM(view, this.value);
  }
};
var baseTheme$1 = /* @__PURE__ */ import_view2.EditorView.baseTheme({
  ".cm-foldPlaceholder": {
    backgroundColor: "#eee",
    border: "1px solid #ddd",
    color: "#888",
    borderRadius: ".2em",
    margin: "0 1px",
    padding: "0 1px",
    cursor: "pointer"
  },
  ".cm-foldGutter span": {
    padding: "0 1px",
    cursor: "pointer"
  }
});
var HighlightStyle = class _HighlightStyle {
  constructor(specs, options) {
    this.specs = specs;
    let modSpec;
    function def(spec) {
      let cls = StyleModule.newName();
      (modSpec || (modSpec = /* @__PURE__ */ Object.create(null)))["." + cls] = spec;
      return cls;
    }
    const all = typeof options.all == "string" ? options.all : options.all ? def(options.all) : void 0;
    const scopeOpt = options.scope;
    this.scope = scopeOpt instanceof Language ? (type) => type.prop(languageDataProp) == scopeOpt.data : scopeOpt ? (type) => type == scopeOpt : void 0;
    this.style = tagHighlighter(specs.map((style) => ({
      tag: style.tag,
      class: style.class || def(Object.assign({}, style, { tag: null }))
    })), {
      all
    }).style;
    this.module = modSpec ? new StyleModule(modSpec) : null;
    this.themeType = options.themeType;
  }
  /**
  Create a highlighter style that associates the given styles to
  the given tags. The specs must be objects that hold a style tag
  or array of tags in their `tag` property, and either a single
  `class` property providing a static CSS class (for highlighter
  that rely on external styling), or a
  [`style-mod`](https://code.haverbeke.berlin/marijn/style-mod#documentation)-style
  set of CSS properties (which define the styling for those tags).

  The CSS rules created for a highlighter will be emitted in the
  order of the spec's properties. That means that for elements that
  have multiple tags associated with them, styles defined further
  down in the list will have a higher CSS precedence than styles
  defined earlier.
  */
  static define(specs, options) {
    return new _HighlightStyle(specs, options || {});
  }
};
var defaultHighlightStyle = /* @__PURE__ */ HighlightStyle.define([
  {
    tag: tags.meta,
    color: "#404740"
  },
  {
    tag: tags.link,
    textDecoration: "underline"
  },
  {
    tag: tags.heading,
    textDecoration: "underline",
    fontWeight: "bold"
  },
  {
    tag: tags.emphasis,
    fontStyle: "italic"
  },
  {
    tag: tags.strong,
    fontWeight: "bold"
  },
  {
    tag: tags.strikethrough,
    textDecoration: "line-through"
  },
  {
    tag: tags.keyword,
    color: "#708"
  },
  {
    tag: [tags.atom, tags.bool, tags.url, tags.contentSeparator, tags.labelName],
    color: "#219"
  },
  {
    tag: [tags.literal, tags.inserted],
    color: "#164"
  },
  {
    tag: [tags.string, tags.deleted],
    color: "#a11"
  },
  {
    tag: [tags.regexp, tags.escape, /* @__PURE__ */ tags.special(tags.string)],
    color: "#e40"
  },
  {
    tag: /* @__PURE__ */ tags.definition(tags.variableName),
    color: "#00f"
  },
  {
    tag: /* @__PURE__ */ tags.local(tags.variableName),
    color: "#30a"
  },
  {
    tag: [tags.typeName, tags.namespace],
    color: "#085"
  },
  {
    tag: tags.className,
    color: "#167"
  },
  {
    tag: [/* @__PURE__ */ tags.special(tags.variableName), tags.macroName],
    color: "#256"
  },
  {
    tag: /* @__PURE__ */ tags.definition(tags.propertyName),
    color: "#00c"
  },
  {
    tag: tags.comment,
    color: "#940"
  },
  {
    tag: tags.invalid,
    color: "#f00"
  }
]);
var noTokens = /* @__PURE__ */ Object.create(null);
var typeArray = [NodeType.none];
var warned = [];
var byTag = /* @__PURE__ */ Object.create(null);
var defaultTable = /* @__PURE__ */ Object.create(null);
for (let [legacyName, name2] of [
  ["variable", "variableName"],
  ["variable-2", "variableName.special"],
  ["string-2", "string.special"],
  ["def", "variableName.definition"],
  ["tag", "tagName"],
  ["attribute", "attributeName"],
  ["type", "typeName"],
  ["builtin", "variableName.standard"],
  ["qualifier", "modifier"],
  ["error", "invalid"],
  ["header", "heading"],
  ["property", "propertyName"]
])
  defaultTable[legacyName] = /* @__PURE__ */ createTokenType(noTokens, name2);
function warnForPart(part, msg) {
  if (warned.indexOf(part) > -1)
    return;
  warned.push(part);
  console.warn(msg);
}
function createTokenType(extra, tagStr) {
  let tags$1 = [];
  for (let name3 of tagStr.split(" ")) {
    let found = [];
    for (let part of name3.split(".")) {
      let value = extra[part] || tags[part];
      if (!value) {
        warnForPart(part, `Unknown highlighting tag ${part}`);
      } else if (typeof value == "function") {
        if (!found.length)
          warnForPart(part, `Modifier ${part} used at start of tag`);
        else
          found = found.map(value);
      } else {
        if (found.length)
          warnForPart(part, `Tag ${part} used as modifier`);
        else
          found = Array.isArray(value) ? value : [value];
      }
    }
    for (let tag of found)
      tags$1.push(tag);
  }
  if (!tags$1.length)
    return 0;
  let name2 = tagStr.replace(/ /g, "_"), key = name2 + " " + tags$1.map((t2) => t2.id);
  let known = byTag[key];
  if (known)
    return known.id;
  let type = byTag[key] = NodeType.define({
    id: typeArray.length,
    name: name2,
    props: [styleTags({ [name2]: tags$1 })]
  });
  typeArray.push(type);
  return type.id;
}
var marks = {
  rtl: /* @__PURE__ */ import_view2.Decoration.mark({ class: "cm-iso", inclusive: true, attributes: { dir: "rtl" }, bidiIsolate: import_view2.Direction.RTL }),
  ltr: /* @__PURE__ */ import_view2.Decoration.mark({ class: "cm-iso", inclusive: true, attributes: { dir: "ltr" }, bidiIsolate: import_view2.Direction.LTR }),
  auto: /* @__PURE__ */ import_view2.Decoration.mark({ class: "cm-iso", inclusive: true, attributes: { dir: "auto" }, bidiIsolate: null })
};

// src/study-view.ts
var import_view3 = require("@codemirror/view");

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
      for (const match of materialLine[1].matchAll(/\[\[#\^([A-Za-z0-9_-]+)(?:\|[^\]]*)?\]\]/g)) materialIds.push(match[1]);
    }
    if (lines[scan].line.startsWith("> [!success]") || lines[scan].line.startsWith("> [!note]")) break;
    scan += 1;
  }
  const title = header.groups?.title ?? header[1] ?? "";
  const number2 = (title.match(/第\s*(\d+)\s*题/) || [])[1] || null;
  return {
    title: title.trim(),
    number: number2,
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
  const number2 = current.number ? `${current.number}. ` : "";
  const copied = [...materialBlocks, `${number2}${body}`].filter(Boolean).join("\n\n").trim();
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

// src/study-model.ts
var letters = ["A", "B", "C", "D"];
var emptyMarks = () => ({ A: "none", B: "none", C: "none", D: "none" });
var emptyAttempt = () => ({ important: false, wholeUncertain: false, unknown: false, uncertainOptions: [], wrongOptions: [] });
var questionKey = (path, blockId) => JSON.stringify([path, blockId]);
var groupFoldKey = (path, materialId, kind) => JSON.stringify([path, materialId, kind]);
var originalAttempt = (q) => ({ id: "original", createdAt: null, selected: q.original, answer: q.answer, marks: emptyMarks(), ...emptyAttempt() });
var asLetter = (value) => letters.includes(value) ? value : null;
function displayHeadingStart(lines, question) {
  for (let line = question.headerLine - 1; line >= 0; line -= 1) {
    const value = lines[line].trim();
    if (!value || /^<!--[\s\S]*-->$/.test(value)) continue;
    const heading2 = value.match(/^#{1,6}\s+(.+?)\s*#*$/);
    return heading2?.[1].trim() === question.title ? line : question.headerLine;
  }
  return question.headerLine;
}
function studyQuestions(source) {
  const lines = source.split("\n");
  const callouts = findCallouts(source);
  const questions = findExamQuestions(source);
  const counts = /* @__PURE__ */ new Map();
  questions.forEach((q) => {
    if (q.blockId) counts.set(q.blockId, (counts.get(q.blockId) ?? 0) + 1);
  });
  return questions.flatMap((q) => {
    if (!q.blockId || counts.get(q.blockId) !== 1) return [];
    const parts = [""];
    let index = 0;
    for (const line of q.innerLines) {
      const option = line.match(/^\s*([A-D])[.．、)）]\s*(.*)$/);
      if (option) {
        if (option[1] !== letters[index]) return [];
        index += 1;
        parts[index] = option[2];
      } else parts[index] += "\n" + line;
    }
    if (index !== 4 || parts.slice(1).some((p) => !p.trim())) return [];
    let end = q.endLine;
    while (end < lines.length && !/^#{1,6}\s|^>\s*\[!exam-question\]|^>\s*\[!exam-material\]|^\[\^[^\]]+\]:/.test(lines[end])) end += 1;
    const extras = [];
    let answer = null;
    let original = null;
    for (let line = q.endLine; line < end; line += 1) {
      if (/^(标签|关联)[：:]/.test(lines[line])) {
        const start = line;
        while (line + 1 < end && lines[line + 1].trim() && !/^>|^#|^\^/.test(lines[line + 1])) line += 1;
        extras.push({ start, end: line + 1, kind: "metadata" });
      }
    }
    for (const block of callouts.filter((c) => c.depth === 1 && c.line >= q.endLine && c.endLine <= end)) {
      const header = lines[block.line];
      if (!/^>\s*\[!(success|note)\][+-]?\s*(答案与解析|我的笔记)\s*$/.test(header)) continue;
      extras.push({ start: block.line, end: block.endLine, kind: "detail" });
      const body = lines.slice(block.line + 1, block.endLine).map((l) => l.replace(/^>\s?/, "")).join("\n");
      if (block.type === "success") answer = asLetter(body.match(/^\s*(?:参考答案|正确答案|答案)[：:]\s*([A-D])(?:\s|[。.,，；;]|$)/m)?.[1]);
      original || (original = asLetter(body.match(/^\s*(?:我的答案|我的作答)[：:]\s*([A-D])(?:\s|[。.,，；;]|$)/m)?.[1]));
    }
    return [{
      blockId: q.blockId,
      title: q.title,
      startLine: displayHeadingStart(lines, q),
      headerLine: q.headerLine,
      endLine: q.endLine,
      rangeEndLine: Math.max(q.endLine, end - 1),
      materialIds: [...q.materialIds],
      stem: parts[0].trim(),
      options: parts.slice(1).map((s) => s.trim()),
      answer,
      original,
      extras
    }];
  });
}
function studyGroups(source) {
  const lines = source.split("\n");
  const callouts = findCallouts(source);
  const allBlockIds = /* @__PURE__ */ new Map();
  lines.forEach((line) => {
    const match = line.trim().match(/^\^([A-Za-z0-9_-]+)$/);
    if (match) allBlockIds.set(match[1], (allBlockIds.get(match[1]) ?? 0) + 1);
  });
  const materials = /* @__PURE__ */ new Map();
  for (const record of callouts.filter((item) => item.depth === 1 && item.type === "exam-material")) {
    let blockLine = record.endLine;
    while (blockLine < Math.min(lines.length, record.endLine + 5) && lines[blockLine].trim() === "") blockLine += 1;
    const blockId = lines[blockLine]?.trim().match(/^\^([A-Za-z0-9_-]+)$/)?.[1];
    if (!blockId) continue;
    const title = lines[record.line].match(/^>\s*\[!exam-material\][+-]?\s*(.*)$/)?.[1]?.trim() ?? "";
    const entries = materials.get(blockId) ?? [];
    entries.push({ title, headerLine: record.line, endLine: blockLine });
    materials.set(blockId, entries);
  }
  const parsed = findExamQuestions(source);
  const supported = new Map(studyQuestions(source).map((question) => [question.headerLine, question]));
  const sequence = parsed.map((question) => {
    const valid = supported.get(question.headerLine);
    const ids = question.materialIds;
    const material = ids.length === 1 ? materials.get(ids[0]) : void 0;
    const materialId = ids.length === 1 && material?.length === 1 && (allBlockIds.get(ids[0]) ?? 0) === 1 && material[0].headerLine < question.headerLine ? ids[0] : null;
    return { raw: question, valid, materialId };
  });
  const groups = [];
  let run = [];
  const flush = () => {
    if (run.length >= 2 && run[0].materialId) {
      const first = run[0], last = run[run.length - 1], material = materials.get(first.materialId)[0];
      groups.push({ materialId: first.materialId, title: material.title, materialHeaderLine: material.headerLine, materialEndLine: material.endLine, firstQuestionLine: first.valid.startLine, lastQuestionLine: last.valid.rangeEndLine, questionBlockIds: run.map((item) => item.valid.blockId) });
    }
    run = [];
  };
  for (const item of sequence) {
    const candidate = item.valid && item.materialId;
    if (!candidate) {
      flush();
      continue;
    }
    if (run.length && run[0].materialId !== item.materialId) flush();
    run.push(item);
  }
  flush();
  return groups;
}
function readStudyData(value) {
  if (value === void 0 || value === null) return { version: 2, questions: {}, bindings: {}, groupFolds: {} };
  const data = value;
  if (data.version !== 1 && data.version !== 2 || !data.questions || typeof data.questions !== "object" || Array.isArray(data.questions)) throw new Error("\u4F5C\u7B54\u8BB0\u5F55\u683C\u5F0F\u65E0\u6CD5\u8BFB\u53D6");
  const questions = {};
  for (const [key, attempts] of Object.entries(data.questions)) {
    const identity = JSON.parse(key);
    if (!Array.isArray(identity) || identity.length !== 2 || !identity.every((v) => typeof v === "string")) throw new Error("\u9898\u76EE\u7F16\u53F7\u65E0\u6548");
    if (!Array.isArray(attempts) || !attempts.length) throw new Error("\u4F5C\u7B54\u8BB0\u5F55\u4E3A\u7A7A");
    const ids = /* @__PURE__ */ new Set();
    for (const a of attempts) {
      if (!a || typeof a.id !== "string" || ids.has(a.id) || !(a.createdAt === null || typeof a.createdAt === "string") || !(a.selected === null || letters.includes(a.selected)) || !(a.answer === null || letters.includes(a.answer)) || !a.marks || !letters.every((k) => ["none", "certain", "uncertain", "excluded"].includes(a.marks[k]))) throw new Error("\u4F5C\u7B54\u8BB0\u5F55\u635F\u574F");
      ids.add(a.id);
    }
    questions[key] = attempts.map((raw) => {
      const old = raw;
      if (data.version === 2) {
        if (typeof old.important !== "boolean" || typeof old.wholeUncertain !== "boolean" || typeof old.unknown !== "boolean" || !Array.isArray(old.uncertainOptions) || old.uncertainOptions.some((letter2) => !letters.includes(letter2))) throw new Error("\u65B0\u7248\u4F5C\u7B54\u8BB0\u5F55\u6807\u8BB0\u65E0\u6548");
      }
      if (old.wrongOptions !== void 0 && (!Array.isArray(old.wrongOptions) || old.wrongOptions.some((letter2) => !letters.includes(letter2)))) throw new Error("\u9009\u9879\u9519\u9879\u6807\u8BB0\u65E0\u6548");
      if (old.source && (typeof old.source !== "object" || typeof old.source.paperId !== "string" || typeof old.source.paperVersion !== "string" || typeof old.source.attemptId !== "string" || typeof old.source.questionId !== "string" || typeof old.source.fingerprint !== "string" || typeof old.source.note !== "string" || typeof old.source.review !== "boolean")) throw new Error("\u5BFC\u5165\u6765\u6E90\u8BB0\u5F55\u635F\u574F");
      const legacyMarks = { ...old.legacyMarks ?? {} };
      const uncertainOptions = data.version === 2 ? [...new Set(old.uncertainOptions)] : letters.filter((letter2) => old.marks[letter2] === "uncertain");
      if (data.version === 1) {
        for (const letter2 of letters) if (old.marks[letter2] === "certain" || old.marks[letter2] === "excluded") legacyMarks[letter2] = old.marks[letter2];
      }
      const source = old.source ? { ...old.source, revision: Number.isInteger(old.source.revision) && old.source.revision > 0 ? old.source.revision : 1, result: typeof old.source.result === "string" ? old.source.result : "" } : void 0;
      return { ...old, ...emptyAttempt(), important: data.version === 2 ? old.important : false, wholeUncertain: data.version === 2 ? old.wholeUncertain : false, unknown: data.version === 2 ? old.unknown : false, uncertainOptions, wrongOptions: old.wrongOptions ? [...new Set(old.wrongOptions)] : [], ...source ? { source } : {}, ...Object.keys(legacyMarks).length ? { legacyMarks } : {} };
    });
  }
  const bindings = data.version === 2 && data.bindings ? data.bindings : {};
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings) || Object.values(bindings).some((binding) => !binding || typeof binding.path !== "string" || typeof binding.blockId !== "string")) throw new Error("\u5BFC\u5165\u9898\u76EE\u7ED1\u5B9A\u683C\u5F0F\u65E0\u6CD5\u8BFB\u53D6");
  const groupFolds = data.version === 2 && data.groupFolds ? data.groupFolds : {};
  if (!groupFolds || typeof groupFolds !== "object" || Array.isArray(groupFolds) || Object.entries(groupFolds).some(([key, value2]) => {
    let identity;
    try {
      identity = JSON.parse(key);
    } catch {
      return true;
    }
    return !Array.isArray(identity) || identity.length !== 3 || !identity.every((part) => typeof part === "string") || identity[2] !== "group" && identity[2] !== "material" || typeof value2 !== "boolean";
  })) throw new Error("\u9898\u7EC4\u6298\u53E0\u8BB0\u5F55\u683C\u5F0F\u65E0\u6CD5\u8BFB\u53D6");
  return { version: 2, questions, bindings, groupFolds };
}

// src/study-store.ts
var StudyStore = class {
  constructor(plugin, saved, sourcePath = "") {
    this.plugin = plugin;
    this.saved = saved;
    this.sourcePath = sourcePath;
    this.tail = Promise.resolve();
    this.sessions = /* @__PURE__ */ new Map();
    this.listeners = /* @__PURE__ */ new Set();
    if (Object.prototype.hasOwnProperty.call(saved, "questionTrailV2") && saved.questionTrailV2 == null) throw new Error("\u65B0\u7248\u4F5C\u7B54\u8BB0\u5F55\u4E3A\u7A7A\u503C\uFF0C\u5DF2\u505C\u6B62\u5199\u5165\u4EE5\u4FDD\u62A4\u539F\u6570\u636E");
    this.data = readStudyData(Object.prototype.hasOwnProperty.call(saved, "questionTrailV2") ? saved.questionTrailV2 : saved.questionTrail);
  }
  get sharedMaterialDefaultExpanded() {
    const settings = this.saved.questionTrailSettings;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return true;
    const value = settings.sharedMaterialDefaultExpanded;
    return typeof value === "boolean" ? value : true;
  }
  session(key) {
    if (!this.sessions.has(key)) this.sessions.set(key, { redo: false, selected: null, ...emptyAttempt(), recordId: null, busy: false });
    return this.sessions.get(key);
  }
  records(key, question) {
    return this.data.questions[key] ?? [originalAttempt(question)];
  }
  folded(path, materialId, kind) {
    return this.data.groupFolds[groupFoldKey(path, materialId, kind)] ?? false;
  }
  groupRedoActive(path, blockIds) {
    return blockIds.some((blockId) => this.session(questionKey(path, blockId)).redo);
  }
  async startGroupRedo(path, materialId, blockIds) {
    const keys = blockIds.map((blockId) => questionKey(path, blockId));
    if (keys.some((key) => this.session(key).busy)) throw new Error("\u6709\u9898\u76EE\u6B63\u5728\u4FDD\u5B58\uFF0C\u6682\u65F6\u4E0D\u80FD\u5F00\u59CB\u6574\u7EC4\u91CD\u505A");
    await this.mutate((data) => {
      data.groupFolds[groupFoldKey(path, materialId, "group")] = false;
      data.groupFolds[groupFoldKey(path, materialId, "material")] = false;
    });
    for (const key of keys) {
      const session = this.session(key);
      if (!session.redo) Object.assign(session, { redo: true, selected: null, ...emptyAttempt() });
    }
    this.emit();
  }
  exitGroupRedo(path, blockIds) {
    const keys = blockIds.map((blockId) => questionKey(path, blockId));
    if (keys.some((key) => this.session(key).busy)) throw new Error("\u6709\u9898\u76EE\u6B63\u5728\u4FDD\u5B58\uFF0C\u6682\u65F6\u4E0D\u80FD\u9000\u51FA\u6574\u7EC4\u91CD\u505A");
    for (const key of keys) this.session(key).redo = false;
    this.emit();
  }
  async toggleFold(path, materialId, kind) {
    const key = groupFoldKey(path, materialId, kind);
    await this.mutate((data) => {
      data.groupFolds[key] = !data.groupFolds[key];
    });
    this.emit();
  }
  async setSharedMaterialDefaultExpanded(expanded) {
    const task = this.tail.then(async () => {
      const current = this.saved.questionTrailSettings;
      const settings = current && typeof current === "object" && !Array.isArray(current) ? current : {};
      const saved = { ...this.saved, questionTrailSettings: { ...settings, sharedMaterialDefaultExpanded: expanded } };
      await this.plugin.saveData(saved);
      this.saved = saved;
    });
    this.tail = task.catch(() => {
    });
    await task;
    this.emit();
  }
  current(key, question) {
    const records = this.records(key, question);
    return records.find((r) => r.id === this.session(key).recordId) ?? records[records.length - 1];
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  emit() {
    this.listeners.forEach((listener) => listener());
  }
  start(key) {
    Object.assign(this.session(key), { redo: true, selected: null, ...emptyAttempt() });
    this.emit();
  }
  exit(key) {
    this.session(key).redo = false;
    this.emit();
  }
  pick(key, letter2) {
    const s = this.session(key);
    s.selected = s.selected === letter2 ? null : letter2;
    this.emit();
  }
  async toggleFlag(key, q, flag) {
    const s = this.session(key);
    if (s.redo) {
      s[flag] = !s[flag];
      this.emit();
      return;
    }
    const id = this.current(key, q).id;
    s.busy = true;
    this.emit();
    try {
      await this.mutate((data) => {
        var _a2;
        const record = ((_a2 = data.questions)[key] ?? (_a2[key] = [originalAttempt(q)])).find((item) => item.id === id);
        if (!record) throw new Error("\u4F5C\u7B54\u8BB0\u5F55\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9");
        record[flag] = !record[flag];
      });
    } finally {
      s.busy = false;
      this.emit();
    }
  }
  async toggleUncertain(key, q, letter2) {
    const s = this.session(key);
    if (s.redo) {
      s.uncertainOptions = s.uncertainOptions.includes(letter2) ? s.uncertainOptions.filter((item) => item !== letter2) : [...s.uncertainOptions, letter2];
      this.emit();
      return;
    }
    const id = this.current(key, q).id;
    s.busy = true;
    this.emit();
    try {
      await this.mutate((data) => {
        var _a2;
        const record = ((_a2 = data.questions)[key] ?? (_a2[key] = [originalAttempt(q)])).find((item) => item.id === id);
        if (!record) throw new Error("\u4F5C\u7B54\u8BB0\u5F55\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9");
        record.uncertainOptions = record.uncertainOptions.includes(letter2) ? record.uncertainOptions.filter((item) => item !== letter2) : [...record.uncertainOptions, letter2];
      });
    } finally {
      s.busy = false;
      this.emit();
    }
  }
  async toggleWrong(key, q, letter2) {
    const s = this.session(key);
    if (s.redo) {
      s.wrongOptions = s.wrongOptions.includes(letter2) ? s.wrongOptions.filter((item) => item !== letter2) : [...s.wrongOptions, letter2];
      this.emit();
      return;
    }
    const id = this.current(key, q).id;
    s.busy = true;
    this.emit();
    try {
      await this.mutate((data) => {
        var _a2;
        const record = ((_a2 = data.questions)[key] ?? (_a2[key] = [originalAttempt(q)])).find((item) => item.id === id);
        if (!record) throw new Error("\u4F5C\u7B54\u8BB0\u5F55\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9");
        record.wrongOptions = record.wrongOptions.includes(letter2) ? record.wrongOptions.filter((item) => item !== letter2) : [...record.wrongOptions, letter2];
      });
    } finally {
      s.busy = false;
      this.emit();
    }
  }
  selectRecord(key, id) {
    this.session(key).recordId = id;
    this.emit();
  }
  binding(identity) {
    return this.data.bindings[identity] ?? null;
  }
  async importBatch(exercise, sourcePath, rows) {
    const sourceIds = /* @__PURE__ */ new Set();
    const targetIds = /* @__PURE__ */ new Set();
    for (const { imported, question } of rows) {
      if (!imported.supported || !imported.questionId || !question.blockId) throw new Error("\u5BFC\u5165\u6761\u76EE\u7F3A\u5C11\u53D7\u652F\u6301\u7684\u9898\u76EE\u8EAB\u4EFD");
      if (sourceIds.has(imported.questionId)) throw new Error(`\u5BFC\u5165\u6279\u6B21\u5B58\u5728\u91CD\u590D\u6765\u6E90\u9898\u76EE\uFF1A${imported.questionId}`);
      if (targetIds.has(question.blockId)) throw new Error(`\u591A\u4E2A\u6765\u6E90\u9898\u76EE\u6307\u5411\u540C\u4E00\u76EE\u6807\u5757\uFF1A^${question.blockId}`);
      if (imported.answer !== null && !["A", "B", "C", "D"].includes(imported.answer)) throw new Error("\u5BFC\u5165\u7B54\u6848\u65E0\u6CD5\u6620\u5C04\u5230 A\u2013D");
      if (imported.uncertainOptions.some((letter2) => !["A", "B", "C", "D"].includes(letter2))) throw new Error("\u9009\u9879\u4E0D\u786E\u5B9A\u6807\u8BB0\u65E0\u6CD5\u6620\u5C04\u5230 A\u2013D");
      if (imported.wrongOptions?.some((letter2) => !["A", "B", "C", "D"].includes(letter2))) throw new Error("\u9009\u9879\u9519\u9879\u6807\u8BB0\u65E0\u6CD5\u6620\u5C04\u5230 A\u2013D");
      sourceIds.add(imported.questionId);
      targetIds.add(question.blockId);
    }
    let added = 0, skipped = 0;
    await this.mutate((data) => {
      var _a2;
      for (const { imported, question } of rows) {
        const identity = JSON.stringify([exercise.paperId, exercise.paperVersion, imported.questionId]);
        const existingBinding = data.bindings[identity];
        if (existingBinding && (existingBinding.path !== sourcePath || existingBinding.blockId !== question.blockId)) throw new Error("\u6765\u6E90\u9898\u76EE\u5DF2\u6709\u4E0D\u540C\u7684\u76EE\u6807\u7ED1\u5B9A");
        const key = questionKey(sourcePath, question.blockId);
        const uncertainOptions = [...new Set(imported.uncertainOptions)].sort((a, b) => ["A", "B", "C", "D"].indexOf(a) - ["A", "B", "C", "D"].indexOf(b));
        const syncOnly = exercise.sourceKind === "question-trail-sync";
        const records = (_a2 = data.questions)[key] ?? (_a2[key] = [originalAttempt(question)]);
        const sameSource = records.filter((record) => record.source?.paperId === exercise.paperId && record.source.paperVersion === exercise.paperVersion && record.source.attemptId === exercise.attemptId && record.source.questionId === imported.questionId);
        const latest = sameSource[sameSource.length - 1];
        const wrongOptions = [...new Set(imported.wrongOptions ?? latest?.wrongOptions ?? [])].sort((a, b) => ["A", "B", "C", "D"].indexOf(a) - ["A", "B", "C", "D"].indexOf(b));
        const fingerprint = JSON.stringify(syncOnly ? [imported.answer, uncertainOptions, wrongOptions, imported.important, imported.wholeUncertain, imported.unknown] : [imported.answer, uncertainOptions, wrongOptions, imported.important, imported.wholeUncertain, imported.unknown, imported.note, imported.review, imported.result]);
        if (latest?.source?.fingerprint === fingerprint) {
          skipped++;
          continue;
        }
        const revision = (latest?.source?.revision ?? 0) + 1;
        records.push({ id: crypto.randomUUID(), createdAt: (/* @__PURE__ */ new Date()).toISOString(), selected: imported.answer, answer: question.answer, marks: emptyMarks(), important: imported.important, wholeUncertain: imported.wholeUncertain, unknown: imported.unknown, uncertainOptions, wrongOptions, source: { paperId: exercise.paperId, paperVersion: exercise.paperVersion, attemptId: exercise.attemptId, questionId: imported.questionId, fingerprint, revision, note: syncOnly ? "" : imported.note, review: syncOnly ? false : imported.review, result: syncOnly ? "" : imported.result } });
        data.bindings[identity] = { path: sourcePath, blockId: question.blockId };
        added++;
      }
    });
    this.emit();
    return { added, skipped };
  }
  mutate(change) {
    const task = this.tail.then(async () => {
      const next = structuredClone(this.data);
      change(next);
      const saved = { ...this.saved, questionTrailV2: next };
      await this.plugin.saveData(saved);
      this.data = next;
      this.saved = saved;
    });
    this.tail = task.catch(() => {
    });
    return task;
  }
  applyRecord(key, q, record) {
    const s = this.session(key);
    s.recordId = record.id;
    s.selected = record.selected;
    s.important = record.important;
    s.wholeUncertain = record.wholeUncertain;
    s.unknown = record.unknown;
    s.uncertainOptions = [...record.uncertainOptions];
    s.wrongOptions = [...record.wrongOptions];
  }
  async submit(key, q) {
    const s = this.session(key);
    if (!s.redo || s.busy || !s.selected && !s.important && !s.wholeUncertain && !s.unknown && !s.uncertainOptions.length && !s.wrongOptions.length) return;
    const attempt = { id: crypto.randomUUID(), createdAt: (/* @__PURE__ */ new Date()).toISOString(), selected: s.selected, answer: q.answer, marks: emptyMarks(), ...emptyAttempt(), important: s.important, wholeUncertain: s.wholeUncertain, unknown: s.unknown, uncertainOptions: [...s.uncertainOptions], wrongOptions: [...s.wrongOptions] };
    s.busy = true;
    this.emit();
    try {
      await this.mutate((data) => {
        var _a2;
        ((_a2 = data.questions)[key] ?? (_a2[key] = [originalAttempt(q)])).push(attempt);
      });
      s.recordId = attempt.id;
      s.redo = false;
    } finally {
      s.busy = false;
      this.emit();
    }
  }
  async rename(oldPath, newPath) {
    const moved = (path) => path === oldPath ? newPath : path.startsWith(oldPath + "/") ? newPath + path.slice(oldPath.length) : null;
    await this.mutate((data) => {
      for (const [key, attempts] of Object.entries(data.questions)) {
        const [path, block] = JSON.parse(key);
        const target = moved(path);
        if (!target) continue;
        const nextKey = questionKey(target, block);
        const existing = data.questions[nextKey] ?? [];
        data.questions[nextKey] = [...existing, ...attempts.map((a) => existing.some((e) => e.id === a.id) ? { ...a, id: crypto.randomUUID() } : a)];
        delete data.questions[key];
      }
      for (const [identity, binding] of Object.entries(data.bindings)) {
        const target = moved(binding.path);
        if (target) data.bindings[identity] = { ...binding, path: target };
      }
      const folded = {};
      for (const [key, value] of Object.entries(data.groupFolds)) {
        const identity = JSON.parse(key);
        const target = moved(identity[0]);
        const nextKey = target ? groupFoldKey(target, identity[1], identity[2]) : key;
        if (Object.prototype.hasOwnProperty.call(folded, nextKey) && folded[nextKey] !== value) throw new Error("\u7B14\u8BB0\u91CD\u547D\u540D\u4E0E\u73B0\u6709\u9898\u7EC4\u6298\u53E0\u72B6\u6001\u51B2\u7A81");
        folded[nextKey] = value;
      }
      data.groupFolds = folded;
    });
    for (const [key, session] of [...this.sessions]) {
      const [path, block] = JSON.parse(key);
      const target = moved(path);
      if (target) {
        this.sessions.set(questionKey(target, block), session);
        this.sessions.delete(key);
      }
    }
    this.emit();
  }
};
var sharedStores = /* @__PURE__ */ new WeakMap();
async function getStudyStore(plugin) {
  let current = sharedStores.get(plugin);
  if (!current) {
    current = plugin.loadData().then((saved) => new StudyStore(plugin, saved ?? {}));
    sharedStores.set(plugin, current);
  }
  try {
    return await current;
  } catch (error) {
    sharedStores.delete(plugin);
    throw error;
  }
}

// src/study-view.ts
var StudyExtraCalloutEditor = class {
  constructor(view) {
    this.view = view;
    this.source = "";
    this.detailTypes = /* @__PURE__ */ new Map();
    this.refresh();
  }
  update(_update) {
    this.refresh();
  }
  refresh() {
    const source = this.view.state.doc.toString();
    if (source !== this.source) {
      this.source = source;
      this.detailTypes = /* @__PURE__ */ new Map();
      const lines = source.split("\n");
      for (const question of studyQuestions(source)) {
        for (const extra of question.extras) {
          if (extra.kind !== "detail") continue;
          const type = lines[extra.start]?.match(/^>\s*\[!(success|note)\]/)?.[1];
          if (type) this.detailTypes.set(extra.start, type);
        }
      }
    }
    for (const callout of Array.from(this.view.dom.querySelectorAll(".callout[data-callout]"))) {
      if (callout.closest(".qt-study-body")) continue;
      let line;
      try {
        line = this.view.state.doc.lineAt(this.view.posAtDOM(callout, 0)).number - 1;
      } catch {
        continue;
      }
      callout.classList.toggle("qt-study-extra", this.detailTypes.get(line) === callout.dataset.callout);
    }
  }
  destroy() {
    this.view.dom.querySelectorAll(".callout.qt-study-extra").forEach((callout) => callout.classList.remove("qt-study-extra"));
  }
};
function node(tag, className = "", text = "") {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}
function button(label, action) {
  const el = node("button", "qt-study-button", label);
  el.type = "button";
  el.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  });
  return el;
}
function report(error) {
  console.error("\u9898\u8FF9\uFF1A\u4F5C\u7B54\u8BB0\u5F55\u4FDD\u5B58\u5931\u8D25", error);
  new import_obsidian2.Notice("\u4F5C\u7B54\u8BB0\u5F55\u672A\u4FDD\u5B58\uFF0C\u8BF7\u91CD\u8BD5");
}
function historyLabels(records) {
  const groups = /* @__PURE__ */ new Map();
  let number2 = 0;
  return records.map((record) => {
    if (record.id === "original" && !record.selected) return { id: record.id, label: "\u672A\u4F5C\u7B54" };
    const identity = record.source ? JSON.stringify([record.source.paperId, record.source.paperVersion, record.source.attemptId, record.source.questionId]) : record.id;
    let group = groups.get(identity);
    if (!group) {
      group = { number: ++number2, revision: 0 };
      groups.set(identity, group);
    }
    const importedRevision = record.source?.revision ?? 1;
    const revision = record.source ? Math.max(group.revision + 1, importedRevision) : 1;
    group.revision = revision;
    return { id: record.id, label: `\u7B2C${group.number}\u6B21${record.source && revision > 1 ? ` \xB7 \u4FEE\u8BA2${revision - 1}` : ""}` };
  });
}
function groupRangeLabel(group, questions) {
  const numbers = group.questionBlockIds.map((id) => questions.find((question) => question.blockId === id)?.title.match(/第\s*(\d+)\s*题/)?.[1]).filter((value) => !!value);
  if (numbers.length !== group.questionBlockIds.length) return `\u5171${group.questionBlockIds.length}\u9898`;
  const values = numbers.map(Number);
  const range = values.every(Number.isInteger) && values.every((value, index) => index === 0 || value === values[index - 1] + 1) ? `\u7B2C${numbers[0]}\u2013${numbers[numbers.length - 1]}\u9898` : `\u7B2C${numbers.join("\u3001")}\u9898`;
  return `${range} \xB7 \u5171${group.questionBlockIds.length}\u9898`;
}
var pendingGroupLayouts = /* @__PURE__ */ new WeakMap();
function queueGroupLayout(plugin, path, materialId, anchor, failOpen) {
  const renderer = plugin.app.workspace.getLeavesOfType("markdown").map((item) => item.view?.previewMode?.renderer).find((candidate) => candidate?.sections.some((section) => section.el === anchor || section.el.contains(anchor)));
  if (!renderer) return;
  let state = pendingGroupLayouts.get(renderer);
  if (!state) {
    state = { raf: 0, requests: /* @__PURE__ */ new Map() };
    pendingGroupLayouts.set(renderer, state);
  }
  state.requests.set(materialId, { materialId, anchor, failOpen });
  if (state.raf) return;
  state.raf = requestAnimationFrame(() => {
    state.raf = 0;
    const requests = [...state.requests.values()];
    state.requests.clear();
    try {
      if (!renderer.previewEl.isConnected || typeof renderer.measureSection !== "function" || typeof renderer.updateVirtualDisplay !== "function") throw new Error("Obsidian \u9605\u8BFB\u89C6\u56FE\u4E0D\u652F\u6301\u9898\u7EC4\u5E03\u5C40\u534F\u8C03");
      const scrollTop = renderer.previewEl.scrollTop;
      const anchors = requests.map((request) => ({ request, top: request.anchor.getBoundingClientRect().top }));
      const affected = renderer.sections.filter((section) => section.rendered && section.el.isConnected && requests.some((request) => section.el.dataset.qtGroup === request.materialId || section.el === request.anchor || section.el.contains(request.anchor)));
      for (const section of affected) renderer.measureSection(section);
      renderer.updateVirtualDisplay(scrollTop);
      for (const section of affected) if (section.el.isConnected) renderer.measureSection(section);
      renderer.updateVirtualDisplay(scrollTop);
      const anchor2 = anchors.find((item) => item.request.anchor.isConnected);
      if (anchor2) renderer.previewEl.scrollTop += anchor2.request.anchor.getBoundingClientRect().top - anchor2.top;
    } catch (error) {
      console.error("\u9898\u8FF9\uFF1A\u9898\u7EC4\u5E03\u5C40\u66F4\u65B0\u5931\u8D25", error);
      for (const request of requests) request.failOpen();
      new import_obsidian2.Notice("\u9898\u7EC4\u6298\u53E0\u6682\u4E0D\u53EF\u7528\uFF0C\u5DF2\u6062\u590D\u663E\u793A");
    }
  });
}
function ensureGroupControls(plugin, callout, group, path, questions, store, registerCleanup) {
  const title = callout.querySelector(":scope > .callout-title");
  if (!title) return;
  callout.classList.add("qt-study-group-header");
  callout.dataset.qtMaterialId = group.materialId;
  let controls = title.querySelector(":scope > .qt-study-group-controls");
  const rangeLabel = groupRangeLabel(group, questions);
  let created = false;
  if (controls) {
    const range = controls.querySelector(".qt-study-group-range");
    if (range && range.textContent !== rangeLabel) range.textContent = rangeLabel;
  }
  if (!controls) {
    created = true;
    controls = document.createElement("div");
    controls.className = "qt-study-group-controls";
    const range = document.createElement("span");
    range.className = "qt-study-group-range";
    range.textContent = rangeLabel;
    controls.append(range);
    const redoGroup2 = button("\u6574\u7EC4\u91CD\u505A", () => {
      try {
        if (store.groupRedoActive(path, group.questionBlockIds)) store.exitGroupRedo(path, group.questionBlockIds);
        else void store.startGroupRedo(path, group.materialId, group.questionBlockIds).catch(report);
      } catch (error) {
        report(error);
      }
    });
    redoGroup2.classList.add("qt-study-group-redo");
    redoGroup2.setAttribute("aria-label", "\u6574\u7EC4\u91CD\u505A");
    redoGroup2.title = "\u8BA9\u672C\u7EC4\u6BCF\u9053\u9898\u5206\u522B\u8FDB\u5165\u91CD\u505A";
    const foldGroup2 = button("\u6536\u8D77\u9898\u7EC4", () => {
      void store.toggleFold(path, group.materialId, "group").catch(report);
    });
    foldGroup2.classList.add("qt-study-group-toggle");
    foldGroup2.setAttribute("aria-label", "\u6536\u8D77\u9898\u7EC4");
    foldGroup2.title = "\u6536\u8D77\u6216\u5C55\u5F00\u6574\u7EC4\u9898\u76EE";
    const foldMaterial2 = button("\u6536\u8D77\u6750\u6599", () => {
      void store.toggleFold(path, group.materialId, "material").catch(report);
    });
    foldMaterial2.classList.add("qt-study-material-toggle");
    foldMaterial2.setAttribute("aria-label", "\u6536\u8D77\u5171\u7528\u6750\u6599");
    foldMaterial2.title = "\u53EA\u6536\u8D77\u6216\u5C55\u5F00\u5171\u7528\u6750\u6599";
    controls.append(redoGroup2, foldGroup2, foldMaterial2);
    title.append(controls);
  }
  const foldGroup = controls.querySelector(".qt-study-group-toggle");
  const foldMaterial = controls.querySelector(".qt-study-material-toggle");
  const redoGroup = controls.querySelector(".qt-study-group-redo");
  if (!foldGroup || !foldMaterial || !redoGroup) return;
  const update = () => {
    const groupFolded = store.folded(path, group.materialId, "group");
    const materialFolded = store.folded(path, group.materialId, "material");
    const groupRedo = store.groupRedoActive(path, group.questionBlockIds);
    const layoutChanged = callout.classList.contains("qt-study-group-folded") !== groupFolded || callout.classList.contains("qt-study-material-folded") !== materialFolded;
    callout.classList.toggle("qt-study-group-folded", groupFolded);
    callout.classList.toggle("qt-study-material-folded", materialFolded);
    if (layoutChanged) queueGroupLayout(plugin, path, group.materialId, callout, () => callout.classList.remove("qt-study-group-folded", "qt-study-material-folded"));
    const redoLabel = groupRedo ? "\u9000\u51FA\u6574\u7EC4\u91CD\u505A" : "\u6574\u7EC4\u91CD\u505A";
    if (redoGroup.textContent !== redoLabel) redoGroup.textContent = redoLabel;
    redoGroup.setAttribute("aria-label", redoLabel);
    redoGroup.title = groupRedo ? "\u9000\u51FA\u6574\u7EC4\u91CD\u505A" : "\u8BA9\u672C\u7EC4\u6BCF\u9053\u9898\u5206\u522B\u8FDB\u5165\u91CD\u505A";
    const groupLabel = groupFolded ? "\u5C55\u5F00\u9898\u7EC4" : "\u6536\u8D77\u9898\u7EC4";
    if (foldGroup.textContent !== groupLabel) foldGroup.textContent = groupLabel;
    foldGroup.setAttribute("aria-label", groupLabel);
    foldGroup.title = groupLabel;
    const materialLabel = materialFolded ? "\u5C55\u5F00\u6750\u6599" : "\u6536\u8D77\u6750\u6599";
    if (foldMaterial.textContent !== materialLabel) foldMaterial.textContent = materialLabel;
    foldMaterial.setAttribute("aria-label", materialLabel);
    foldMaterial.title = materialLabel;
  };
  update();
  if (created && registerCleanup) {
    const unsubscribe = store.subscribe(update);
    registerCleanup(() => {
      unsubscribe();
      controls?.remove();
      callout.classList.remove("qt-study-group-header", "qt-study-group-folded", "qt-study-material-folded");
      delete callout.dataset.qtMaterialId;
    });
  }
}
var StudyGroupEditor = class {
  constructor(view, plugin, store) {
    this.view = view;
    this.plugin = plugin;
    this.store = store;
    this.decorations = import_view3.Decoration.none;
    this.source = "";
    this.groups = [];
    this.questions = [];
    this.applied = /* @__PURE__ */ new Map();
    this.pendingGroupControls = /* @__PURE__ */ new WeakSet();
    this.unsubscribe = null;
    this.unsubscribe = store.subscribe(() => this.refresh());
    this.refresh();
  }
  get lineDecorations() {
    return this.decorations;
  }
  update(update) {
    if (update.docChanged) this.applied = new Map([...this.applied].map(([key, range]) => [key, { from: update.changes.mapPos(range.from), to: update.changes.mapPos(range.to) }]));
    if (update.docChanged || update.viewportChanged) this.refresh();
  }
  refresh() {
    const source = this.view.state.doc.toString();
    if (source !== this.source) {
      this.source = source;
      this.groups = studyGroups(source);
      this.questions = studyQuestions(source);
    }
    const groups = this.groups;
    const questions = this.questions;
    const file = this.plugin.app.workspace.getActiveViewOfType(import_obsidian2.MarkdownView)?.file ?? this.plugin.app.workspace.getActiveFile();
    const path = file?.path ?? "";
    const livePreview = !!this.view.dom.closest(".markdown-source-view.is-live-preview");
    if (!livePreview) {
      this.decorations = import_view3.Decoration.none;
      this.syncFoldRanges([], path);
      return;
    }
    const lineDecorations = [];
    for (const group of groups) {
      if (this.store.folded(path, group.materialId, "group")) continue;
      for (let line = group.firstQuestionLine + 1; line <= group.lastQuestionLine + 1 && line <= this.view.state.doc.lines; line += 1) {
        lineDecorations.push(import_view3.Decoration.line({ class: "qt-study-group-editor-member" }).range(this.view.state.doc.line(line).from));
      }
    }
    this.decorations = import_view3.Decoration.set(lineDecorations, true);
    for (const callout of Array.from(this.view.dom.querySelectorAll(".callout[data-callout='exam-material']"))) {
      let line;
      try {
        line = this.view.state.doc.lineAt(this.view.posAtDOM(callout, 0)).number - 1;
      } catch {
        continue;
      }
      const group = groups.find((item) => item.materialHeaderLine === line);
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
    this.decorations = import_view3.Decoration.set(lineDecorations, true);
    this.syncFoldRanges(groups, path);
  }
  lineRange(startLine, endLine) {
    const doc = this.view.state.doc;
    const start = startLine + 1;
    const end = endLine + 1;
    if (start < 1 || end > doc.lines || end < start) return null;
    const from = doc.line(start).from;
    const to = doc.line(end).to;
    return to > from ? { from, to } : null;
  }
  syncFoldRanges(groups, path) {
    const desired = /* @__PURE__ */ new Map();
    for (const group of groups) {
      if (this.store.folded(path, group.materialId, "group")) {
        const range = this.lineRange(group.materialHeaderLine + 1, group.lastQuestionLine);
        if (range) desired.set(`group:${group.materialId}`, range);
      } else if (this.store.folded(path, group.materialId, "material")) {
        const range = this.lineRange(group.materialHeaderLine + 1, group.materialEndLine);
        if (range) desired.set(`material:${group.materialId}`, range);
      }
    }
    const effects = [];
    for (const [key, range] of this.applied) {
      const next = desired.get(key);
      if (!next || next.from !== range.from || next.to !== range.to) effects.push(unfoldEffect.of(range));
    }
    for (const [key, range] of desired) {
      const previous = this.applied.get(key);
      if (!previous || previous.from !== range.from || previous.to !== range.to) effects.push(foldEffect.of(range));
    }
    this.applied = desired;
    if (effects.length) queueMicrotask(() => {
      if (this.view.state.doc.toString() === this.source && this.view.dom.isConnected) this.view.dispatch({ effects });
    });
  }
  destroy() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
};
async function mountQuestion(plugin, store, callout, q, context) {
  if (callout.classList.contains("qt-study-question")) return;
  const content2 = callout.querySelector(":scope > .callout-content");
  const actions = callout.querySelector(":scope > .callout-title .exam-question-actions");
  if (!content2 || !actions) return;
  const key = questionKey(context.sourcePath, q.blockId);
  const child = new import_obsidian2.MarkdownRenderChild(callout);
  context.addChild(child);
  const references = /* @__PURE__ */ new Map();
  content2.querySelectorAll("sup.footnote-ref").forEach((ref) => {
    const id = ref.querySelector("a")?.getAttribute("data-footref");
    if (id) {
      const list = references.get(id) ?? [];
      list.push(ref);
      references.set(id, list);
    }
  });
  const renderMarkdown = async (markdown, target) => {
    const definitions = [...references.keys()].map((id) => `[^${id}]: .`).join("\n");
    await import_obsidian2.MarkdownRenderer.render(plugin.app, markdown + (definitions ? "\n\n" + definitions : ""), target, context.sourcePath, child);
    target.querySelectorAll(".footnotes").forEach((el) => el.remove());
  };
  let disposed = false;
  child.register(() => {
    disposed = true;
  });
  const body = node("div", "qt-study-body");
  const sourceFile = plugin.app.vault.getAbstractFileByPath(context.sourcePath);
  const source = sourceFile ? await plugin.app.vault.cachedRead(sourceFile) : "";
  const blockCounts = /* @__PURE__ */ new Map();
  source.split("\n").forEach((line) => {
    const id = line.trim().match(/^\^([A-Za-z0-9_-]+)$/)?.[1];
    if (id) blockCounts.set(id, (blockCounts.get(id) ?? 0) + 1);
  });
  const material = q.materialIds.length === 1 && blockCounts.get(q.materialIds[0]) === 1 ? extractBlockById(source, q.materialIds[0]) : null;
  const materialDisclosure = material ? node("details", "qt-study-question-material") : null;
  let materialDisclosureTouched = false;
  if (material && materialDisclosure) {
    const summary = node("summary", "", "\u5171\u7528\u9898\u5E72");
    materialDisclosure.open = store.sharedMaterialDefaultExpanded;
    summary.addEventListener("click", () => {
      materialDisclosureTouched = true;
    });
    const materialBody = node("div", "qt-study-question-material-body");
    materialDisclosure.append(summary, materialBody);
    body.append(materialDisclosure);
    await renderMarkdown(material.innerLines.join("\n"), materialBody);
  }
  const flags = node("div", "qt-study-flags");
  const flagButtons = /* @__PURE__ */ new Map();
  for (const [flag, symbol, label] of [["important", "\u2605", "\u91CD\u8981"], ["wholeUncertain", "\u25CB", "\u6574\u9898\u4E0D\u786E\u5B9A"], ["unknown", "?", "\u4E0D\u4F1A\u505A"]]) {
    const control = button(symbol, () => {
      if (!store.session(key).busy) void store.toggleFlag(key, q, flag).catch(report);
    });
    control.setAttribute("aria-label", label);
    control.title = label;
    control.dataset.flag = flag;
    flags.append(control);
    flagButtons.set(flag, control);
  }
  const history = node("select", "qt-study-history");
  history.setAttribute("aria-label", "\u4F5C\u7B54\u8BB0\u5F55");
  history.title = "\u9009\u62E9\u4E00\u6B21\u4F5C\u7B54\u8BB0\u5F55";
  const stem = node("div", "qt-study-stem");
  body.append(stem);
  await renderMarkdown(q.stem, stem);
  const rows = [];
  for (const [index, letter2] of letters.entries()) {
    const row = node("div", "qt-study-option");
    row.dataset.option = letter2;
    const pick = button(letter2, () => {
      if (store.session(key).redo && !store.session(key).busy) store.pick(key, letter2);
    });
    pick.classList.add("qt-study-letter");
    pick.setAttribute("aria-label", "\u9009\u62E9 " + letter2);
    const text = node("div", "qt-study-option-body");
    await renderMarkdown(q.options[index], text);
    const uncertain = button("\u4E0D\u786E\u5B9A", () => {
      if (!store.session(key).busy) void store.toggleUncertain(key, q, letter2).catch(report);
    });
    uncertain.classList.add("qt-study-uncertain");
    uncertain.setAttribute("aria-label", letter2 + " \u9009\u9879\u4E0D\u786E\u5B9A");
    const wrong = button("\u9519\u9879", () => {
      if (!store.session(key).busy) void store.toggleWrong(key, q, letter2).catch(report);
    });
    wrong.classList.add("qt-study-wrong");
    wrong.setAttribute("aria-label", letter2 + " \u9009\u9879\u9519\u9879");
    const optionControls = node("div", "qt-study-option-controls");
    optionControls.append(uncertain, wrong);
    row.append(pick, text, optionControls);
    body.append(row);
    rows.push({ row, pick, uncertain, wrong });
  }
  const bottom = node("div", "qt-study-bottom");
  const status = node("span", "qt-study-status");
  status.setAttribute("role", "status");
  const check = button("\u6838\u5BF9\u7B54\u6848", () => {
    void store.submit(key, q).catch(report);
  });
  bottom.append(status, check);
  body.append(bottom);
  if (disposed) return;
  body.querySelectorAll("sup.footnote-ref").forEach((ref) => {
    const id = ref.querySelector("a")?.getAttribute("data-footref");
    const original = id && references.get(id)?.shift();
    if (original) ref.replaceWith(original.cloneNode(true));
  });
  const privateRefs = Array.from(body.querySelectorAll("sup a[data-footref]")).filter((a) => a.getAttribute("data-footref")?.startsWith("exam-" + q.blockId + "-note-"));
  const hiddenFootnotes = /* @__PURE__ */ new Set();
  const refreshFootnotes = () => {
    const root = callout.closest(".markdown-preview-view, .markdown-embed") ?? callout.parentElement;
    for (const ref of privateRefs) {
      const target = ref.getAttribute("href")?.slice(1);
      const definition = target && root?.querySelector("[id=" + JSON.stringify(target) + "]");
      if (definition) {
        hiddenFootnotes.add(definition);
        definition.classList.toggle("qt-study-concealed", store.session(key).redo);
      }
      ref.parentElement?.classList.toggle("qt-study-concealed", store.session(key).redo);
    }
  };
  const footnoteObserver = new MutationObserver(refreshFootnotes);
  child.register(() => {
    footnoteObserver.disconnect();
    hiddenFootnotes.forEach((el) => el.classList.remove("qt-study-concealed"));
  });
  const originalNodes = Array.from(content2.childNodes);
  const title = callout.querySelector(":scope > .callout-title");
  const titleInner = title?.querySelector(":scope > .callout-title-inner");
  const originalTitleNodes = title ? Array.from(title.childNodes) : [];
  content2.replaceChildren(body);
  callout.classList.add("qt-study-question");
  if (!q.extras.length) callout.classList.add("qt-study-question-end");
  const toggle = button("\u91CD\u505A", () => {
    if (store.session(key).busy) return;
    if (store.session(key).redo) store.exit(key);
    else store.start(key);
  });
  actions.prepend(toggle);
  const toolbar = node("div", "qt-study-toolbar");
  if (titleInner) toolbar.append(titleInner);
  toolbar.append(history);
  while (actions.firstChild) toolbar.append(actions.firstChild);
  toolbar.append(flags);
  body.insertBefore(toolbar, stem);
  title?.replaceChildren();
  history.addEventListener("change", () => {
    store.selectRecord(key, history.value);
  });
  const update = () => {
    if (materialDisclosure && !materialDisclosureTouched) materialDisclosure.open = store.sharedMaterialDefaultExpanded;
    const session = store.session(key);
    const record = store.current(key, q);
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
    toggle.textContent = session.redo ? "\u9000\u51FA\u91CD\u505A" : "\u91CD\u505A";
    toggle.disabled = session.busy;
    flagButtons.forEach((control, flag) => {
      const active = session.redo ? session[flag] : record[flag];
      control.setAttribute("aria-pressed", String(active));
      control.classList.toggle("is-active", active);
      control.disabled = session.busy;
    });
    history.disabled = session.busy;
    const records = store.records(key, q);
    const labels = historyLabels(records);
    history.replaceChildren(...records.map((r, i) => {
      const option = node("option", "", labels[i].label);
      option.value = r.id;
      if (r.createdAt) option.title = [new Date(r.createdAt).toLocaleString(), r.source?.result ? `\u6279\u6539\uFF1A${r.source.result}` : "", r.source?.note || ""].filter(Boolean).join(" \xB7 ");
      return option;
    }));
    if (session.redo) {
      const completedAttemptCount = labels.reduce((max, item) => Math.max(max, Number(item.label.match(/^第(\d+)次/)?.[1] ?? 0)), 0);
      const draft = node("option", "", `\u7B2C${completedAttemptCount + 1}\u6B21 \xB7 \u4F5C\u7B54\u4E2D`);
      draft.value = "__draft";
      history.append(draft);
      history.value = draft.value;
    } else history.value = record.id;
    rows.forEach(({ row, pick, uncertain, wrong: wrongButton }, i) => {
      const letter2 = letters[i];
      const wrong = !session.redo && !!answer && selected === letter2 && letter2 !== answer;
      const correct = !session.redo && letter2 === answer;
      const unsure = uncertainOptions.includes(letter2);
      const markedWrong = wrong || wrongOptions.includes(letter2);
      row.dataset.tone = correct ? "correct" : markedWrong ? unsure ? "uncertain-wrong" : "wrong" : unsure ? "uncertain" : "none";
      row.dataset.uncertain = String(unsure);
      row.dataset.chosen = String(selected === letter2);
      row.setAttribute("aria-label", [letter2, unsure ? "\u4E0D\u786E\u5B9A" : "", wrongOptions.includes(letter2) ? "\u9519\u9879" : "", correct ? "\u6B63\u786E\u7B54\u6848" : wrong ? "\u9519\u9009" : "", selected === letter2 ? "\u5DF2\u9009" : ""].filter(Boolean).join("\uFF0C"));
      pick.disabled = !session.redo || session.busy;
      pick.setAttribute("aria-pressed", String(selected === letter2));
      uncertain.setAttribute("aria-pressed", String(unsure));
      uncertain.classList.toggle("is-active", unsure);
      uncertain.disabled = session.busy;
      wrongButton.setAttribute("aria-pressed", String(wrongOptions.includes(letter2)));
      wrongButton.classList.toggle("is-active", wrongOptions.includes(letter2));
      wrongButton.disabled = session.busy;
    });
    bottom.hidden = !session.redo;
    status.textContent = selected ? "\u5DF2\u9009 " + selected : "\u672A\u4F5C\u7B54";
    check.textContent = session.busy ? "\u4FDD\u5B58\u4E2D" : q.answer ? "\u6838\u5BF9\u7B54\u6848" : "\u4FDD\u5B58\u4F5C\u7B54";
    check.disabled = session.busy || !selected && !session.important && !session.wholeUncertain && !session.unknown && !session.uncertainOptions.length && !session.wrongOptions.length;
    footnoteObserver.disconnect();
    refreshFootnotes();
    const root = callout.closest(".markdown-preview-view, .markdown-embed");
    if (session.redo && privateRefs.length && root) footnoteObserver.observe(root, { childList: true, subtree: true });
  };
  child.register(store.subscribe(update));
  update();
  child.register(() => {
    toggle.remove();
    callout.classList.remove("qt-study-question", "qt-study-question-end");
    delete callout.dataset.qtQuestionTone;
    if (body.parentNode === content2) content2.replaceChildren(...originalNodes);
    if (title) title.replaceChildren(...originalTitleNodes);
  });
}
function spaceTags(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const text of textNodes) {
    if (text.parentElement?.closest("a, code, pre")) continue;
    text.textContent = text.textContent?.replace(/标签[：:]\s*/g, "\u6807\u7B7E\uFF1A ") ?? "";
  }
  element.querySelectorAll("a.tag").forEach((tag) => {
    if (tag.nextSibling?.nodeType === Node.TEXT_NODE) {
      const next = tag.nextSibling;
      if (!/^\s/.test(next.data)) next.data = " " + next.data;
    } else tag.after(document.createTextNode(" "));
  });
}
async function registerQuestionStudy(plugin) {
  let store;
  try {
    store = await getStudyStore(plugin);
  } catch (error) {
    console.error(error);
    new import_obsidian2.Notice("\u9898\u8FF9\uFF1A\u4F5C\u7B54\u8BB0\u5F55\u65E0\u6CD5\u8BFB\u53D6\uFF0C\u5DF2\u4FDD\u7559\u539F\u6570\u636E\uFF1B\u7B54\u9898\u529F\u80FD\u6682\u672A\u542F\u7528");
    return;
  }
  plugin.registerEditorExtension(codeFolding());
  plugin.registerEditorExtension(import_view3.ViewPlugin.fromClass(StudyExtraCalloutEditor));
  class BoundStudyGroupEditor extends StudyGroupEditor {
    constructor(view) {
      super(view, plugin, store);
    }
  }
  plugin.registerEditorExtension(import_view3.ViewPlugin.fromClass(BoundStudyGroupEditor, { decorations: (value) => value.lineDecorations }));
  let cachedSource = "";
  let cachedQuestions = [];
  let cachedGroups = [];
  plugin.registerEvent(plugin.app.vault.on("rename", (file, oldPath) => {
    void store.rename(oldPath, file.path).catch(report);
  }));
  plugin.registerMarkdownPostProcessor(async (element, context) => {
    if (element.closest(".markdown-source-view, .qt-study-body")) return;
    const section = context.getSectionInfo(element);
    if (!section) return;
    if (section.text !== cachedSource) {
      cachedSource = section.text;
      cachedQuestions = studyQuestions(section.text);
      cachedGroups = studyGroups(section.text);
    }
    const questions = cachedQuestions;
    const groups = cachedGroups;
    const callouts = [...element.matches(".callout[data-callout='exam-question']") ? [element] : [], ...Array.from(element.querySelectorAll(".callout[data-callout='exam-question']"))];
    const materialCallouts = [...element.matches(".callout[data-callout='exam-material']") ? [element] : [], ...Array.from(element.querySelectorAll(".callout[data-callout='exam-material']"))];
    for (const callout of materialCallouts) {
      const info = context.getSectionInfo(callout);
      const group = groups.find((item) => info && item.materialHeaderLine >= info.lineStart && item.materialHeaderLine <= info.lineEnd);
      if (!group || callout.querySelector(":scope > .callout-title .qt-study-group-controls")) continue;
      const child2 = new import_obsidian2.MarkdownRenderChild(callout);
      context.addChild(child2);
      ensureGroupControls(plugin, callout, group, context.sourcePath, questions, store, (cleanup) => child2.register(cleanup));
    }
    for (const callout of callouts) {
      const info = context.getSectionInfo(callout);
      const title = callout.querySelector(":scope > .callout-title > .callout-title-inner")?.textContent?.trim();
      const candidates = questions.filter((q) => info && q.headerLine >= info.lineStart && q.headerLine <= info.lineEnd && q.title === title);
      if (candidates.length === 1) await mountQuestion(plugin, store, callout, candidates[0], context);
    }
    const grouped = groups.find((group) => section.lineStart >= group.firstQuestionLine && section.lineEnd <= group.lastQuestionLine);
    if (grouped) {
      const child2 = new import_obsidian2.MarkdownRenderChild(element);
      context.addChild(child2);
      const inner = document.createElement("span");
      inner.className = "qt-study-group-content";
      const original = Array.from(element.childNodes);
      inner.append(...original);
      element.append(inner);
      const updateGroup = () => {
        const collapsed = store.folded(context.sourcePath, grouped.materialId, "group");
        const layoutChanged = element.classList.contains("qt-study-group-collapsed") !== collapsed;
        element.classList.add("qt-study-group-member");
        element.classList.toggle("qt-study-group-collapsed", collapsed);
        element.dataset.qtGroup = grouped.materialId;
        if (!layoutChanged) return;
        const root = element.closest(".markdown-preview-sizer");
        queueGroupLayout(plugin, context.sourcePath, grouped.materialId, root?.querySelector(`[data-qt-material-id="${CSS.escape(grouped.materialId)}"]`) ?? element, () => {
          root?.querySelectorAll(`.qt-study-group-member[data-qt-group="${CSS.escape(grouped.materialId)}"]`).forEach((member) => member.classList.remove("qt-study-group-collapsed"));
          root?.querySelectorAll(".qt-study-group-content").forEach((content2) => {
            content2.hidden = false;
          });
        });
      };
      child2.register(store.subscribe(updateGroup));
      updateGroup();
      child2.register(() => {
        element.classList.remove("qt-study-group-member", "qt-study-group-collapsed");
        delete element.dataset.qtGroup;
        inner.replaceWith(...Array.from(inner.childNodes));
      });
    }
    const owner = questions.find((q) => q.extras.some((extra) => section.lineStart >= extra.start && section.lineEnd < extra.end));
    if (!owner) return;
    const child = new import_obsidian2.MarkdownRenderChild(element);
    context.addChild(child);
    const key = questionKey(context.sourcePath, owner.blockId);
    const metadata = owner.extras.some((extra) => extra.kind === "metadata" && section.lineStart >= extra.start && section.lineEnd < extra.end);
    const raw = section.text.split("\n").slice(section.lineStart, section.lineEnd + 1).join("\n");
    if (metadata && /^标签[：:]\S/m.test(raw)) {
      const original = Array.from(element.childNodes);
      const normalized = node("div");
      await import_obsidian2.MarkdownRenderer.render(plugin.app, raw.replace(/^(标签[：:])(?=\S)/gm, "$1 "), normalized, context.sourcePath, child);
      element.replaceChildren(...Array.from(normalized.childNodes));
      child.register(() => {
        element.replaceChildren(...original);
      });
    }
    element.classList.add("qt-study-extra");
    spaceTags(element);
    const lastExtra = owner.extras.at(-1);
    if (lastExtra && section.lineStart >= lastExtra.start && section.lineEnd < lastExtra.end) element.classList.add("qt-study-question-end");
    const update = () => {
      element.classList.toggle("qt-study-concealed", store.session(key).redo);
    };
    child.register(store.subscribe(update));
    update();
    child.register(() => {
      element.classList.remove("qt-study-extra", "qt-study-concealed", "qt-study-question-end");
    });
  }, 20);
}

// src/study-import.ts
function validateIdentity(exercise) {
  if (!exercise.paperId || !exercise.paperVersion || !exercise.attemptId || !exercise.questions.length) throw new Error("\u4F5C\u7B54\u8BB0\u5F55\u7F3A\u5C11\u8BD5\u5377\u3001\u4F5C\u7B54\u6216\u9898\u76EE\u8EAB\u4EFD");
  const seen = /* @__PURE__ */ new Set();
  for (const question of exercise.questions) {
    if (!question.questionId) throw new Error("\u4F5C\u7B54\u8BB0\u5F55\u7F3A\u5C11 questionId");
    if (seen.has(question.questionId)) throw new Error(`\u4F5C\u7B54\u8BB0\u5F55\u5B58\u5728\u91CD\u590D questionId\uFF1A${question.questionId}`);
    seen.add(question.questionId);
  }
  return exercise;
}
var obj = (v, label) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(label + "\u683C\u5F0F\u65E0\u6548");
  return v;
};
var bool = (value, label) => {
  if (value === void 0) return false;
  if (typeof value !== "boolean") throw new Error(`${label} \u5FC5\u987B\u662F\u5E03\u5C14\u503C`);
  return value;
};
var letter = (value, labels, ids) => {
  if (value == null || value === "" || Array.isArray(value) && !value.length) return null;
  if (Array.isArray(value)) {
    if (value.length !== 1) return null;
    value = value[0];
  }
  if (typeof value !== "string") return null;
  if (letters.includes(value)) return value;
  const index = ids?.indexOf(value) ?? -1;
  const label = index >= 0 ? labels?.[index] : value;
  const match = label?.match(/^\s*([A-D])(?:[.、．)）\s]|$)/);
  return match ? match[1] : null;
};
var parseQuestion = (raw, version) => {
  const q = obj(raw, "\u9898\u76EE");
  if (q.uncertainOptions !== void 0 && !Array.isArray(q.uncertainOptions)) throw new Error("\u9009\u9879\u4E0D\u786E\u5B9A\u6807\u8BB0\u5FC5\u987B\u662F\u6570\u7EC4");
  if (q.wrongOptions !== void 0 && !Array.isArray(q.wrongOptions)) throw new Error("\u9009\u9879\u9519\u9879\u6807\u8BB0\u5FC5\u987B\u662F\u6570\u7EC4");
  const labels = Array.isArray(q.options) ? q.options.map((o) => typeof o === "string" ? o : String(o?.label ?? "")) : [];
  const ids = Array.isArray(q.optionIds) ? q.optionIds : Array.isArray(q.options) && q.options.some((o) => typeof o === "object") ? q.options.map((o) => String(o.id ?? "")) : [];
  const answer = letter(q.answer, labels, ids);
  const uncertainRaw = Array.isArray(q.uncertainOptions) ? q.uncertainOptions : [];
  const uncertainOptions = uncertainRaw.map((x) => letter(x, labels, ids)).filter((x) => x !== null);
  const wrongRaw = Array.isArray(q.wrongOptions) ? q.wrongOptions : [];
  const wrongOptions = wrongRaw.map((x) => letter(x, labels, ids)).filter((x) => x !== null);
  const type = String(q.type ?? "");
  const supported = type === "single" && labels.length === 4 && labels.every((v, i) => v.startsWith(letters[i]));
  const unmappedUncertain = uncertainRaw.some((value) => letter(value, labels, ids) === null);
  const unmappedWrong = wrongRaw.some((value) => letter(value, labels, ids) === null);
  const valid = supported && !unmappedUncertain && !unmappedWrong && (answer !== null || q.answer == null || q.answer === "");
  return { questionId: String(q.questionId ?? ""), number: String(q.number ?? q.displayNumber ?? ""), section: String(q.section ?? ""), type, answer, uncertainOptions, ...q.wrongOptions !== void 0 ? { wrongOptions } : {}, important: bool(q.important, "important"), wholeUncertain: bool(q.wholeUncertain, "wholeUncertain"), unknown: bool(q.unknown, "unknown"), note: String(q.note ?? ""), review: q.review === true, result: String(q.result ?? ""), supported: valid, ...!valid ? { reason: !supported ? "\u4EC5\u652F\u6301\u56DB\u9009\u9879\u5355\u9009\u9898" : unmappedWrong ? "\u9519\u9879\u6807\u8BB0\u65E0\u6CD5\u6620\u5C04\u5230 A\u2013D" : unmappedUncertain ? "\u4E0D\u786E\u5B9A\u9009\u9879\u65E0\u6CD5\u6620\u5C04\u5230 A\u2013D" : "\u7B54\u6848\u65E0\u6CD5\u6620\u5C04\u5230 A\u2013D" } : {} };
};
function parseAnswerCardJson(text) {
  const root = obj(JSON.parse(text.replace(/^\uFEFF/, "")), "JSON");
  if (root.type === "question-trail-sync" && root.schemaVersion === 1) {
    if (!Array.isArray(root.questions)) throw new Error("\u9898\u8FF9\u540C\u6B65\u5305\u7F3A\u5C11\u9898\u76EE");
    const questions = root.questions.map((raw) => {
      const q = obj(raw, "\u9898\u8FF9\u540C\u6B65\u9898\u76EE");
      const allowed = /* @__PURE__ */ new Set(["questionId", "number", "section", "type", "answer", "uncertainOptions", "wrongOptions", "important", "wholeUncertain", "unknown", "supported", "reason"]);
      if (Object.keys(q).some((key) => !allowed.has(key))) throw new Error("\u9898\u8FF9 Skill \u540C\u6B65\u5305\u53EA\u80FD\u5305\u542B\u7B54\u6848\u548C\u6807\u8BB0\uFF0C\u4E0D\u63A5\u53D7\u9898\u76EE\u6B63\u6587\u6216\u7B14\u8BB0\u5B57\u6BB5");
      const parsed = parseQuestion({ ...q, options: letters }, 2);
      const flagsValid = Array.isArray(q.uncertainOptions) && q.uncertainOptions.every((v) => letters.includes(v));
      const wrongFlagsValid = q.wrongOptions === void 0 || Array.isArray(q.wrongOptions) && q.wrongOptions.every((v) => letters.includes(v));
      const payloadValid = q.supported === true && q.type === "single" && flagsValid && wrongFlagsValid && (q.answer === null || letters.includes(q.answer)) && typeof q.important === "boolean" && typeof q.wholeUncertain === "boolean" && typeof q.unknown === "boolean";
      parsed.supported = payloadValid && parsed.supported;
      if (!parsed.supported) parsed.reason = String(q.reason || parsed.reason || "\u540C\u6B65\u8BB0\u5F55\u65E0\u6CD5\u660E\u786E\u6620\u5C04\u5230 A\u2013D");
      return parsed;
    });
    return validateIdentity({ schemaVersion: 1, paperId: String(root.paperId ?? ""), paperVersion: String(root.paperVersion ?? ""), attemptId: String(root.attemptId ?? ""), name: String(root.name ?? "Skill \u4F5C\u7B54\u540C\u6B65"), questions, sourceKind: "question-trail-sync" });
  }
  if (root.type !== "answer-recorder-attempt" || root.schemaVersion !== 2 && root.schemaVersion !== 3) throw new Error("\u53EA\u652F\u6301\u7B54\u9898\u5361 v2/v3 \u4F5C\u7B54 JSON");
  const ex = obj(root.exercise, "\u4F5C\u7B54\u8BB0\u5F55");
  if (!Array.isArray(ex.questions)) throw new Error("\u4F5C\u7B54\u8BB0\u5F55\u7F3A\u5C11\u9898\u76EE");
  return validateIdentity({ schemaVersion: root.schemaVersion, paperId: String(ex.paperId ?? ""), paperVersion: String(ex.paperVersion ?? ""), attemptId: String(ex.attemptId ?? ""), name: String(ex.name ?? ""), questions: ex.questions.map((q) => parseQuestion(q, root.schemaVersion)), sourceKind: "answer-card" });
}
function csvRows(text) {
  const source = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], cell = "", quoted = false, closedQuote = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closedQuote = true;
      } else cell += c;
    } else if (closedQuote && c !== "," && c !== "\n" && c !== "\r") {
      throw new Error("CSV \u95ED\u5408\u5F15\u53F7\u540E\u5B58\u5728\u591A\u4F59\u5185\u5BB9");
    } else if (c === '"') {
      if (cell) throw new Error("CSV \u5F15\u53F7\u4F4D\u7F6E\u65E0\u6548");
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
      closedQuote = false;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
      cell = "";
      closedQuote = false;
    } else cell += c;
  }
  if (quoted) throw new Error("CSV \u5F15\u53F7\u672A\u95ED\u5408");
  if (cell || row.length) {
    row.push(cell);
    if (row.some((v) => v !== "")) rows.push(row);
  }
  return rows;
}
var jsonCell = (v) => {
  if (!v) return void 0;
  try {
    return JSON.parse(v);
  } catch {
    throw new Error("CSV JSON \u6269\u5C55\u5B57\u6BB5\u65E0\u6548");
  }
};
function parseAnswerCardCsv(text) {
  const rows = csvRows(text);
  if (rows.length < 2) throw new Error("CSV \u6CA1\u6709\u4F5C\u7B54\u8BB0\u5F55");
  const headers = rows[0];
  if (new Set(headers).size !== headers.length || headers.some((v) => !v)) throw new Error("CSV \u5217\u540D\u7F3A\u5931\u6216\u91CD\u590D");
  if (rows.slice(1).some((row) => row.length !== headers.length)) throw new Error("CSV \u5B58\u5728\u5217\u6570\u4E0D\u4E00\u81F4\u7684\u884C");
  const col = (r, k) => r[headers.indexOf(k)] ?? "";
  const first = rows[1];
  const version = Number(col(first, "schema_version"));
  if (version !== 2 && version !== 3) throw new Error("\u53EA\u652F\u6301\u7B54\u9898\u5361 v2/v3 \u4F5C\u7B54 CSV");
  for (const row of rows.slice(1)) {
    if (Number(col(row, "schema_version")) !== version || col(row, "paper_id") !== col(first, "paper_id") || col(row, "paper_version") !== col(first, "paper_version") || col(row, "attempt_id") !== col(first, "attempt_id"))
      throw new Error("CSV \u4E2D\u7684\u8BD5\u5377\u3001\u7248\u672C\u3001\u4F5C\u7B54\u8EAB\u4EFD\u6216 schema_version \u4E0D\u4E00\u81F4");
  }
  const questions = rows.slice(1).map((r) => {
    const answer = version === 3 ? jsonCell(col(r, "answer_json")) ?? null : col(r, "answer") || null;
    const options = version === 3 ? jsonCell(col(r, "options_json")) ?? [] : letters;
    const csvBool = (name2) => {
      const value = col(r, name2);
      if (value === "true") return true;
      if (value === "false" || value === "") return false;
      throw new Error(`CSV \u5B57\u6BB5 ${name2} \u5FC5\u987B\u662F true/false`);
    };
    const hasWrongOptions = headers.includes(version === 3 ? "wrong_option_ids_json" : "wrong_options");
    const q = { questionId: col(r, "question_id"), number: col(r, "question_number"), section: col(r, "section"), type: col(r, "question_type"), options, optionIds: version === 3 ? options.map((o) => o.id) : [], answer, uncertainOptions: version === 3 ? jsonCell(col(r, "uncertain_option_ids_json")) ?? [] : (col(r, "uncertain_options") || "").split("|").filter(Boolean), ...hasWrongOptions ? { wrongOptions: version === 3 ? jsonCell(col(r, "wrong_option_ids_json")) ?? [] : (col(r, "wrong_options") || "").split("|").filter(Boolean) } : {}, important: csvBool("important_flag"), wholeUncertain: csvBool("whole_uncertain_flag"), unknown: csvBool("unknown_flag"), note: version === 3 ? jsonCell(col(r, "note_json")) ?? col(r, "note") : col(r, "note"), review: csvBool("review_flag") };
    const parsed = parseQuestion(q, version);
    if (version === 2) {
      parsed.supported = col(r, "question_type") === "single" && parsed.supported;
      parsed.reason = parsed.supported ? void 0 : "\u4EC5\u652F\u6301\u56DB\u9009\u9879\u5355\u9009\u9898\u6216\u9009\u9879\u6807\u8BB0\u65E0\u6CD5\u6620\u5C04";
    }
    return parsed;
  });
  return validateIdentity({ schemaVersion: version, paperId: col(first, "paper_id"), paperVersion: col(first, "paper_version"), attemptId: col(first, "attempt_id"), name: col(first, "exercise_name"), questions, sourceKind: "answer-card" });
}
function parseAnswerCardFile(text, name2) {
  return name2.toLowerCase().endsWith(".csv") ? parseAnswerCardCsv(text) : parseAnswerCardJson(text);
}

// src/main.ts
var SKILL_INBOX = ".obsidian/plugins/obsidian-exam-notes/import-inbox";
function positionToOffset(source, position) {
  const lines = source.split("\n");
  let offset = 0;
  for (let index = 0; index < position.line; index += 1) offset += (lines[index] ?? "").length + 1;
  return offset + position.ch;
}
function questionNumberFromTitle(title) {
  return (title.match(/第\s*(\d+)\s*题/) || [])[1] || null;
}
var ExamNotesPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.inboxScanRunning = false;
    this.inboxNotices = /* @__PURE__ */ new Set();
  }
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
    this.addCommand({ id: "import-answer-card-attempt", name: "\u5BFC\u5165\u7B54\u9898\u5361\u4F5C\u7B54\uFF08JSON/CSV\uFF09", callback: () => {
      const view = this.app.workspace.getActiveViewOfType(import_obsidian3.MarkdownView);
      if (!view?.file) {
        new import_obsidian3.Notice("\u8BF7\u5148\u6253\u5F00\u76EE\u6807\u8BD5\u5377\u7B14\u8BB0");
        return;
      }
      void this.importAnswerCard(view.file.path);
    } });
    this.addCommand({ id: "process-question-trail-sync", name: "\u5904\u7406\u9898\u8FF9 Skill \u540C\u6B65", callback: () => void this.processQuestionTrailInbox() });
    this.registerMarkdownPostProcessor((element, context) => {
      const callouts = [];
      if (element.matches(".callout[data-callout='exam-question']")) callouts.push(element);
      callouts.push(...Array.from(element.querySelectorAll(".callout[data-callout='exam-question']")));
      for (const callout of callouts) {
        const section = context.getSectionInfo(callout);
        this.addRenderedActions(callout, context.sourcePath, section?.lineStart);
      }
    });
    await registerQuestionStudy(this);
    this.addSettingTab(new ExamNotesSettingTab(this.app, this));
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file.path.startsWith(SKILL_INBOX + "/")) void this.scanQuestionTrailInbox();
    }));
    this.registerEvent(this.app.vault.on("rename", (file) => {
      if (file.path.startsWith(SKILL_INBOX + "/")) void this.scanQuestionTrailInbox();
    }));
    this.registerInterval(window.setInterval(() => void this.scanQuestionTrailInbox(), 15e3));
    this.app.workspace.onLayoutReady(() => void this.scanQuestionTrailInbox());
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
  async importAnswerCard(sourcePath, inboxPath) {
    const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(sourceFile instanceof import_obsidian3.TFile)) return;
    const source = await this.app.vault.read(sourceFile);
    const questions = studyQuestions(source);
    if (!questions.length) {
      new import_obsidian3.Notice("\u5F53\u524D\u7B14\u8BB0\u6CA1\u6709\u53EF\u5BF9\u5E94\u7684 A\u2013D \u5355\u9009\u9898");
      return;
    }
    const store = await getStudyStore(this);
    const modal = new import_obsidian3.Modal(this.app);
    modal.titleEl.setText("\u5BFC\u5165\u7B54\u9898\u5361\u4F5C\u7B54");
    const root = modal.contentEl;
    root.empty();
    const input = root.createEl("input", { attr: { type: "file", accept: ".json,.csv,application/json,text/csv" } });
    const preview = root.createDiv({ cls: "qt-import-preview" });
    const showPreview = (text, fileName) => {
      try {
        const exercise = parseAnswerCardFile(text, fileName);
        input.hidden = true;
        preview.empty();
        const kindLabel = exercise.sourceKind === "question-trail-sync" ? "\u6279\u6539 Skill \u540C\u6B65" : `\u7B54\u9898\u5361 ${exercise.schemaVersion === 2 ? "v2" : "v3"}`;
        preview.createEl("p", { text: `${exercise.name} \xB7 ${exercise.questions.length} \u9898 \xB7 ${kindLabel} \xB7 ${sourceFile.path}` });
        const rows = [];
        const identities = /* @__PURE__ */ new Set();
        for (const item of exercise.questions) {
          const identity = JSON.stringify([exercise.paperId, exercise.paperVersion, item.questionId]);
          const row = preview.createDiv({ cls: "qt-import-row" });
          const include = row.createEl("input", { attr: { type: "checkbox" } });
          include.checked = true;
          row.createEl("span", { text: `${item.number} \xB7 ${item.questionId}${item.supported ? "" : " \xB7 " + item.reason}` });
          const select = row.createEl("select");
          select.createEl("option", { text: "\u9009\u62E9\u7B14\u8BB0\u9898\u76EE", attr: { value: "" } });
          const binding = store.binding(identity);
          for (const q of questions) select.createEl("option", { text: `${q.title} \xB7 ^${q.blockId}`, attr: { value: q.blockId } });
          if (binding) {
            if (binding.path !== sourcePath) {
              row.createEl("span", { text: `\u5DF2\u6709\u7ED1\u5B9A\u5230 ${binding.path}` });
              include.checked = false;
            } else if (questions.filter((q) => q.blockId === binding.blockId).length !== 1) {
              row.createEl("span", { text: `\u7ED1\u5B9A\u9898\u5757 ^${binding.blockId} \u7F3A\u5931\u6216\u91CD\u590D` });
              include.checked = false;
            } else select.value = binding.blockId;
          }
          if (identities.has(identity)) {
            include.checked = false;
            row.createEl("span", { text: "\u91CD\u590D\u6765\u6E90\u8EAB\u4EFD" });
          }
          identities.add(identity);
          rows.push({ imported: item, select, include });
        }
        const confirm = preview.createEl("button", { text: "\u786E\u8BA4\u5BFC\u5165" });
        const status = preview.createDiv({ cls: "qt-import-status" });
        confirm.onclick = () => {
          const selected = rows.filter((r) => r.include.checked);
          if (!selected.length) {
            status.setText("\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u6761\u8BB0\u5F55");
            return;
          }
          if (selected.some((r) => !r.imported.supported || !r.imported.questionId || !r.select.value)) {
            status.setText("\u8BF7\u5148\u6392\u9664\u4E0D\u652F\u6301/\u91CD\u590D\u6761\u76EE\uFF0C\u5E76\u4E3A\u6BCF\u9898\u660E\u786E\u9009\u62E9\u76EE\u6807");
            return;
          }
          const ids = selected.map((r) => r.select.value);
          if (new Set(ids).size !== ids.length) {
            status.setText("\u591A\u4E2A\u6765\u6E90\u9898\u76EE\u4E0D\u80FD\u7ED1\u5B9A\u5230\u540C\u4E00\u4E2A\u7B14\u8BB0\u9898\u76EE");
            return;
          }
          const targets = selected.map((r) => questions.find((q) => q.blockId === r.select.value));
          void store.importBatch(exercise, sourcePath, selected.map((r, i) => ({ imported: r.imported, question: targets[i] }))).then(async (result) => {
            if (inboxPath) {
              try {
                await this.archiveInboxFile(inboxPath);
              } catch (error) {
                new import_obsidian3.Notice(`\u4F5C\u7B54\u5DF2\u5BFC\u5165\uFF0C\u4F46\u6536\u4EF6\u7BB1\u6587\u4EF6\u4ECD\u5F85\u5F52\u6863\uFF1A${String(error)}`);
              }
            }
            new import_obsidian3.Notice(`\u5BFC\u5165\u5B8C\u6210\uFF1A\u65B0\u589E ${result.added}\uFF0C\u91CD\u590D\u8DF3\u8FC7 ${result.skipped}`);
            modal.close();
          }).catch((error) => {
            console.error(error);
            status.setText("\u4FDD\u5B58\u5931\u8D25\uFF1B\u8BB0\u5F55\u672A\u5BFC\u5165\uFF0C\u8BF7\u91CD\u8BD5");
          });
        };
      } catch (error) {
        preview.empty();
        preview.createEl("p", { text: `\u65E0\u6CD5\u8BFB\u53D6\u5BFC\u5165\u6587\u4EF6\uFF1A${String(error)}` });
      }
    };
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void file.text().then((text) => showPreview(text, file.name)).catch((error) => {
        preview.empty();
        preview.createEl("p", { text: `\u65E0\u6CD5\u8BFB\u53D6\u5BFC\u5165\u6587\u4EF6\uFF1A${String(error)}` });
      });
    });
    modal.open();
    if (inboxPath) void this.app.vault.adapter.read(inboxPath).then((text) => showPreview(text, inboxPath.split("/").pop() ?? inboxPath)).catch((error) => {
      preview.setText(`\u8BFB\u53D6\u6536\u4EF6\u7BB1\u5931\u8D25\uFF1A${String(error)}`);
    });
  }
  async processQuestionTrailInbox() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian3.MarkdownView);
    if (!view?.file) {
      new import_obsidian3.Notice("\u8BF7\u5148\u6253\u5F00\u76EE\u6807\u8BD5\u5377\u7B14\u8BB0\uFF0C\u518D\u5904\u7406 Skill \u540C\u6B65");
      return;
    }
    try {
      const { files } = await this.app.vault.adapter.list(SKILL_INBOX);
      const pending = files.filter((path) => path.toLowerCase().endsWith(".json")).sort()[0];
      if (!pending) {
        new import_obsidian3.Notice("\u9898\u8FF9\u6536\u4EF6\u7BB1\u6CA1\u6709\u5F85\u5904\u7406\u540C\u6B65");
        return;
      }
      await this.importAnswerCard(view.file.path, pending);
    } catch (error) {
      new import_obsidian3.Notice(`\u8BFB\u53D6\u9898\u8FF9\u6536\u4EF6\u7BB1\u5931\u8D25\uFF1A${String(error)}`);
    }
  }
  async scanQuestionTrailInbox() {
    if (this.inboxScanRunning) return;
    this.inboxScanRunning = true;
    try {
      const { files } = await this.app.vault.adapter.list(SKILL_INBOX);
      for (const path of files.filter((file) => file.toLowerCase().endsWith(".json")).sort()) await this.autoImportBoundSync(path);
    } catch {
    } finally {
      this.inboxScanRunning = false;
    }
  }
  async autoImportBoundSync(path) {
    try {
      const exercise = parseAnswerCardFile(await this.app.vault.adapter.read(path), path);
      if (exercise.sourceKind !== "question-trail-sync") return;
      const supported = exercise.questions.filter((question) => question.supported);
      if (!supported.length || supported.length !== exercise.questions.length) {
        if (!this.inboxNotices.has(path)) {
          this.inboxNotices.add(path);
          new import_obsidian3.Notice("Skill \u540C\u6B65\u5305\u542B\u4E0D\u652F\u6301\u6216\u5F85\u6838\u5BF9\u9898\u76EE\uFF1B\u8BF7\u6267\u884C\u201C\u5904\u7406\u9898\u8FF9 Skill \u540C\u6B65\u201D\u9009\u62E9\u53EF\u5BFC\u5165\u6761\u76EE");
        }
        return;
      }
      const store = await getStudyStore(this);
      const bound = supported.map((imported) => ({ imported, binding: store.binding(JSON.stringify([exercise.paperId, exercise.paperVersion, imported.questionId])) }));
      if (bound.some((row) => !row.binding)) {
        if (!this.inboxNotices.has(path)) {
          this.inboxNotices.add(path);
          new import_obsidian3.Notice("\u6536\u5230\u65B0\u7684 Skill \u4F5C\u7B54\u540C\u6B65\uFF1B\u8BF7\u6253\u5F00\u76EE\u6807\u8BD5\u5377\u7B14\u8BB0\u5E76\u6267\u884C\u201C\u5904\u7406\u9898\u8FF9 Skill \u540C\u6B65\u201D\u5B8C\u6210\u9996\u6B21\u7ED1\u5B9A");
        }
        return;
      }
      const targetPaths = new Set(bound.map((row) => row.binding.path));
      if (targetPaths.size !== 1) {
        if (!this.inboxNotices.has(path)) {
          this.inboxNotices.add(path);
          new import_obsidian3.Notice("Skill \u540C\u6B65\u8BB0\u5F55\u7ED1\u5B9A\u5230\u4E86\u591A\u4EFD\u7B14\u8BB0\uFF0C\u8BF7\u4F7F\u7528\u201C\u5904\u7406\u9898\u8FF9 Skill \u540C\u6B65\u201D\u9010\u4EFD\u6838\u5BF9");
        }
        return;
      }
      const targetPath = [...targetPaths][0];
      const targetFile = this.app.vault.getAbstractFileByPath(targetPath);
      if (!(targetFile instanceof import_obsidian3.TFile)) {
        if (!this.inboxNotices.has(path)) {
          this.inboxNotices.add(path);
          new import_obsidian3.Notice("Skill \u540C\u6B65\u76EE\u6807\u7B14\u8BB0\u5DF2\u4E0D\u5B58\u5728\uFF1B\u8BF7\u6253\u5F00\u76EE\u6807\u8BD5\u5377\u7B14\u8BB0\u5E76\u91CD\u65B0\u6838\u5BF9\u7ED1\u5B9A");
        }
        return;
      }
      const source = await this.app.vault.read(targetFile);
      const questions = studyQuestions(source);
      const mappings = bound.map((row) => {
        const matches = questions.filter((question) => question.blockId === row.binding.blockId);
        if (matches.length !== 1) throw new Error(`\u76EE\u6807\u5757 ^${row.binding.blockId} \u7F3A\u5931\u6216\u91CD\u590D`);
        return { imported: row.imported, question: matches[0] };
      });
      const result = await store.importBatch(exercise, targetPath, mappings);
      const unsupported = exercise.questions.length - supported.length;
      let archiveNote = "";
      try {
        await this.archiveInboxFile(path);
      } catch (error) {
        archiveNote = `\uFF1B\u6536\u4EF6\u7BB1\u6587\u4EF6\u5F52\u6863\u5931\u8D25\uFF1A${String(error)}`;
      }
      new import_obsidian3.Notice(`Skill \u540C\u6B65\u5B8C\u6210\uFF1A\u65B0\u589E ${result.added} \u6761\uFF0C\u672A\u53D8\u5316 ${result.skipped} \u6761${unsupported ? `\uFF1B${unsupported} \u9053\u4E0D\u652F\u6301\u9898\u578B\u4FDD\u7559\u5728\u5F52\u6863\u6587\u4EF6\u4E2D` : ""}${archiveNote}`);
    } catch (error) {
      console.error("\u9898\u8FF9\uFF1ASkill \u540C\u6B65\u5904\u7406\u5931\u8D25", error);
      if (!this.inboxNotices.has(path)) {
        this.inboxNotices.add(path);
        new import_obsidian3.Notice(`Skill \u540C\u6B65\u672A\u5BFC\u5165\uFF0C\u539F\u6587\u4EF6\u4FDD\u7559\uFF1A${String(error)}`);
      }
    }
  }
  async archiveInboxFile(path) {
    const archive = `${SKILL_INBOX}/processed`;
    if (!await this.app.vault.adapter.exists(archive)) await this.app.vault.adapter.mkdir(archive);
    const basename = path.split("/").pop() ?? "sync.json";
    let target = `${archive}/${basename}`;
    if (await this.app.vault.adapter.exists(target)) target = `${archive}/${Date.now()}-${basename}`;
    await this.app.vault.adapter.rename(path, target);
    this.inboxNotices.delete(path);
  }
  async readFile(path) {
    const abstract = this.app.vault.getAbstractFileByPath(path);
    if (!(abstract instanceof import_obsidian3.TFile)) return null;
    return { file: abstract, source: await this.app.vault.read(abstract) };
  }
  async writeClipboard(value, message) {
    await navigator.clipboard.writeText(value);
    new import_obsidian3.Notice(message);
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
      new import_obsidian3.Notice("\u8BF7\u628A\u5149\u6807\u653E\u5728 exam-question \u9898\u76EE\u5361\u7247\u5185");
      return;
    }
    try {
      await this.writeClipboard(copyQuestionMarkdown(current.source, current.question), "\u9898\u76EE\u5DF2\u590D\u5236");
    } catch (error) {
      new import_obsidian3.Notice(`\u590D\u5236\u5931\u8D25\uFF1A${String(error)}`);
    }
  }
  async copyLinkFromEditor(editor, view) {
    const current = this.questionFromEditor(editor);
    if (!current.question?.blockId || !view.file) {
      new import_obsidian3.Notice("\u5F53\u524D\u5149\u6807\u4E0D\u5728\u53EF\u5F15\u7528\u7684\u9898\u76EE\u5361\u7247\u5185");
      return;
    }
    try {
      const link = createQuestionLink(view.file.path, current.question.blockId, current.question.title);
      await this.writeClipboard(link, "\u9898\u76EE\u94FE\u63A5\u5DF2\u590D\u5236");
    } catch (error) {
      new import_obsidian3.Notice(`\u590D\u5236\u94FE\u63A5\u5931\u8D25\uFF1A${String(error)}`);
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
        new import_obsidian3.Notice("\u8BF7\u9009\u62E9\u4E00\u4E2A\u9009\u9879\u7247\u6BB5\uFF0C\u6216\u628A\u5149\u6807\u653E\u5728 A-D \u9009\u9879\u884C");
        return;
      }
      start = positionToOffset(source, { line: cursor.line, ch: option.index ?? 0 });
      end = start + option[0].length;
      from = { line: cursor.line, ch: option.index ?? 0 };
      to = { line: cursor.line, ch: (option.index ?? 0) + option[0].length };
    }
    const question = findQuestionAtOffsets(source, start, end);
    if (!question) {
      new import_obsidian3.Notice("\u9009\u9879\u5FC5\u987B\u5B8C\u5168\u4F4D\u4E8E\u540C\u4E00\u9053 exam-question \u9898\u76EE\u5185");
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
      new import_obsidian3.Notice("\u9009\u9879\u811A\u6CE8\u5DF2\u6DFB\u52A0");
    } catch (error) {
      new import_obsidian3.Notice(`\u6DFB\u52A0\u811A\u6CE8\u5931\u8D25\uFF1A${String(error)}`);
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
    const button2 = document.createElement("button");
    button2.type = "button";
    button2.className = "exam-question-action";
    button2.dataset.examAction = label;
    button2.textContent = label;
    button2.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void action();
    });
    return button2;
  }
  async findRenderedQuestion(sourcePath, title, sourceLine) {
    const loaded = await this.readFile(sourcePath);
    if (!loaded) return null;
    const questions = findExamQuestions(loaded.source);
    if (typeof sourceLine === "number") {
      const byLine = questions.find((item) => item.headerLine <= sourceLine && sourceLine < item.endLine);
      if (byLine) return { ...loaded, question: byLine };
    }
    const number2 = questionNumberFromTitle(title);
    const candidates = questions.filter((item) => item.title === title || number2 && item.number === number2);
    const question = candidates.length === 1 ? candidates[0] : null;
    return question ? { ...loaded, question } : null;
  }
  async copyRenderedQuestion(sourcePath, title, sourceLine) {
    const found = await this.findRenderedQuestion(sourcePath, title, sourceLine);
    if (!found) {
      new import_obsidian3.Notice("\u627E\u4E0D\u5230\u5BF9\u5E94\u7684\u9898\u76EE\u6E90\u6587\u672C");
      return;
    }
    try {
      await this.writeClipboard(copyQuestionMarkdown(found.source, found.question), "\u9898\u76EE\u5DF2\u590D\u5236");
    } catch (error) {
      new import_obsidian3.Notice(`\u590D\u5236\u5931\u8D25\uFF1A${String(error)}`);
    }
  }
  async copyRenderedLink(sourcePath, title, sourceLine) {
    const found = await this.findRenderedQuestion(sourcePath, title, sourceLine);
    if (!found?.question.blockId) {
      new import_obsidian3.Notice("\u627E\u4E0D\u5230\u5BF9\u5E94\u7684\u9898\u76EE\u5757\u7F16\u53F7");
      return;
    }
    try {
      await this.writeClipboard(createQuestionLink(found.file.path, found.question.blockId, found.question.title), "\u9898\u76EE\u94FE\u63A5\u5DF2\u590D\u5236");
    } catch (error) {
      new import_obsidian3.Notice(`\u590D\u5236\u94FE\u63A5\u5931\u8D25\uFF1A${String(error)}`);
    }
  }
};
var ExamNotesSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "\u9898\u8FF9" });
    new import_obsidian3.Setting(containerEl).setName("\u9ED8\u8BA4\u5C55\u5F00\u5171\u7528\u9898\u5E72").setDesc("\u63A7\u5236\u9605\u8BFB\u89C6\u56FE\u4E2D\u6BCF\u9053\u5B50\u9898\u4E0A\u65B9\u201C\u5171\u7528\u9898\u5E72\u201D\u7684\u9ED8\u8BA4\u72B6\u6001\uFF1B\u624B\u52A8\u5F00\u5408\u53EA\u5F71\u54CD\u5F53\u524D\u663E\u793A\u3002").addToggle((toggle) => {
      let current = true;
      toggle.setValue(current);
      void getStudyStore(this.plugin).then((store) => {
        current = store.sharedMaterialDefaultExpanded;
        toggle.setValue(current);
      }).catch((error) => {
        console.error("\u9898\u8FF9\uFF1A\u8BFB\u53D6\u5171\u7528\u9898\u5E72\u8BBE\u7F6E\u5931\u8D25", error);
        new import_obsidian3.Notice("\u9898\u8FF9\u8BBE\u7F6E\u8BFB\u53D6\u5931\u8D25");
      });
      toggle.onChange(async (value) => {
        const previous = current;
        try {
          const store = await getStudyStore(this.plugin);
          await store.setSharedMaterialDefaultExpanded(value);
          current = value;
        } catch (error) {
          console.error("\u9898\u8FF9\uFF1A\u4FDD\u5B58\u5171\u7528\u9898\u5E72\u8BBE\u7F6E\u5931\u8D25", error);
          toggle.setValue(previous);
          new import_obsidian3.Notice("\u5171\u7528\u9898\u5E72\u8BBE\u7F6E\u672A\u4FDD\u5B58\uFF0C\u8BF7\u91CD\u8BD5");
        }
      });
    });
  }
};
