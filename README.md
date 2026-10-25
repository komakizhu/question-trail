# 题迹（Question Trail）

版本：`0.5.2`

这是“公考试卷识别”Skill 的 Obsidian 配套插件，服务于 `exam-lite-v1` 题目导出。它只处理 `exam-question` 题目 Callout，不改写普通 Callout，也不会在打开文件时重写 Markdown。MinerU 只是上游候选解析器，插件不依赖 MinerU 运行。

## 手动安装

1. 在 Obsidian 库中打开“设置 → 第三方插件 → 已安装插件”，确认允许第三方插件。
2. 将本目录中的 `main.js`、`manifest.json`、`styles.css` 复制到库内：

   `.obsidian/plugins/obsidian-exam-notes/`

3. 在 Obsidian 的第三方插件列表中启用“题迹（Question Trail）”。交付 ZIP 已经包含这三个运行文件，解压后目录名应保持为 `obsidian-exam-notes`。

日常使用不需要把插件源码、`node_modules` 或 TypeScript 文件复制到库中。停用或卸载插件不会删除题目、附件、块引用、脚注和个人笔记；普通 Markdown 仍然可读。

## 题目格式

Skill 导出的题目类似：

```markdown
> [!exam-question] 第 66 题
> 张某8:00开车从A地出发……
>
> A. 10/13
> B. 13/10
> C. 20/13
> D. 13/5

^q66

标签：
关联：

> [!success]- 答案与解析
> 待补充。

> [!note]- 我的笔记
>
```

共享材料用单独的 `exam-material` Callout 和 `^m-material-XX` 块编号。题目卡片内的材料链接在复制时会展开；同一材料在文件中只保存一份。图片使用导出包内的 `attachments/` 路径，表格保留为 Markdown/HTML 原文。跨库迁移时要把附件目录一起带走。

## 功能

- **统一标记**：题号旁可分别切换 ★ 重要、○ 整题不确定、? 不会做；选项可分别标记不确定或错项。普通选项无色，正确为绿、错项或错选为红、不确定为橙；错项与不确定重叠时显示半橙半红。
- **重做与独立记录**：单题或整组进入空白作答，暂时隐藏答案、标签、关联、解析和个人笔记。每题独立提交，答案与标记变化各自保留历史；退出重做不保存未提交草稿。
- **共享材料题组**：只有连续题目明确引用同一份前置 `exam-material` 材料时才分组。题组、材料和子题背景透明并跟随主题；题组和共用题干可分别折叠，整组重做也保留每题独立记录。材料缺失、重复编号、多重引用或跨文件链接时保留原布局。
- **公考批改 Skill 同步**：完成批改后可确认同步，将最终答案、三个整题标记、选项不确定和错项标记送入插件收件箱。旧答题卡没有错项字段时按未标记处理。首次需要人工确认题目身份；绑定后，同一作答的后续答案或标记变化会新增修订。同步不改写题干和选项文字。
- **保留原生笔记**：标签、关联双链、答案解析和我的笔记继续使用原有 Markdown；标签后自动补显示空格。重做结束后恢复显示，解析和笔记仍使用原生折叠。只有本插件识别到的题目附属区域会受到影响。

- **同步 Callout 展开状态**：阅读模式和实时预览中点击展开或折叠，会把状态保存到该 Callout 原生的 `+ / -` 标记。编辑折叠块里的内容时会将它记为展开，切换模式或重新打开文件后继续沿用。嵌套块和不同题目中同名的“我的笔记”分别记录。
- **复制当前题目**：在阅读视图/实时预览的题目卡片上点击复制按钮，或在源码编辑器中把光标放入题目后运行命令。复制内容包含共享材料、题干、选项、图片、表格、公式和原卷注释；不包含 Callout 包装、块编号、答案、个人笔记、个人脚注引用或个人脚注定义。
- **复制当前题目链接**：复制当前文件内稳定的 `[[文件路径#^q66|第 66 题]]` 双链。链接使用源文件路径，不从嵌入视图推断路径。
- **为当前选项添加脚注**：选中一个选项片段，或把光标放在 A/B/C/D 选项行中，运行命令并输入注释。脚注引用和定义一次插入，支持 Obsidian 撤销；跨越多个题目时拒绝操作。

原卷脚注（非 `exam-note-` 编号）在复制时保留。用户脚注使用 `exam-note-题目块编号-序号` 形式；复制题目会移除它们，避免把个人记录带到题目副本中。标准脚注语法负责显示、跳转和返回；若主题对 Callout 内脚注呈现不同，底层 Markdown 仍保持可编辑。

题目卡片在浅色和深色主题中均使用透明背景与主题边框。交互作答用于阅读视图；实时预览使用 CodeMirror 折叠范围，同时保留原生文本编辑。仅增强有唯一块编号、完整 A–D 选项行的题目，其余格式保留原文和复制功能。参考答案从该题“答案与解析”里的 `参考答案：B`、`正确答案：B` 或 `答案：B` 读取；不识别多选答案，也不猜答案。若“我的笔记”或“答案与解析”含 `我的答案：C` / `我的作答：C`，会作为原始作答显示；没有时只显示初始标记，不生成演示历史。

### 作答数据

作答记录和绑定保存在库内 `.obsidian/plugins/obsidian-exam-notes/data.json` 的 `questionTrailV2` 字段，以源文件路径和题目块编号区分题目；旧 `questionTrail` 保留原样供迁移读取。记录包括答案、三个整题标记、选项不确定与错项、来源作答身份及修订。旧版记录缺少错项字段时会按未标记读取。题组折叠状态也保存在插件数据中。重新打开 Obsidian 后可继续查看历史。

通过 Obsidian 重命名或移动文件/文件夹时，记录随路径迁移。手动更换题目块编号会被视为另一题；同一文件的题目块编号应保持唯一。删除题目不会主动删除已保存记录。迁移库或同步到其他设备时，需要同时保留插件的 `data.json`，仅复制题目 Markdown 不包含作答历史。多个设备同时写入仍取决于库的文件同步机制。

保存失败时不会提示成功，也不会清空本次草稿；记录文件无法读取时保留原文件并暂停答题增强，避免覆盖已有数据。Skill 同步文件位于 `.obsidian/plugins/obsidian-exam-notes/import-inbox/`，成功处理后移入 `processed/` 归档。Obsidian 关闭时文件保留到插件下次启动。

## 与公考试卷识别 Skill 配合

先完成 `skills/gongkao-exam-reader/` 中 `exam-lite-v1` 的 A/B/C、普通排版和结构验证，再执行：

```bash
python3 ../../skills/gongkao-exam-reader/scripts/ocr_review.py exam-lite-obsidian-export \
  --run /absolute/work/exam \
  --candidate /absolute/work/exam/exam-lite-final.formatted-v2.json \
  --layout /absolute/work/exam/mineru-layout.json \
  --exam-id 2025国考行测地市级 \
  --output-dir /absolute/work/exam/obsidian-export
```

导出默认拒绝缺少 revision 2 完整验收的 run；这是为了避免把旧 exam-lite、single-pass 或 legacy 报告伪装成新的题目结构。仅检查草稿时可显式增加 `--allow-draft`。每次重新导出都写入新的输出目录，不覆盖已经有用户笔记的文件；source-map 只对应该次导出快照。

## 开发与构建

```bash
npm install
npm test
npm run build
```

构建结果是根目录的 `main.js`，配合 `manifest.json` 和 `styles.css` 即可手动安装。插件 ZIP 不包含源码和依赖目录。

打开 Obsidian 中任意 Markdown 笔记后，可运行 `npm run test:obsidian` 检查折叠同步：测试使用真实 Obsidian 渲染器和隔离的 CodeMirror 编辑器，题目与修改均保留在内存中，不写入笔记库、不切换当前页面。

运行 `npm run test:study` 可在真实 Obsidian 渲染器中检查复盘、重做、记录持久化和主题排版。检查使用屏幕外的隔离 DOM 与内存存储，不安装插件、不写入用户笔记。
