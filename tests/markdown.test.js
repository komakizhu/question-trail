import test from "node:test";
import assert from "node:assert/strict";
import {
  copyQuestionMarkdown,
  createQuestionLink,
  findExamQuestions,
  findQuestionAtOffsets,
  insertOptionFootnote,
  stripPersonalFootnotes,
} from "../src/markdown.js";

const source = `# 试卷

> [!exam-material] 共享材料
> 材料文字
> ![[attachments/table.png]]

^m-material-01

> [!exam-question] 第 66 题
> 题干文字
>
> A.甲[^exam-q66-note-1]
> B.乙[^source-note]
> C.丙
> D.丁

^q66

标签：#政治
关联：
材料：[[#^m-material-01|共享材料]]

> [!success]- 答案与解析
> 答案

> [!note]- 我的笔记
> 用户笔记

[^exam-q66-note-1]: 旧的个人选项笔记
[^source-note]: 原卷注释
`;

test("parses only exam question callouts and stable blocks", () => {
  const questions = findExamQuestions(source);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].number, "66");
  assert.equal(questions[0].blockId, "q66");
  assert.deepEqual(questions[0].materialIds, ["m-material-01"]);
});
test("copies question with expanded material and removes personal notes", () => {
  const question = findExamQuestions(source)[0];
  const copied = copyQuestionMarkdown(source, question);
  assert.match(copied, /材料文字/);
  assert.match(copied, /!\[\[attachments\/table\.png\]\]/);
  assert.match(copied, /66\. 题干文字/);
  assert.match(copied, /A\.甲/);
  assert.doesNotMatch(copied, /答案|用户笔记|exam-q66-note|\^q66|exam-question/);
  assert.match(copied, /\[\^source-note\]/);
});

test("creates a stable block link", () => {
  assert.equal(createQuestionLink("行测/2025.md", "q66", "第 66 题"), "[[行测/2025.md#^q66|第 66 题]]");
});

test("saved fold markers never become part of question titles or copied links", () => {
  for (const fold of ["+", "-"]) {
    const folded = source.replace("[!exam-question]", `[!exam-question]${fold}`);
    const question = findExamQuestions(folded)[0];
    assert.equal(question.title, "第 66 题");
    assert.equal(createQuestionLink("行测/2025.md", question.blockId, question.title), "[[行测/2025.md#^q66|第 66 题]]");
    assert.match(copyQuestionMarkdown(folded, question), /66\. 题干文字/);
  }
});

test("adds an option footnote within one question", () => {
  const question = findExamQuestions(source)[0];
  const start = source.indexOf("A.甲");
  const result = insertOptionFootnote(source, question, start, start + 3, "容易把甲看成乙");
  assert.match(result.source, /A\.甲\[\^exam-q66-note-2\]/);
  assert.match(result.source, /\[\^exam-q66-note-2\]: 容易把甲看成乙/);
  assert.throws(() => insertOptionFootnote(source, question, source.indexOf("用户笔记"), source.indexOf("用户笔记") + 4, "x"));
});

test("strips only plugin personal footnotes", () => {
  const value = "A[^exam-q1-note-1] B[^source-note]\n\n[^exam-q1-note-1]: memo\n[^source-note]: source";
  const stripped = stripPersonalFootnotes(value);
  assert.equal(stripped, "A B[^source-note]\n\n[^source-note]: source");
});

test('material references scan the full attached region and stop at real boundaries', () => {
  const card=(id)=>`> [!exam-question] ${id}\n> 题干\n\n^${id}\n`;
  const long=card('q1')+'\n题型：单选\n\n标签：\n关联：\n\n附属说明\n\n> [!note]- 我的笔记\n> 说明\n\n材料：[[#^m1|材料一]]\n';
  assert.deepEqual(findExamQuestions(long)[0].materialIds,['m1']);
  for(const boundary of ['#### 下一题', '> [!exam-question]+ 下一题','> [!exam-material]- 下一组']) {
    assert.deepEqual(findExamQuestions(card('q1')+'\n'+boundary+'\n\n材料：[[#^other]]')[0].materialIds,[],boundary);
  }
});

test('fake headers and material references in code, display math and tables are ignored', () => {
  const source=['```md','> [!exam-question] 代码假题','> 假题干','','^fake','```','> [!exam-question] 真题','> 题干','','^q1','','```md','> [!exam-question] 假下一题','材料：[[#^code]]','```','$$','> [!exam-material] 假材料组','材料：[[#^math]]','$$','\\[','#### 假标题','材料：[[#^bracket]]','\\]','| 标记 | 说明 |','| --- | --- |','| 材料：[[#^table]] | 假材料 |','材料：[[#^table2]] | 假材料','--- | ---','材料：[[#^table3]] | 假材料','','材料：[[#^real|真正材料]]'].join('\n');
  const questions=findExamQuestions(source); assert.equal(questions.length,1); assert.equal(questions[0].blockId,'q1'); assert.deepEqual(questions[0].materialIds,['real']);
});
