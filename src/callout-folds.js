/** Source positions, not titles, identify callouts (exam notes repeat titles). */
export function findCallouts(source) {
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
            line, endLine: lines.length, from: offset, to: source.length,
            depth, type: header[2].toLowerCase(), fold: header[3],
            marker: offset + prefix.length + header[1].length,
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

/** Allow concurrent fold clicks, but never write through stale text positions. */
export function setCalloutFold(current, snapshot, record, collapsed) {
  if (!record?.fold) return null;
  if (current !== snapshot && withoutFoldStates(current) !== withoutFoldStates(snapshot)) return null;
  const sign = collapsed ? "-" : "+";
  return current.slice(0, record.marker) + sign + current.slice(record.marker + 1);
}

export function matchRenderedCallout(records, renderedTypes, index) {
  if (index < 0 || records.length !== renderedTypes.length) return null;
  if (records.some((item, i) => item.type !== renderedTypes[i])) return null;
  return records[index] ?? null;
}
