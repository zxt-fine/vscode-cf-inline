# Codeforces Inline

[![CI](https://github.com/zxt-fine/vscode-cf-inline/actions/workflows/ci.yml/badge.svg)](https://github.com/zxt-fine/vscode-cf-inline/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-0.10.32-blue.svg)](https://github.com/zxt-fine/vscode-cf-inline)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

一个面向中文竞赛编程用户的 VS Code 扩展：在 VS Code 集成浏览器中浏览 Codeforces，保留英文或俄文原题，在原文下方生成独立中文译文，并支持登录、群组、提交和评测结果跟踪。

> 本项目是非官方开源项目，与 Codeforces 官方无隶属或合作关系。使用时请遵守 Codeforces 的服务条款和比赛规则。

## 主要功能

### 浏览与登录

- 在 VS Code 活动栏提供独立 Codeforces 图标，可直接展开连接状态、打开、登录和提交入口。
- 使用 Microsoft Edge 的独立受控配置登录 Codeforces 官方网站，兼容 Cloudflare 验证和真实账号会话。
- 插件启动时不会自动打开 Edge；只有用户主动点击登录或打开插件时才检查会话。
- 登录窗口以普通的 `1200 × 800` 窗口打开，登录并验证成功后自动最小化。
- 专用 Edge 配置会保留登录 Cookie；下次打开时优先静默恢复，失效后才要求重新登录。
- 提供默认的“极速模式”和可切换的“正常模式”，切换和页面导航均显示加载进度。
- 极速模式仅保留比赛、题库、我的群组和训练营四个核心入口。

### 中文化与翻译

- 常用 Codeforces 界面默认汉化，保留比赛、题目和提交页面的原有交互能力。
- 英文题面保持不变，在其下方生成独立中文译文。
- 翻译过程保护公式、代码、图片和样例，避免占位符损坏或重复公式。
- 题目之外的英文段落可由用户逐段选择翻译、隐藏或重新显示。
- 在线翻译优先使用 Bing，失败后回退到 Google，并对临时网络故障进行有限重试。

### 做题体验

- 页面宽度自适应：窄窗口优先显示正文并隐藏右侧栏，过窄时给出明确提示。
- 支持 `Ctrl + 鼠标滚轮` 调整页面字体大小，`Ctrl + 0` 恢复默认缩放。
- 样例区域提供一键复制按钮。
- 比赛倒计时使用实时兜底计时器，即使官方脚本加载失败也会每秒更新。
- 刷新或恢复 VS Code 标签页时尽量保留当前比赛、群组和题目路径。
- 静态资源、题目文档和常用页面采用分层缓存；带实时倒计时的页面不会使用旧文档快照。
- 题目标题旁提供醒目的“收藏题目”按钮；每道题还可标记为“待做、正在做、需要复习、已掌握”，同时保存个人思路、易错点和复习备注。
- 个人刷题仪表盘使用 Codeforces 个人主页的官方全部时间做题量；每日 AC、Rating 分布、标签覆盖、WA 次数和薄弱知识点则基于可获取的公开提交明细，并明确标注统计口径。
- 仪表盘支持删除不再需要的本地题目标记，算法标签显示中文；Rating 分布包含未定级题目，各档合计与提交明细中的已解决题数一致。

### 提交代码

- 可以使用 Codeforces 原生提交页提交代码。
- 每道题目的中文译文下方提供独立提交框，可粘贴代码或读取本地文件。
- 支持普通比赛、Gym、题库和私有群组题目。
- 自动读取 Codeforces 当前可用语言，并按文件扩展名或用户偏好选择默认语言。
- 提交由真实 Edge 官方页面生成实时校验字段；若 Codeforces 临时要求额外验证，会打开普通大小的 Edge 验证页，完成后可直接重试。
- 提交后持续刷新提交记录，在页面内显示排队、评测中、Accepted、Wrong Answer 等状态。

## 系统要求

- Windows 10 或 Windows 11
- VS Code `1.85.0` 或更高版本
- Microsoft Edge
- Node.js 24 或更高版本（仅源码开发和自行打包需要）
- 能够访问 Codeforces 的网络环境；如所在网络无法直连，需要可用的系统代理或 VPN

当前版本依赖 Windows 上的 Microsoft Edge 和专用浏览器配置，尚未正式支持 macOS 或 Linux。

## 安装

### 从 VSIX 安装

1. 获取项目发布的 `.vsix` 安装包，或按照下方说明自行打包。
2. 打开 VS Code 扩展面板。
3. 点击右上角 `…`，选择 `Install from VSIX...`。
4. 选择安装包并执行一次“开发人员: 重新加载窗口”。

### 从源码构建

```bash
git clone https://github.com/zxt-fine/vscode-cf-inline.git
cd vscode-cf-inline
npm ci
npm test
npm run package
```

打包成功后，项目根目录会生成 `vscode-cf-inline-<版本>.vsix`。

## 使用方法

1. 打开命令面板（`Ctrl + Shift + P`）。
2. 执行 `Codeforces Inline: 打开 Codeforces 翻译浏览器`。
3. 首次使用时，插件先在 VS Code 中显示连接页面；点击登录按钮后才会打开专用 Edge。
4. 在 Edge 中完成人机验证和账号登录。登录过程中不要关闭该窗口。
5. 插件验证比赛、题库、我的群组和训练营后，会自动最小化 Edge 并在 VS Code 中打开极速模式。
6. 打开题目后阅读英文原题及下方中文译文，并使用题目下方提交框或原生提交页提交代码。

关闭后台专用 Edge 后，当前会话会断开。此时刷新页面会显示错误和“重新登录”按钮，可以重新建立会话。

## 命令

| 命令 | 用途 |
| --- | --- |
| `Codeforces Inline: 打开 Codeforces 翻译浏览器` | 打开默认浏览界面；需要时恢复或建立 Edge 会话 |
| `Codeforces Inline: 在 VS Code 集成浏览器中打开` | 直接使用 VS Code 集成浏览器显示页面 |
| `Codeforces Inline: 打开旧版内嵌面板` | 使用旧版 iframe 内嵌界面 |
| `Codeforces Inline: 登录并连接 Edge 会话` | 打开登录连接页面 |
| `Codeforces Inline: 打开个人刷题仪表盘` | 查看收藏、进度、备注和 Codeforces 刷题统计 |
| `Codeforces Inline: 配置 AI 增强翻译` | 选择 DeepSeek、OpenAI、Ollama 或自定义兼容接口 |
| `Codeforces Inline: 更新并验证 AI API Key` | 验证新的 API Key，通过后再存入 VS Code 加密密钥存储 |
| `Codeforces Inline: 测试 AI 增强翻译连接` | 测试当前接口、模型和密钥是否可用 |

## 配置

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `cfInline.defaultPath` | `/` | 打开查看器时使用的 Codeforces 路径 |
| `cfInline.proxyPort` | `53005` | 本地页面服务端口；设为 `0` 时自动选择空闲端口 |
| `cfInline.viewer` | `integratedBrowser` | 使用集成浏览器或旧版内嵌面板 |
| `cfInline.fastMode` | `true` | 打开插件时默认进入极速模式 |
| `cfInline.defaultLanguage` | `auto` | 提交语言偏好；`auto` 根据文件扩展名选择 |
| `cfInline.localizeInterface` | `true` | 汉化常用 Codeforces 界面 |
| `cfInline.autoTranslateStatements` | `true` | 自动在英文题面下方生成中文译文 |
| `cfInline.aiTranslationEnabled` | `false` | 可选地使用 AI 结合上下文审校普通译文 |
| `cfInline.aiProvider` | `ollama` | 使用本机 Ollama 或 OpenAI 兼容接口 |
| `cfInline.aiEndpoint` | `http://127.0.0.1:11434` | AI 服务根地址或完整 Chat API 地址 |
| `cfInline.aiModel` | 空 | 使用的模型 ID，由用户配置时输入 |
| `cfInline.aiTimeoutMs` | `60000` | 每批 AI 审校请求的超时时间 |
| `cfInline.aiFallbackToStandard` | `true` | AI 不可用时自动回退普通译文 |

### AI 增强翻译（可选）

普通翻译仍然免费且默认启用。需要更强语境判断时，可从 Codeforces 侧边栏点击“配置 AI 增强翻译”，或者运行同名命令：

- 普通翻译默认优先使用 DeepL；DeepL 超时、限流或不可用时会自动切换到 Bing/Google，不需要配置，也不会因为单个服务失败而中断整份题面。
- `本地 Ollama`：完全在本机运行，不需要 API Key；模型 ID 由用户输入，并在本机实际请求验证成功后保存。
- `DeepSeek`：无需填写接口地址；插件固定使用官方 API，模型 ID 由用户输入。填写 API Key 后，只有模型和 Key 实际请求验证成功才会保存并启用。
- `OpenAI`：预设官方 API 地址 `https://api.openai.com/v1`，模型 ID 由用户输入；API Key 验证成功后才会保存并启用。
- `自定义 OpenAI 兼容 API`：用于其他实现 Chat Completions 接口的服务；接口地址和模型名可自行填写。
- 验证成功的配置会进入“已保存的 AI 配置”列表；以后可直接选择并启用，无需再次填写模型或 API Key。不同服务商、模型和自定义地址可以分别保存并随时切换。
- 从旧版本升级时，当前 AI 设置及其 API Key 会自动迁移成第一条已保存配置。
- 插件侧边栏持续显示当前“翻译模式”：普通模式会显示“普通免费翻译（DeepL 优先）”，AI 模式会显示服务商和模型；点击这一项即可在免费翻译、已保存 AI 配置和新配置之间切换。选择框只将真正的当前模式标成蓝色。
- 每条已保存 AI 配置右侧提供删除按钮；删除会同时清除配置及其安全 API Key。若删除当前 AI 配置，插件自动切回普通免费翻译。内置免费翻译不可删除。
- Codeforces 极速/正常模式顶部的“翻译模式”按钮会打开同一个选择框，无需返回插件侧边栏。
- API Key 只保存在 VS Code SecretStorage 中，不会进入 `settings.json`、日志、VSIX 或 Git 仓库。
- AI 会在普通译文基础上结合相邻段落审核语境，并严格检查公式和代码占位符；接口失败时默认自动回退普通译文。
- AI 只损坏某一段的公式或代码占位符时，仅该段回退到已验证的普通译文，其余段落仍保留 AI 审校结果。
- 成功结果会按模型和段落缓存，同一题面不会反复消耗 AI 请求。
- 若曾手动配置 DeepSeek，请确认 API Key 来自 DeepSeek 开放平台，模型名是 API 实际支持的模型 ID；网页账号与 API Key 不是同一种凭据。

## 工作原理

VS Code 集成浏览器本身不向扩展开放 Cookie、请求拦截或任意网页脚本注入接口。本项目因此使用以下链路：

```text
VS Code 集成浏览器
        ↓
本地同源页面服务（链接改写、中文化、翻译与提交辅助）
        ↓
专用 Microsoft Edge 会话（登录、Cloudflare、Codeforces 网络请求）
        ↓
Codeforces
```

本地服务仅监听 `127.0.0.1`。需要登录的 Codeforces 请求通过用户已经验证的 Edge 会话完成，避免把 Node.js 请求识别成另一个客户端。

## 隐私与安全

- 项目不会把 Codeforces 账号或密码保存到仓库、普通配置文件或日志中。
- 登录状态保存在 VS Code 扩展数据目录下的专用 Edge 配置中，并由 Windows/Edge 管理。
- 插件只导入建立会话所需的 Codeforces Cookie，不读取日常 Edge 配置或其他网站数据。
- 题面普通翻译会把需要翻译的文本片段发送到 Bing 或 Google；公式、代码、图片和样例不会发送。仅当用户主动开启 AI 增强翻译时，英文片段和中文初稿才会发送到用户配置的 AI 服务。
- 本地接口限制为回环地址，并对翻译、重新登录和页面状态接口进行来源或请求头校验。
- 不要提交包含真实 Cookie、CSRF Token、账号密码、个人 Edge 配置或本机日志的 Issue。

发现安全问题时请阅读 [SECURITY.md](SECURITY.md)。

## 常见问题

### 插件一打开就提示 Edge 会话已断开

点击页面中的“重新登录”，在新打开的专用 Edge 中完成登录，并保持它在后台运行。

### 页面一直加载或 Codeforces 超时

确认日常 Edge 能在相同网络下访问 Codeforces，并检查 Windows 系统代理或 VPN。插件会继承 Edge 使用的系统网络设置，但不会加载日常 Edge 扩展。

### 修改插件后界面没有变化

执行 `Ctrl + Shift + P` → `开发人员: 重新加载窗口`，并重新打开或刷新 Codeforces 页面。已经加载的页面不会自动替换旧脚本和样式。

### 翻译失败但 Codeforces 页面可以打开

翻译服务与 Codeforces 使用不同网络。可以稍后重试、关闭自动翻译，或检查 Bing/Google 翻译服务是否可达。

### 提交后没有立即显示最终结果

Codeforces 可能仍在排队或评测。插件会自动轮询提交记录；网络中断时可进入“我的提交”确认最终状态。

## 开发

```bash
npm ci
npm run compile
npm test
```

在 VS Code 中按 `F5` 启动扩展开发宿主。其他命令：

- `npm run watch`：持续编译 TypeScript。
- `npm run package`：生成 VSIX 安装包。
- `node test/manual-login.smoke.js`：人工验证真实 Edge 登录链路。
- `node test/parallel-page-load.smoke.js --synthetic`：运行合成页面渲染冒烟测试。

项目结构：

```text
src/        TypeScript 扩展源码
test/       自动测试和真实环境冒烟测试
out/        本地编译产物（不提交 Git）
.vscode/    扩展开发宿主启动配置
```

## 已知限制与计划

- 受控 Edge 转发需要完整读取并传回页面资源，因此首次加载可能比日常 Edge 慢。
- Codeforces 页面结构变化可能影响中文化、样例提取或提交辅助。
- 在线翻译依赖第三方翻译服务及当前网络。
- 计划支持 CPH 样例导入与运行，并研究公开资源的流式混合加速。

## 贡献

欢迎提交 Issue 和 Pull Request。开始开发前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

本项目使用 [MIT License](LICENSE)。
