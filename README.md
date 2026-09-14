# the-way-here-codex

给 Codex 临时接上一份可复用的本地资料库。你可以交给它一个 ZIP、文件或公开网站；资料会保存在你指定的目录里，但只有明确读取 `LOAD.md` 的会话才会使用。

它不会安装全局插件，不会改 Codex 配置，也不会自动影响新会话。

## 先跑起来

需要 Node.js 22.19 或更高版本。

```bash
npm install
npm run build
```

然后在想使用的 Codex 会话里说：

```text
请读取 /这里换成绝对路径/the-way-here-codex/LOAD.md，只在本会话启用。
空间路径使用 /这里换成绝对路径/my-memory-space。
```

接着直接说：

```text
把 /绝对路径/资料.zip 收进资料库。
把 https://example.com/article 收进资料库。
结合资料库，找找我以前关于工作焦虑写过什么。
停用资料库。
```

## 第一版能做什么

- 导入 `.zip`、`.md`、`.txt`、`.html`、`.json`，识别 ChatGPT `conversations.json`。
- 导入一个公开网页，或有限度抓取同站同目录页面。
- 中英文搜索；返回来源、原文片段和行号。
- 重复导入自动去重；可以软删除来源和导出 JSON 备份。
- ZIP 不落地解压，并拦截父目录路径、绝对路径、符号链接、加密条目和超大内容。
- 网站导入拦截本机、内网、链路本地和常见云元数据地址；每次重定向重新检查。

默认限制：ZIP 最多 20,000 个条目、单文本 10 MiB、总解压量 2 GiB；网站最多 50 页、深度 2、单页 5 MiB、总量 100 MiB。

## 手动命令

所有命令都必须显式提供绝对的 `--space`，不会猜一个全局资料库。

```bash
node dist/cli.js init --space /absolute/path/to/space
node dist/cli.js import-file --space /absolute/path/to/space /absolute/path/to/archive.zip
node dist/cli.js import-url --space /absolute/path/to/space https://example.com/page --scope page
node dist/cli.js search --space /absolute/path/to/space 工作焦虑
node dist/cli.js read --space /absolute/path/to/space SOURCE_ID --start 1 --end 100
node dist/cli.js status --space /absolute/path/to/space
node dist/cli.js remove --space /absolute/path/to/space SOURCE_ID
node dist/cli.js export --space /absolute/path/to/space --out /absolute/path/to/backup
```

命令只输出一个 JSON 对象，方便 Codex 稳定读取。

## 边界

第一版没有 MCP 包装、网页 UI、PDF/OCR、图片识别、云同步、自动记录聊天或多 GiB 任务断点续传。网站抓取只支持无需登录的公开 HTML；动态渲染页面可能拿不到正文。软删除资料不会删除原附件、原网页或 Codex 会话记录。

详细设计和取舍见 [`docs/superpowers/specs/2026-09-14-the-way-here-codex-design.md`](docs/superpowers/specs/2026-09-14-the-way-here-codex-design.md)。
