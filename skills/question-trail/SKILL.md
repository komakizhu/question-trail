---
name: question-trail
description: 当用户要求用题迹整理题目、将指定 Markdown 笔记转换为题迹格式、检查题型或批量预览并应用整理时，使用本技能。支持单选、多选、判断和主观题，保留原文与稳定编号，先展示预览，经一次确认后逐文件安全应用并验证。 Use this skill when the user asks to organize questions with Question Trail, convert explicitly selected Markdown notes, inspect question types, or preview and apply a batch. Supports single choice, multiple choice, judgment and subjective questions with preserved content, stable block IDs, explicit confirmation, safe per-file writes and verification.
---

# 题迹（Question Trail）

将用户明确指定的 Markdown 文件整理为题迹插件能识别的题目卡片。只用 Python 3 标准库，无第三方依赖；四个入口和共享模块必须一起保留。以本文件所在目录为 `SKILL_DIR`，所有命令都从这里找脚本，不依赖插件源码、当前目录或本机全局 Skill。

## 题迹操作边界

只接受用户明确指定的 `.md` 普通文件，使用真实绝对路径。禁止自动遍历笔记库、目录、关联笔记或通配符；材料双链不扩大文件范围。软链接不作为写入目标。脚本不会安装插件、修改作答数据、提交 Git 或同步别处。

原文中的题干、选项、答案、解析、材料、标签、关联、个人笔记、表格、代码和公式必须保留。缺少答案保持缺少，不根据知识或选项猜答案。不能明确题型、选项边界、题目范围或判断题显示文字时，列出疑问并等待用户澄清。脚本只添加卡片包裹、缺少的块编号与题型行，不自动重写选项或答案。

## 题迹整理流程

先读取 [题迹格式样例](references/format-examples.md)，再执行以下步骤。用户尚未指定具体文件时先确认文件范围；不要搜索整个库。

### 检查指定题目

```bash
python3 "$SKILL_DIR/scripts/inspect.py" --files "/绝对路径/题目一.md" "/绝对路径/题目二.md"
```

输出逐文件完整原文、已有卡片的起止行、编号、题型与歧义。原始题目不会被自动猜出范围；依据原文逐题写出 `spec.json`。键为本批指定文件的真实绝对路径，行号从 1 起且两端都包含。`kind` 必须是 `单选`、`多选`、`判断`、`主观题` 之一。

```json
{
  "/绝对路径/题目一.md": [
    {"start_line": 3, "end_line": 8, "kind": "多选", "title": "第 1 题"}
  ],
  "/绝对路径/题目二.md": [
    {"start_line": 1, "end_line": 4, "kind": "主观题", "title": "第 2 题"}
  ]
}
```

原始范围仅选题干与选项，勿把答案、解析、个人笔记、已有块编号、题型、材料或下道题放入。已有 Callout 的起止范围使用 `inspect` 给出的行号，不含其外部编号和元数据；缺少题型时在 spec 指定。已有明确题型的卡片可不写 spec。旧四选项卡片虽然插件兼容单选，本技能仍要求显式选择题型，不擅自认定。

原始范围后紧邻的唯一旧块编号会直接保留为该卡片编号，不另建编号；其后已有同题型行也保留一份。编号与范围之间只能有不超过三个空行，归属不明、多个编号或原题型与 spec 不同均列为歧义。

选择题须已具备连续、不重复的 A–Z 选项标识，每项正文去掉空白后必须有文字；支持 `A.`、`A．`、`A、`、`A)`、`A）`。判断题须有 A/B 两个原文选项，如 `A. 正确`、`B. 错误`，或题内实际显示的其他文字。保留原文字和顺序，不套用“正确/错误”。缺少明确选项标识时先在预览讨论中列明歧义；本脚本拒绝猜测、重新编号或生成选项。主观题不把正文中的 A/B 等当作选项。检测到没有行首竖线的表格时列为歧义，请先确认范围。

### 预览全部文件

```bash
python3 "$SKILL_DIR/scripts/preview.py" --files "/绝对路径/题目一.md" "/绝对路径/题目二.md" --spec "/任务目录/spec.json" --output "/任务目录/preview.json"
```

每份预览同时含 `source` 原文、`source_base64` 原始字节、`proposed` 完整建议文本、`changed` 与 `ambiguities`。原始字节用于确认换行符也未改变。输出 JSON 文件必须尚不存在，禁止覆盖 Markdown。预览文件仅保存在当前任务目录；其中有完整题目，不能擅自上传或加入 Git。

向用户展示整批明确文件列表、每个文件完整原文与完整建议文本，或打开可逐字比对两者的查看界面；只展示统计、摘要、差异节选不够。所有歧义解决后重新生成预览。**只询问一次是否按本批完整预览应用**。收到确认前不能运行 `apply --confirm`；`--confirm` 是记录已取得用户确认，不代表脚本代替用户确认。用户只批准部分时，用那些文件重新生成对应预览并确认范围。

### 一次确认后逐文件应用

```bash
python3 "$SKILL_DIR/scripts/apply.py" --preview "/任务目录/preview.json" --confirm
```

预览中原始字节与当前文件逐字节比较，实际写入前再次比较；变化时停止本批，保留已完成文件，要求对剩余文件重新预览。逐文件在同目录写临时文件后原子替换，不会留下半个文件；保留权限位。任一文件写入失败也停止并分别报告 `applied`、`unchanged`、`failed`、`skipped`。多文件之间没有事务回滚，不要把部分成功说成全部完成。不要盲目重跑旧预览，也不要为回滚覆盖用户后来改动。

应暂停编辑这些文件直到应用结束。标准文件 API 不能与所有外部编辑器形成共同文件锁；两次比较与原子替换不能消除其他程序恰好同时写入的极短竞争窗口。

### 验证并汇报

```bash
python3 "$SKILL_DIR/scripts/verify.py" --files "/绝对路径/题目一.md" "/绝对路径/题目二.md" --preview "/任务目录/preview.json"
```

验证文件与预览完全相同，并检查编号重复、题型、选项和幂等性。独立检查已有笔记可省略 `--preview`；这只检查本技能的格式，不证明 Obsidian 已加载或真实渲染。验证成功后再次 `preview`（不带旧行号 spec，使用新的输出路径）应全部 `changed: false`。新增编号由原始题目内容生成，已有编号永远保留；相同内容的新题按文件中顺序加稳定后缀，不因重复执行重新编号。

最终用短句汇报修改了哪些文件、实际验证结果、未解决项。失败时明确哪些成功、哪些失败或跳过。四个入口均输出 JSON，格式验证/应用失败退出码为 1，成功为 0。预览有歧义也返回 1，但仍保存完整报告供澄清。

## 题迹包内自检

```bash
python3 -m unittest discover -s "$SKILL_DIR/tests" -v
```

测试只写系统临时目录中的隔离 Markdown，并复制本包到临时位置测试四个入口。不要用用户笔记做测试。
