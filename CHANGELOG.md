# Changelog

本项目的主要变更记录在此文件中。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Planned

- CPH 样例导入与运行集成。
- 公开静态资源的流式混合加速与持久化缓存。

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

[Unreleased]: https://github.com/zxt-fine/vscode-cf-inline/compare/v0.9.28...HEAD
[0.9.28]: https://github.com/zxt-fine/vscode-cf-inline/releases/tag/v0.9.28
