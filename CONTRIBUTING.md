# 贡献指南

感谢你愿意改进 Codeforces Inline。

## 开始之前

- Bug 报告请说明 VS Code、Windows、Edge 和扩展版本。
- 网络问题请说明是否使用系统代理或 VPN，但不要提交代理账号、Cookie、Token 或完整个人日志。
- 功能建议请描述使用场景和期望结果，而不只是界面截图。

## 本地开发

```bash
git clone https://github.com/zxt-fine/vscode-cf-inline.git
cd vscode-cf-inline
npm ci
npm test
```

在 VS Code 中按 `F5` 启动扩展开发宿主。

## 提交要求

1. 每个 Pull Request 聚焦一个明确问题。
2. 不要提交 `node_modules/`、`out/`、`.vsix`、Edge 配置、Cookie 或本机日志。
3. 修改功能时补充或更新对应测试。
4. 提交前运行：

   ```bash
   npm test
   npm run package
   ```

5. 界面变化应保持中文显示、极速/正常模式、响应式布局和现有翻译保护逻辑。

## 代码风格

- TypeScript 开启严格模式。
- 优先使用小而明确的函数，避免把账号、Cookie 或完整网页内容写入日志。
- 本地接口必须限制来源和访问范围。
- 对 Codeforces 页面结构的匹配应提供失败提示，并尽量添加回归测试。

## 提交信息

建议使用简短的动词开头，例如：

- `fix: keep contest countdown live`
- `feat: add CPH sample import`
- `docs: expand installation guide`
