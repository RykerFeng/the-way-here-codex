# The Way Here v0.4 Implementation Record

目标：一次显式 `$the-way-here` 调用，把个人网站、语雀、GitHub、ZIP、文件或目录接入可复用的本地 Profile，只在当前 Codex 任务里主动回望。

方法：根据行为 Case 优化，不采用 TDD，不做中间提交；实现完成后统一回归、打包和 Review。

## 已完成

- [x] 新增默认 `me` Profile 和跨平台本机存储路径；保留 `--space` 兼容入口。
- [x] 新增 `enter`、后台 `sync --start`、`sync-status`、进度心跳和安全重跑。
- [x] 重复进入立即使用已有资料，并在后台刷新所有连接。
- [x] SQLite 升级到 schema v4；保留旧正文并重建索引。
- [x] 分开事件时间、发布/修改时间和收录时间，并保存时间来源。
- [x] 分开作者、说话者、主体和内容范围。
- [x] 同一远端 ID 的新正文替代当前版本；旧版本保留但不进入默认检索。
- [x] 网站支持 robots Sitemap、Sitemap Index、RSS / Atom 和受限链接发现。
- [x] 语雀有 Token 时使用固定版本官方 CLI；无 Token 时退回公开网页。
- [x] GitHub 读取默认分支 ZIP，不执行仓库代码，引用指回稳定仓库路径。
- [x] ZIP、文件和目录继续使用边界检查和内容哈希去重。
- [x] 新增显式 Codex Skill，并设置 `allow_implicit_invocation: false`。
- [x] `$the-way-here off` 只改变当前任务行为，不写全局 active 状态。
- [x] 普通聊天不自动保存；只有明确请求才调用 `remember`。
- [x] 虚构和引用范围不能支撑个人回忆；归属未知时强制拒绝断言。
- [x] 重写 README 和 `START.md`，把故事、最短安装路径和隔离边界放在前面。
- [x] Release 同时生成单文件 CLI、SHA-256、ZIP、Skill 和启动文档；resolver 使用 Release 直链，不消耗 GitHub API 限额。

## Case 覆盖

- 过去两个时期的变化、三个时期的反复模式、关系中的混合说话者、精确原话。
- 未知事实拒答、未知主体拒绝归因、书摘和小说不进入个人经历。
- 首次进入、重复进入、后台任务、同步进度、当前版本切换。
- 普通网站、Sitemap、RSS、公开语雀、授权语雀、GitHub、ZIP、目录和 ChatGPT 导出。
- v1/v2 数据迁移、软删除、导出、SSRF、重定向、响应大小和恶意 ZIP。

最终验收命令：

```bash
npm test
npm run typecheck
npm run build
npm run package:release
git diff --check
```

## 明确留到真实 Case 证明后再做

- 向量数据库或额外模型 API Key。
- 关系图、人格标签、自动长期总结。
- HTTP `ETag` 条件请求、语雀完整版本历史和目录面包屑。
- 远端删除自动传播和逐连接器游标 checkpoint；v0.4 用稳定 ID + 内容哈希做幂等恢复。
- Web 管理后台和任务级操作系统文件 ACL。
