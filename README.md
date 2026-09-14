# the-way-here-codex

把 ZIP、笔记或公开网站变成 Codex 可以查证的本地资料库。

```text
ZIP / 文件 / 网站  →  本地解析与检索  →  当前 Codex 会话按需引用
```

资料会跨会话保存在你指定的目录里；使用权限不会跨会话自动生效。只有你明确让 Codex 读取 [`LOAD.md`](LOAD.md) 的会话才会调用它。

## 3 步开始

### 1. 下载并构建

需要 Node.js 22.19 或更高版本。

```bash
git clone https://github.com/RykerFeng/the-way-here-codex.git
cd the-way-here-codex
npm install
npm run build
```

运行 `pwd`，记下项目的绝对路径。

### 2. 只在当前会话加载

在需要资料库的 Codex 会话里发送下面两句话。把两个示例路径换成你自己的绝对路径：

```text
请读取 /absolute/path/to/the-way-here-codex/LOAD.md，只在本会话启用。
资料空间使用 /absolute/path/to/my-memory-space。
```

Codex 会初始化资料空间。它不会安装全局插件，也不会修改 `AGENTS.md`、Skills、MCP 或 Codex 配置。

### 3. 交给它资料

```text
把 /absolute/path/to/archive.zip 收进资料库。
把 https://example.com/article 收进资料库。
结合资料库，找找我以前关于工作焦虑写过什么。
```

说“停用资料库”，当前会话就不再调用它。资料仍留在磁盘上，以后可以在另一个明确加载过的会话复用。

## 它能做什么

- 导入 `.zip`、`.md`、`.txt`、`.html` 和 `.json`。
- 识别 ChatGPT 导出的 `conversations.json`。
- 导入单个公开网页，或有限度抓取同站同目录页面。
- 搜索中文和英文，返回原文片段、来源与行号。
- 内容去重、来源软删除、JSON 备份。

所有解析和索引都在本机完成。它不调用额外的模型 API，也不上传资料到本项目提供的服务器。

## 为什么不会自动影响其他会话

这不是安装到 Codex 的 Skill 或插件，而是一份普通的 `LOAD.md` 加本地 CLI：

- 不写入用户级或项目级 Codex 配置。
- 每条 CLI 命令都必须显式传入资料空间的绝对路径。
- 独立新会话不会自动读取 `LOAD.md`。
- 恢复或分叉已经加载过的会话，可能继承它的上下文。想要干净上下文时，新建会话且不要加载即可。

Codex 官方也提供自动发现的 [`AGENTS.md`](https://learn.chatgpt.com/docs/agent-configuration/agents-md) 和 [Skills](https://learn.chatgpt.com/docs/build-skills)。本项目有意不使用它们作为默认安装方式，以保持手动、按会话启用。

## 安全边界

导入的资料只被当成不可信文本，不会执行资料里的命令。

| 入口 | 默认限制 |
| --- | --- |
| ZIP | 20,000 个条目；单文本 10 MiB；总解压量 2 GiB |
| 网站 | 50 页；深度 2；单页 5 MiB；总量 100 MiB |

ZIP 不落地解压，并拒绝父目录路径、绝对路径、符号链接、加密条目和超大内容。网站导入拒绝本机、内网、链路本地、常见云元数据地址与非标准端口，并重新检查每次重定向。

## 手动使用 CLI

通常不需要手动运行这些命令；它们主要供 Codex 调用。所有命令都只输出一个 JSON 对象。

```bash
node dist/cli.js init --space /absolute/path/to/space
node dist/cli.js import-file --space /absolute/path/to/space /absolute/path/to/archive.zip
node dist/cli.js import-url --space /absolute/path/to/space https://example.com/page --scope page
node dist/cli.js import-url --space /absolute/path/to/space https://example.com/docs/ --scope site
node dist/cli.js search --space /absolute/path/to/space 工作焦虑
node dist/cli.js read --space /absolute/path/to/space SOURCE_ID --start 1 --end 100
node dist/cli.js status --space /absolute/path/to/space
node dist/cli.js remove --space /absolute/path/to/space SOURCE_ID
node dist/cli.js export --space /absolute/path/to/space --out /absolute/path/to/backup
```

`--scope page` 只导入当前页面。只有你确实想收整个文档站时，才使用 `--scope site`。

## 当前不支持

- PDF、OCR 和图片识别
- 登录后网页或依赖浏览器渲染的网页
- 云同步和网页管理界面
- 自动记录普通聊天
- 多 GiB 导入任务的断点续传

软删除来源不会删除原 ZIP、原文件、网页或 Codex 聊天记录。

## 开发与验证

```bash
npm test
npm run typecheck
npm run build
```

## 许可证

[MIT](LICENSE)
