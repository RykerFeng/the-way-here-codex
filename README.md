# the-way-here-codex

**把一个 ZIP、几份笔记或一个网站交给 Codex，然后直接问里面的问题。**

它会把资料保存在你的电脑上。你只需要在某个 Codex 对话里粘贴一句“加载资料库”，这个对话就能搜索资料、阅读原文，并在回答里标出出处。

没有加载它的其他对话，不受影响。

```text
ZIP / 笔记 / 网站
        ↓
保存在电脑上的资料库
        ↓
你指定的这一个 Codex 对话
        ↓
根据原文回答，并标出资料和行号
```

## 看一个例子

你导入了过去几年的日记，然后问：

```text
我上一次想换工作时，最后是怎么决定的？
```

Codex 会搜索日记，读取最相关的几段，再回答：

```text
你在一月份只是想立刻离开，还没有作决定。
四月份的复盘里，你最后决定先留下，把发布做完，十月再评估。

来源：一月工作日记 · L3–L3
来源：四月工作复盘 · L3–L3
```

如果资料里没有答案，它会直接说没找到，而不是拿相似内容拼一个答案。

## 它适合做什么

- 把多年日记、笔记或 ChatGPT 导出交给 Codex 回顾。
- 查询一个项目 ZIP 里的决定、背景和历史记录。
- 让 Codex 阅读公开文章或文档网站，并带出处回答。
- 只在当前对话使用私人资料，不想影响其他对话。

它**不会**自动记录你的日常聊天，也不是全局记忆插件。只有你明确导入的资料会保存；只有你明确加载资料库的对话会使用它。

## 第一次使用

需要 Node.js 22.19 或更高版本。

### 1. 下载并安装

[下载最新版本 ZIP](https://github.com/RykerFeng/the-way-here-codex/releases/latest)，解压后在终端进入项目目录：

```bash
npm install
npm run build
```

也可以使用 Git：

```bash
git clone https://github.com/RykerFeng/the-way-here-codex.git
cd the-way-here-codex
npm install
npm run build
```

### 2. 创建一个资料库

选择一个用来保存资料的绝对路径。目录不存在也没关系：

```bash
node dist/cli.js setup --space /absolute/path/to/my-memory
```

命令会返回一段 JSON。找到里面的 `prompt`，复制它的文字，例如：

```text
请读取并遵守 /path/to/the-way-here-codex/LOAD.md，只在当前任务使用资料空间 /absolute/path/to/my-memory。
```

### 3. 在 Codex 里加载

新建一个 Codex 对话，把刚才复制的文字粘贴进去。

加载完成后，直接对 Codex 说：

```text
把 /absolute/path/to/archive.zip 收进资料库。
把 https://example.com/article 收进资料库。
结合资料库，找找我以前关于工作焦虑写过什么，并标出来源。
```

以后想在另一个对话使用同一批资料，只需再次粘贴那段加载文字。

## 会影响哪些对话

- 新对话不会自动加载资料库。
- 当前对话说“停用资料库”后，Codex 不再查询它。
- 恢复或分叉已经加载的对话，可能继承原有上下文。
- 导入的资料会继续保存在电脑上，除非你主动移除。

本项目不会修改 `AGENTS.md`、Skills、Plugins、MCP、`config.toml` 或 shell 配置。

## 支持哪些资料

可以导入：

- `.zip`
- `.md`、`.txt`、`.html`、`.json`
- ChatGPT `conversations.json`
- 不需要登录的公开网页

暂不支持：

- PDF 和图片 OCR
- 登录后才能看的网页
- 完全依赖浏览器运行 JavaScript 的网页
- 云同步和网页管理界面

## 资料放在哪里

资料正文、索引和来源信息都保存在你指定的资料库目录中。搜索在本机完成，不需要额外的模型服务。

网页或 ZIP 里的文字只被当作资料，不能改变 Codex 的规则，也不会被当成命令执行。

删除某条资料时使用软删除：原 ZIP、原文件、网页和 Codex 聊天记录都不会被删除。

## 手动使用命令

通常让 Codex 操作即可。如果你想自己管理：

```bash
# 导入 ZIP、文件或单个网页
node dist/cli.js import --space /absolute/path/to/my-memory /absolute/path/to/archive.zip
node dist/cli.js import --space /absolute/path/to/my-memory https://example.com/article

# 导入同站同目录下的多个页面
node dist/cli.js import --space /absolute/path/to/my-memory https://example.com/docs/ --scope site

# 查看、检查、移除和备份
node dist/cli.js sources --space /absolute/path/to/my-memory
node dist/cli.js doctor --space /absolute/path/to/my-memory
node dist/cli.js remove --space /absolute/path/to/my-memory SOURCE_ID
node dist/cli.js export --space /absolute/path/to/my-memory --out /absolute/path/to/backup
```

查看某个命令的示例：

```bash
node dist/cli.js help query
```

## 默认安全限制

| 入口 | 限制 |
| --- | --- |
| ZIP | 最多 20,000 个条目；单个文本 10 MiB；总量 2 GiB |
| 网站 | 最多 50 页；深度 2；单页 5 MiB；总量 100 MiB |

ZIP 不会解压到磁盘，并拒绝危险路径、符号链接、加密条目和超大内容。网页导入会拒绝本机、内网、云元数据地址和非标准端口。

## 开发验证

```bash
npm test
npm run typecheck
npm run build
```

## 许可证

[MIT](LICENSE)
