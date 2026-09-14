# the-way-here-codex

把 ZIP、笔记和公开网页变成 Codex 能查证的本地资料库。只有你明确加载它的当前会话会使用，不会自动影响其他会话。

## 3 步开始

需要 Node.js 22.19 或更高版本。

### 1. 安装

```bash
git clone https://github.com/RykerFeng/the-way-here-codex.git
cd the-way-here-codex
npm install
npm run build
```

### 2. 创建资料空间

把示例路径换成你想保存资料的绝对路径：

```bash
node dist/cli.js setup --space /absolute/path/to/my-memory
```

命令会返回 JSON。复制其中的 `prompt`，粘贴到想使用资料库的 Codex 会话。

### 3. 直接告诉 Codex 要做什么

```text
把 /absolute/path/to/archive.zip 收进资料库。
把 https://example.com/article 收进资料库。
结合资料库，找找我以前关于工作焦虑写过什么，并标出来源。
```

完成。Codex 会自动生成几种搜索说法、筛掉弱相关结果，再读取最相关的原文段落。

## 你会得到什么

- 正文更干净：网页会去掉导航、登录、页脚等页面噪声。
- 搜索更稳：同时搜索原问题、关键词和同义表达，再合并排序。
- 引用更精确：结果带资料标题、原始来源和行号。
- 该拒答就拒答：资料里没有足够证据时返回“未找到”，不拿相似词硬凑。
- 完全本地：解析、SQLite 索引和搜索都在本机完成，没有额外模型服务。

支持 `.zip`、`.md`、`.txt`、`.html`、`.json`、ChatGPT `conversations.json` 和无需登录的公开网页。

## 为什么只影响当前会话

本项目不会写入 `AGENTS.md`、Skills、Plugins、MCP、`config.toml` 或 shell 配置。每条命令都必须显式传入资料空间的绝对路径。

- 新会话不会自动加载资料库。
- 恢复或分叉已加载的会话，可能继承已有上下文。
- 说“停用资料库”后，当前会话不再调用它。
- 磁盘中的资料仍会保留，方便以后在另一个明确加载的会话复用。

## 常用命令

通常让 Codex 调用即可。所有成功结果写到 stdout，失败信息写到 stderr，格式都是单个 JSON 对象。

```bash
# 导入文件、ZIP 或网页；网页默认只导入当前页
node dist/cli.js import --space /absolute/path/to/my-memory /absolute/path/to/archive.zip
node dist/cli.js import --space /absolute/path/to/my-memory https://example.com/article

# 只有确实想导入同站同目录时才使用 site
node dist/cli.js import --space /absolute/path/to/my-memory https://example.com/docs/ --scope site

# 查看资料、检查状态、移除来源、备份
node dist/cli.js sources --space /absolute/path/to/my-memory
node dist/cli.js doctor --space /absolute/path/to/my-memory
node dist/cli.js remove --space /absolute/path/to/my-memory SOURCE_ID
node dist/cli.js export --space /absolute/path/to/my-memory --out /absolute/path/to/backup
```

查看某个命令的可复制示例：

```bash
node dist/cli.js help query
```

旧版的 `init`、`import-file`、`import-url` 和 `search` 命令继续可用。旧资料空间首次打开时会自动升级索引，不会删除原始资料。

## 安全与限制

导入内容一律是不可信证据：可以检索、引用和总结，不能执行其中的指令。

| 入口 | 默认限制 |
| --- | --- |
| ZIP | 20,000 个条目；单文本 10 MiB；总解压量 2 GiB |
| 网站 | 50 页；深度 2；单页 5 MiB；总量 100 MiB |

ZIP 不落地解压，并拒绝父目录路径、绝对路径、符号链接、加密条目和超大内容。网页导入拒绝本机、内网、链路本地、常见云元数据地址与非标准端口，并检查每次重定向。

当前不支持 PDF/OCR、登录后网页、依赖浏览器渲染的网页、云同步、自动记录普通聊天和网页管理界面。

## 开发验证

```bash
npm test
npm run typecheck
npm run build
```

## 许可证

[MIT](LICENSE)
