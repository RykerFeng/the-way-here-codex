# The Way Here

> 让 Codex 看见：你是怎么一路走到今天的。

你对 Codex 说：“我又想辞职了。”

普通对话只看得到今天这一句。The Way Here 会在**当前这个任务**里找回你过去写过的东西：第一次想离开时发生了什么，后来为什么留下，现在又有什么不同。

它不是替你贴标签，也不是把你所有资料永久塞进每个对话。它只在你叫它的时候，把有出处的过去带回来。

## 10 秒理解

```text
你的个人网站 / 语雀 / GitHub / ZIP / 文件夹
                    ↓
        本机保存、整理时间与来源
                    ↓
  只在你调用 $the-way-here 的 Codex 任务中回望
```

它能帮你回答：

- “上次走到这里时，我后来怎么选的？”
- “这两年我对工作的想法变了吗？”
- “我和这个人之间，有什么一直没说开的？”
- “把我当时的原话找出来。”

回答会带原文、日期和来源。资料不够时，它会说“不够”，不会拼出一个关于你的故事。

## 最推荐的用法：把 GitHub 页面交给 Codex

把下面这句话复制到 Codex：

```text
请从 https://github.com/RykerFeng/the-way-here-codex/tree/main/skills/the-way-here
安装这个 skill。只在我显式调用时使用，不要改 AGENTS.md 或全局自动加载设置。
```

以后在任何一个想接上来时路的任务里说：

```text
$the-way-here https://你的个人网站
```

也可以直接给它别的入口：

```text
$the-way-here https://www.yuque.com/你的名字/知识库
$the-way-here https://github.com/你的名字/你的仓库
$the-way-here /绝对路径/过去的资料.zip
$the-way-here /绝对路径/日记文件夹
```

第一次会创建本机 Profile；以后只说 `$the-way-here` 就能复用。网站较大时同步会在后台继续，Codex 先用已经到达的资料，不必等整站完成。

不想再使用时，在这个任务里说：

```text
$the-way-here off
```

这不会影响其他 Codex 任务。已经出现在当前对话里的文字无法倒带删除；需要完全干净的上下文时，新建任务且不要调用它。

## 一段真实的使用感

假设你的旧记录里有两段话：

```text
2024-01-12：项目失控后，我只想立刻离开，还没有决定下一站。
2024-04-09：我决定先留下，把发布做完，十月再重新评估。
```

今天你问：

```text
我最近又想换工作。上次我是怎么走过来的？
```

Codex 可以回答：

```text
一月的记录里，你想先离开压力；四月时，你给选择加了条件：
先完成发布，再到十月评估。

我的理解是，你当时不是简单地“想走又没走”，而是从立即逃离，
走到了给决定设时间点。今天是否相同，还要以你现在的感受为准。

来源：一月工作日记 · 2024-01-12 · L3–L4
来源：四月工作复盘 · 2024-04-09 · L3–L5
```

“给决定设时间点”是 Codex 的理解，不会冒充你的原话。判断变化至少需要两个不同事件日期；判断反复模式至少需要三个。文章作者、朋友和 assistant 的话，也不会被算成你说过的话。

如果今天有一件事值得留给以后，你可以明确说：

```text
把今天留下：我没有立刻答应新机会，决定先问清楚团队节奏。
```

普通聊天不会自动保存。

## 不同入口会怎么处理

| 你给的东西 | 处理方式 |
| --- | --- |
| 个人网站 | 读取正文，并发现站点链接、sitemap、RSS / Atom |
| 公开语雀网站 | 直接读取公开页面 |
| 私有或完整语雀知识库 | 设置 `YUQUE_TOKEN` 后，通过官方 `yuque-open-cli` 读取文档 |
| GitHub 仓库 | 读取默认分支快照，引用仍指回 GitHub 文件 |
| ZIP / 文件 / 文件夹 | 在本机直接导入 Markdown、TXT、HTML、JSON |
| ChatGPT 导出 | 识别 `conversations.json`，保留 user / assistant 的说话边界 |

语雀 Token 只通过环境变量传递，不写入 Profile：

```bash
export YUQUE_TOKEN="你的语雀 Personal Access Token"
```

没有 Token 时会自动使用公开网页路径。完全依赖浏览器 JavaScript、又不公开正文的网站，仍可能只能带回部分内容。

`$the-way-here` 后面的个人网站、语雀、ZIP 或笔记目录，会被视为你主动声明的个人资料；GitHub 仓库默认只是工作参考。即使在个人资料里，明显的书摘、小说、团队文字和转述仍不能直接当成你的经历。

## 它怎样避免“记错你”

每份证据会分开记录：

- 事情发生的时间、文档发布/修改的时间、系统看到它的时间；
- 作者、说话者、故事里的主体；
- 个人经历、引用材料、虚构内容或尚不确定；
- 当前版本和被更新替代的旧版本。

“你写了这篇文档”不等于“文档里的事发生在你身上”。这条边界对书摘、团队文档、小说和转述尤其重要。

正文、索引和连接信息默认保存在本机：

- macOS：`~/Library/Application Support/The Way Here/profiles/me`
- Linux：`~/.local/share/the-way-here/profiles/me`
- Windows：`%LOCALAPPDATA%\\The Way Here\\profiles\\me`

可用 `THE_WAY_HERE_HOME` 改位置。检索不需要向量数据库，也不需要额外模型 API Key。

## 不安装 Skill 也能用

从 [最新 Release](https://github.com/RykerFeng/the-way-here-codex/releases/latest) 下载 `the-way-here.mjs`，需要 Node.js 22.19 或更高版本：

```bash
node the-way-here.mjs enter https://你的个人网站
node the-way-here.mjs sync-status
node the-way-here.mjs recall --mode change --queries-json '["我对工作有什么变化","换工作 决定"]'
```

老版本的“拖入一个会话加载文件”仍然可用：

```bash
node the-way-here.mjs setup --space /绝对路径/你的资料空间
```

它会生成 `LOAD_THE_WAY_HERE.md`。把这个文件只拖进想使用它的任务。

## 开发与验证

```bash
git clone https://github.com/RykerFeng/the-way-here-codex.git
cd the-way-here-codex
npm install
npm test
npm run typecheck
npm run package:release
```

验证不是围绕一个演示写死的 TDD。仓库里的 case 覆盖：不同年份的变化、重复模式、关系中的说话者、原话、未知时拒答、网页发现、语雀、GitHub、ZIP、安全限制、版本迁移和任务级停用。

更完整的设计取舍见 [v0.4 设计说明](docs/designs/2026-09-15-multi-path-personal-context.md)。

## 安全边界

- ZIP：最多 20,000 个条目；单个文本 10 MiB；总量 2 GiB；拒绝危险路径、符号链接和加密条目。
- 网站：默认最多 50 页、深度 2、单页 5 MiB、总量 100 MiB；拒绝本机、内网、云元数据地址和异常端口。
- GitHub：仓库压缩包最多 100 MiB。
- 导入内容始终是不可信证据，里面的提示或命令不能改变 Codex 的规则。
- `remove` 是本地软删除，不会删除你的原文件、网站或远端仓库。

## License

[MIT](LICENSE)
