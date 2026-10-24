import test from "node:test";
import assert from "node:assert/strict";
import { findCallouts, matchRenderedCallout, setCalloutFold } from "../src/callout-folds.js";

const source = `> [!exam-question] 第 1 题
> 题干

^q1

> [!note]- 我的笔记
> 第一题笔记

> [!exam-question] 第 2 题
> 题干

^q2

> [!note]- 我的笔记
> 第二题笔记
`;

test("same-title notes persist independent fold states at their source positions", () => {
  const records = findCallouts(source);
  assert.deepEqual(records.map((r) => [r.type, r.line, r.endLine]), [
    ["exam-question", 0, 2], ["note", 5, 7], ["exam-question", 8, 10], ["note", 13, 15],
  ]);
  const changed = setCalloutFold(source, source, records[3], false);
  assert.deepEqual(findCallouts(changed).map((r) => r.fold), ["", "-", "", "+"]);
  assert.equal(changed.replace("[!note]+", "[!note]-"), source);
  assert.equal(setCalloutFold(changed, changed, findCallouts(changed)[3], true), source);
});

test("nested callouts and metadata preserve their individual marker positions", () => {
  const text = "> [!note|custom]- 外层\n> 文本\n> > [!tip]+ 内层\n> > 内文\n> 尾部\n\n";
  const records = findCallouts(text);
  assert.deepEqual(records.map((r) => [r.type, r.depth, r.endLine]), [["note", 1, 5], ["tip", 2, 4]]);
  assert.match(setCalloutFold(text, text, records[1], true), /> > \[!tip\]- 内层/);
});

test("fenced examples and a second header in the same blockquote are not callouts", () => {
  const text = "```md\n> [!note]- example\n```\n\n> [!note]- real\n> ```md\n> > [!tip]- example\n> ```\n>\n> [!note]- just text\n\n> [!tip]+ other\n> body";
  assert.deepEqual(findCallouts(text).map((r) => r.type), ["note", "tip"]);
});

test("concurrent fold-only changes do not clobber each other", () => {
  const records = findCallouts(source);
  const first = setCalloutFold(source, source, records[1], false);
  const both = setCalloutFold(first, source, records[3], false);
  assert.deepEqual(findCallouts(both).map((r) => r.fold), ["", "+", "", "+"]);
});

test("stale source positions cannot modify an edited or shifted document", () => {
  const record = findCallouts(source)[3];
  assert.equal(setCalloutFold("前言\n" + source, source, record, false), null);
  assert.equal(setCalloutFold(source.replace("第二题笔记", "新笔记"), source, record, false), null);
});

test("non-foldable callouts and CRLF source are preserved", () => {
  assert.equal(setCalloutFold(source, source, findCallouts(source)[0], false), null);
  const text = source.replaceAll("\n", "\r\n");
  const changed = setCalloutFold(text, text, findCallouts(text)[3], false);
  assert.equal(changed.replace("[!note]+", "[!note]-"), text);
});

test("DOM mapping must agree on every callout and never falls back to duplicate titles", () => {
  const records = findCallouts(source);
  const types = records.map((r) => r.type);
  assert.equal(matchRenderedCallout(records, types, 3), records[3]);
  assert.equal(matchRenderedCallout(records, types.slice(1), 1), null);
  assert.equal(matchRenderedCallout(records, ["note", ...types.slice(1)], 1), null);
});
