# Changelog

本项目的主要变更记录在此文件中。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Planned

- CPH 样例导入与运行集成。
- 公开静态资源的流式混合加速与持久化缓存。

## [0.9.34] - 2026-08-12

### Changed

- 活动栏侧边栏改为“连接状态、恢复或常用操作、其他操作”三级分组，并为每个入口补充明确用途。

### Fixed

- 增加 Edge 会话实时健康检查；直接关闭 Edge 后会自动清除失效登录状态，并显示重新连接入口。

## [0.9.33] - 2026-08-11

### Fixed

- 修复活动栏容器 ID 不符合 VS Code 格式要求，导致 Codeforces 入口错误降级到资源管理器的问题。

## [0.9.32] - 2026-08-11

### Added

- 新增 VS Code 原生活动栏 Codeforces 图标和侧边栏入口。
- 侧边栏实时显示登录连接状态，并提供打开 Codeforces、登录或恢复连接、提交当前代码文件三个操作。

## [0.9.31] - 2026-08-11

### Changed

- 合并同一内容块中的纯文本翻译请求，显著减少含有大量行内公式时的网络往返次数。
- 整题翻译并发数由 2 提升至 6；合并标记异常时自动回退为逐段翻译，优先保证译文正确。

## [0.9.30] - 2026-08-11

### Fixed

- 修复安全分段翻译脚本的正则转义错误，避免题目正文被错误显示为重复的 `s` 字符。
- 题目翻译不再把 HTML、公式或代码占位符发送给 Bing，防止结构完整但正文已损坏的译文被误判为成功。
- 中文译文继续保留原有公式与代码节点，同时移除重复的 MathJax 预览和公式源脚本。

## [0.9.29] - 2026-08-11

### Fixed

- 提交改为在真实 Edge 官方提交页中生成并发送实时反机器人字段，不再伪造旧版 `adcd1e` 参数。
- 当 Codeforces 要求 Turnstile 或额外反机器人验证时，自动打开普通大小的 Edge 官方提交页，并在验证后复用该页面完成提交。
- 题目下方提交框、Codeforces 原生提交页和 VS Code 当前文件提交统一使用同一条官方 Edge 提交流程。
- 长题面或翻译服务破坏公式、代码占位符时，自动切换到分段文本翻译并原位保留受保护内容，不再直接显示占位符不完整错误。

## [0.9.28] - 2026-08-11

### Added

- 极速模式与正常模式，以及页面导航加载进度。
- Codeforces 常用界面汉化、独立中文题面和逐段翻译。
- 公式、代码、图片、样例及翻译占位符保护。
- 题目下方提交框、原生提交页修复和评测结果轮询显示。
- 样例一键复制、响应式布局及 `Ctrl + 鼠标滚轮` 缩放。
- 比赛倒计时每秒更新的本地兜底机制。
- 专用 Edge 登录、会话验证、后台恢复和断线重登录流程。
- 静态资源缓存、页面快照、预取、请求去重和优先级队列。

### Changed

- 登录 Edge 使用 `1200 × 800` 普通窗口，不再启动时最大化。
- 带实时倒计时的比赛列表和比赛主页不再复用旧页面快照。
- VS Code 激活事件改由命令贡献自动生成。

### Fixed

- 修复登录成功后 VS Code 状态未同步、群组页面仍要求登录的问题。
- 修复刷新题目后回退到初始群组页面的问题。
- 修复重复切换翻译导致公式、代码占位符和中英文内容损坏的问题。
- 修复窄窗口内容重叠、水平滚动和缩放后布局卡死的问题。
- 修复 Codeforces 多语言成功消息被误判为提交失败的问题。

[Unreleased]: https://github.com/zxt-fine/vscode-cf-inline/compare/v0.9.34...HEAD
[0.9.34]: https://github.com/zxt-fine/vscode-cf-inline/releases/tag/v0.9.34
[0.9.33]: https://github.com/zxt-fine/vscode-cf-inline/releases/tag/v0.9.33
[0.9.32]: https://github.com/zxt-fine/vscode-cf-inline/releases/tag/v0.9.32
[0.9.31]: https://github.com/zxt-fine/vscode-cf-inline/releases/tag/v0.9.31
[0.9.30]: https://github.com/zxt-fine/vscode-cf-inline/releases/tag/v0.9.30
[0.9.29]: https://github.com/zxt-fine/vscode-cf-inline/releases/tag/v0.9.29
[0.9.28]: https://github.com/zxt-fine/vscode-cf-inline/releases/tag/v0.9.28
