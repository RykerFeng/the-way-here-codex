# The Way Here

**让 Codex 记得，你是怎么走到今天的。**

你今天说：

> 我又想辞职了。

普通的 AI 只看得到这一句话。

The Way Here 会让当前这个 Codex 任务回到你自己留下的记录里：一月，你只想马上离开；四月，你决定先把发布做完；到了今天，你面对的已经不是完全相同的处境。

它不会替你下结论。它只是把过去准确地带回来，让你看见一路上发生了什么变化，再陪你决定下一步。

如果你愿意，你还可以说：

> 把今天这个决定也留下。

于是今天，也会成为以后能够回望的来时路。

## 它做的就是这四件事

```text
带回过去  →  理解此刻  →  看见变化  →  留下今天
    ↑                                      ↓
    └──────────── 以后再回来时 ────────────┘
```

1. 你把日记、笔记、聊天导出、ZIP，或者自己的记录网站交给 Codex。
2. Codex 只在你选择的这个任务里使用它们。
3. 当过去确实能帮助今天时，Codex 找回原文、日期和出处；没有证据就直说没有。
4. 只有你明确说“记下来”，今天的内容才会被保存。

它不是一个一直监听你的全局记忆，也不是给任意资料做问答的普通 RAG。它关心的是：**过去的你，怎样走成了今天的你。**

## 一次完整的使用

把专属加载文件拖进一个 Codex 任务后，你可以直接说：

```text
把这个 ZIP 作为我的来时路收进来。
```

Codex 会告诉你带回了多少段记忆、覆盖哪些年份。之后正常聊天：

```text
我最近又在犹豫要不要换工作。上次走到这里时，我后来怎么选的？
```

回答会像这样：

```text
你现在是在犹豫，并没有说自己已经决定离开。

上一次相似的过程里，一月的你只想马上离开；到四月，你把决定改成了
“先完成发布，十月再评估”。这更像是从逃离压力，走到了给选择设置条件。

记录：一月工作日记 · 2024-01-12 · L3–L4 · 原文件路径
记录：四月工作复盘 · 2024-04-09 · L3–L5 · 原文件路径
```

“从逃离压力走到设置条件”是 Codex 的理解，不会被伪装成你的原话。比较变化至少要有两个不同日期；判断“你总是这样”至少要有三个。朋友、assistant 和网页作者说的话，也不会被算成你说过的话。

聊到一个值得留下的时刻时，你再决定：

```text
把今天留下：我没有立刻答应新机会，决定先问清楚团队节奏。
```

普通聊天不会自动进入记忆。

## 三分钟接入 Codex

需要 Node.js 22.19 或更高版本。

### 1. 下载

从 [Releases](https://github.com/RykerFeng/the-way-here-codex/releases/latest) 下载编译好的 ZIP 并解压。发布包里有可直接运行的 `the-way-here.mjs`，不需要安装 npm 依赖。

如果你不想碰终端，也可以把本仓库地址发给 Codex，让它下载最新 Release 并完成下面的 setup。

### 2. 创建你的来时路空间

空间是一个由你选择、保存在本机的目录：

```bash
node /absolute/path/to/the-way-here.mjs setup --space /absolute/path/to/my-way-here
```

它会在空间里生成：

```text
LOAD_THE_WAY_HERE.md
```

### 3. 只在需要的任务里加载

把 `LOAD_THE_WAY_HERE.md` 拖进想使用记忆的 Codex 任务，告诉 Codex“加载我的来时路”。完成。

没有加载这个文件的其他任务不会受到影响。你也可以随时说“停用来时路”；需要完全干净的上下文时，新建一个任务且不要加载它。

## 什么可以成为来时路

- Markdown、TXT、HTML、JSON
- 包含这些文件的 ZIP
- ChatGPT `conversations.json`
- 不需要登录的公开网站

当你说“这是我的日记/笔记/个人网站”时，它们会作为个人记忆进入来时路。文章、产品文档、书摘和项目资料默认只是参考材料：可以查询，但不会被当成你的人生。

目前不支持 PDF、图片 OCR、登录后网页，以及完全依赖浏览器 JavaScript 才能显示正文的网站。

## 你的资料在哪里

正文、索引和来源信息都保存在你指定的本机目录中。检索在本机完成，不需要额外的向量数据库或模型服务。

The Way Here 不会修改 `AGENTS.md`、Skills、Plugins、MCP、`config.toml` 或 shell 配置。它对任务的影响来自你主动加载的那一个 Markdown 文件。

导入内容一律被当作不可信资料；里面的命令和提示不能改变 Codex 的行为规则。移除资料使用软删除，不会碰原始 ZIP、文件、网站或聊天导出。

## 想自己操作时

通常直接对 Codex 说人话就够了。下面这些命令主要留给想检查细节的人。

```bash
# 自己的日记、笔记或 ZIP
node the-way-here.mjs import --space /absolute/path/to/my-way-here /path/to/past.zip --as memory --authorship user

# 自己的公开记录网站
node the-way-here.mjs import --space /absolute/path/to/my-way-here https://example.com/my-journal --as memory --authorship user

# 外部文章或文档，默认只是 reference
node the-way-here.mjs import --space /absolute/path/to/my-way-here https://example.com/article

# 看来时路覆盖了多久
node the-way-here.mjs overview --space /absolute/path/to/my-way-here

# 检查、列出、移除和备份
node the-way-here.mjs doctor --space /absolute/path/to/my-way-here
node the-way-here.mjs sources --space /absolute/path/to/my-way-here
node the-way-here.mjs remove --space /absolute/path/to/my-way-here SOURCE_ID
node the-way-here.mjs export --space /absolute/path/to/my-way-here --out /absolute/path/to/backup
```

网页默认只导入当前页。明确要导入同站同目录下的文档站时，加 `--scope site`。

## 安全边界

| 入口 | 默认限制 |
| --- | --- |
| ZIP | 最多 20,000 个条目；单个文本 10 MiB；总量 2 GiB |
| 网站 | 最多 50 页；深度 2；单页 5 MiB；总量 100 MiB |

ZIP 不会解压到磁盘，并拒绝危险路径、符号链接、加密条目和超大内容。网页导入会拒绝本机、内网、云元数据地址和非标准端口。

## 从源码开发

```bash
git clone https://github.com/RykerFeng/the-way-here-codex.git
cd the-way-here-codex
npm install
npm test
npm run typecheck
npm run build
```

`npm run build` 同时生成普通 Node.js 输出和无需依赖的单文件版本 `dist/the-way-here.mjs`。

## 许可证

[MIT](LICENSE)
