/** 题迹输出与插件解析器的隔离集成检查；生产 Skill 不依赖 Node。 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, realpath, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(process.argv[2] || path.join(skill, '..', '..'));
const { build } = createRequire(path.join(repo, 'package.json'))('esbuild');
const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'question-trail-parser-')));
try {
  const modulePath = path.join(temporary, 'study-model.mjs');
  await build({ entryPoints: [path.join(repo, 'src/study-model.ts')], outfile: modulePath, bundle: true, platform: 'node', format: 'esm' });
  const { studyQuestions } = await import(pathToFileURL(modulePath).href);
  const cases = [
    { kind: '单选', expected: 'single', body: '题干\nA. 甲\nB. 乙\n', answer: 'B', expectedAnswer: ['B'], optionCount: 2 },
    { kind: '多选', expected: 'multiple', body: '题干\n' + [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(x => `${x}. ${x}原文\n`).join(''), answer: 'AZ', expectedAnswer: ['A', 'Z'], optionCount: 26 },
    { kind: '判断', expected: 'judgment', body: '题干\nA. 不符合\nB. 符合\n', answer: '符合', expectedAnswer: ['B'], optionCount: 2 },
    { kind: '单选', expected: 'single', body: '题干\nA. \n  甲选项的续行\nB. 乙\n', expectedAnswer: null, expectedOptions: ['甲选项的续行', '乙'], optionCount: 2 },
    { kind: '单选', expected: 'single', body: '题干\nA. \n$$\nx+1\n$$\nB. 乙\n', expectedAnswer: null, expectedOptions: ['$$\nx+1\n$$', '乙'], optionCount: 2 },
    { kind: '单选', expected: 'single', body: '题干\nA. \n```text\n代码选项\n```\nB. 乙\n', expectedAnswer: null, expectedOptions: ['```text\n代码选项\n```', '乙'], optionCount: 2 },
    { kind: '主观题', expected: 'subjective', body: '请作文\nA. 原文段落，不是选项\n', expectedAnswer: null, optionCount: 0 },
    { kind: '单选', expected: 'single', body: '题干\n```text\nC. 伪选项\n```\n| D. 表格 |\n$$\nE. 公式\n$$\n    F. 缩进代码\nA. 甲\nB. 乙\n', expectedAnswer: null, optionCount: 2 },
    { kind: '单选', expected: 'single', body: '题干\n\\[\nC. 公式伪选项\n\\]\nA. 甲\nB. 乙\n', expectedAnswer: null, optionCount: 2 },
    { kind: '单选', expected: 'single', body: '题干\nA. 甲\nB. 乙\n', tail: '\n^existing-question\n关联：[[#^existing-question]]\n', expectedId: 'existing-question', expectedAnswer: null, optionCount: 2 },
    { kind: '判断', expected: 'judgment', body: '题干\nA. 不符合\nB. 符合\n', tail: '\n^existing-judgment\n题型：判断\n', expectedId: 'existing-judgment', expectedAnswer: null, optionCount: 2 },
  ];
  const files = [];
  const spec = {};
  for (let i = 0; i < cases.length; i++) {
    const item = cases[i], filename = path.join(temporary, `${i}.md`);
    const source = item.body + (item.tail || '') + (item.answer ? `\n> [!success]- 答案与解析\n> 参考答案：${item.answer}\n> 解析：原解析\n` : '');
    await writeFile(filename, source);
    spec[filename] = [{ start_line: 1, end_line: item.body.trimEnd().split('\n').length, kind: item.kind, title: `第 ${i + 1} 题` }];
    files.push(filename);
  }
  const specPath = path.join(temporary, 'spec.json'), previewPath = path.join(temporary, 'preview.json');
  await writeFile(specPath, JSON.stringify(spec));
  const run = spawnSync('python3', [path.join(skill, 'scripts/preview.py'), '--files', ...files, '--spec', specPath, '--output', previewPath], { cwd: temporary, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const preview = JSON.parse(await readFile(previewPath, 'utf8'));
  for (let i = 0; i < cases.length; i++) {
    const item = cases[i], questions = studyQuestions(preview.files[i].proposed);
    assert.equal(questions.length, 1, `插件必须识别 ${item.kind} 样例 ${i}`);
    assert.equal(questions[0].kind, item.expected);
    assert.equal(questions[0].options.length, item.optionCount);
    if (item.expectedOptions) assert.deepEqual(questions[0].options, item.expectedOptions);
    assert.deepEqual(questions[0].answer, item.expectedAnswer);
    if (item.expectedId) {
      assert.equal(questions[0].blockId, item.expectedId);
      assert.equal(preview.files[i].proposed.match(/^题型[：:]/gm).length, 1);
    }
    if (item.kind === '判断') assert.deepEqual(questions[0].options, ['不符合', '符合']);
  }
  const invalid = path.join(temporary, 'invalid.md');
  const empty = '题干\nA.   \nB. 乙\n';
  const invalidSpec = path.join(temporary, 'invalid-spec.json');
  await writeFile(invalid, empty);
  await writeFile(invalidSpec, JSON.stringify({ [invalid]: [{ start_line: 1, end_line: 3, kind: '单选' }] }));
  const rejected = spawnSync('python3', [path.join(skill, 'scripts/preview.py'), '--files', invalid, '--spec', invalidSpec, '--output', path.join(temporary, 'invalid-preview.json')], { encoding: 'utf8' });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stdout, /选项正文不能为空/);
  const invalidCard = '> [!exam-question] 空选项\n' + empty.split('\n').filter((_, index, all) => index < all.length - 1).map(line => '> ' + line + '\n').join('') + '\n^empty-option\n题型：单选\n';
  assert.equal(studyQuestions(invalidCard).length, 0, '插件也必须拒绝空白选项');
  await writeFile(invalid, invalidCard);
  const verified = spawnSync('python3', [path.join(skill, 'scripts/verify.py'), '--files', invalid], { encoding: 'utf8' });
  assert.equal(verified.status, 1);
  assert.match(verified.stdout, /选项正文不能为空/);
  console.log('题迹生成的 11 份隔离样例均被实际插件解析器识别；原编号、多行选项、公式、代码和题型保留，空白选项的 preview/verify 与插件解析均拒绝。');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
