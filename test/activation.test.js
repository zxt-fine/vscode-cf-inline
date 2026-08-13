const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('does not launch Edge while VS Code is merely activating the extension', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');
  assert.doesNotMatch(source, /restoreSavedBrowserSession/);
  const loginCalls = [...source.matchAll(/loginWithEdgeBridge\(/g)];
  assert.equal(loginCalls.length, 1);
  assert.ok(loginCalls[0].index > source.indexOf('const handleReloginRequest'));
  assert.match(source, /proxy\.on\('reloginRequest', handleReloginRequest\)/);
  assert.match(source, /Do not open Edge during VS Code activation/);
});

test('relies on VS Code generated activation events for contributed commands', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(Object.hasOwn(manifest, 'activationEvents'), false);
  assert.deepEqual(manifest.contributes.commands.map((entry) => entry.command), [
    'cfInline.open',
    'cfInline.openIntegratedBrowser',
    'cfInline.openPanel',
    'cfInline.openLogin',
    'cfInline.installEdgeExtension',
    'cfInline.openDashboard',
    'cfInline.configureAiTranslation',
    'cfInline.selectTranslationMode',
    'cfInline.setAiApiKey',
    'cfInline.clearAiApiKey',
    'cfInline.testAiTranslation',
  ]);
  const containerId = manifest.contributes.viewsContainers.activitybar[0].id;
  assert.equal(containerId, 'cfInline-activity');
  assert.match(containerId, /^[A-Za-z0-9_-]+$/);
  assert.equal(manifest.contributes.viewsContainers.activitybar[0].icon, 'assets/codeforces.svg');
  assert.equal(manifest.contributes.views[containerId][0].id, 'cfInline.activityView');
});

test('registers a native Codeforces activity-bar sidebar without launching Edge', () => {
  const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');
  const sidebarSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'sidebar.ts'), 'utf8');
  assert.match(extensionSource, /registerCfSidebar\(proxy\)/);
  assert.ok(extensionSource.indexOf("registerCommand('cfInline.open'") < extensionSource.indexOf('registerCfSidebar(proxy)'));
  assert.match(sidebarSource, /createTreeView\(SIDEBAR_VIEW_ID/);
  assert.match(sidebarSource, /tree\.onDidChangeVisibility/);
  assert.match(sidebarSource, /executeCommand\('cfInline\.open'\)/);
  assert.match(sidebarSource, /'打开 Codeforces 浏览器'/);
  assert.match(sidebarSource, /'重新连接 Edge'/);
  assert.doesNotMatch(sidebarSource, /'安装配套 Edge 扩展'/);
  assert.match(sidebarSource, /'配置 AI 增强翻译'/);
  assert.doesNotMatch(sidebarSource, /'个人刷题仪表盘'/);
  assert.match(sidebarSource, /'翻译模式'/);
  assert.match(sidebarSource, /'cfInline\.selectTranslationMode'/);
  assert.match(sidebarSource, /普通免费翻译（DeepL 优先）/);
  assert.match(sidebarSource, /AI：.*aiService.*aiModel/);
  assert.match(sidebarSource, /onDidChangeConfiguration/);
  assert.match(sidebarSource, /'测试 AI 翻译连接'/);
  assert.doesNotMatch(sidebarSource, /提交当前编辑器代码|cfInline\.submit/);
  assert.match(sidebarSource, /setInterval/);
  assert.match(sidebarSource, /refreshSessionHealth/);
  assert.doesNotMatch(sidebarSource, /loginWithOfficialBrowser|captureCodeforcesSession/);
});

test('keeps AI enhancement optional and stores its key only in VS Code SecretStorage', () => {
  const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(manifest.contributes.configuration.properties['cfInline.aiTranslationEnabled'].default, false);
  assert.equal(manifest.contributes.configuration.properties['cfInline.aiProvider'].default, 'ollama');
  assert.equal(manifest.contributes.configuration.properties['cfInline.aiModel'].default, '');
  assert.match(extensionSource, /context\.secrets\.store\(AI_API_KEY_SECRET/);
  assert.match(extensionSource, /context\.secrets\.get\(AI_API_KEY_SECRET/);
  assert.doesNotMatch(extensionSource, /config\.update\(['"]aiApiKey/);
  assert.match(extensionSource, /AI 增强翻译暂不可用，已使用普通译文/);
  assert.doesNotMatch(extensionSource, /deepseek-chat（推荐）|deepseek-reasoner|gpt-4\.1-mini（推荐）|qwen3:8b（推荐）/);
  assert.match(extensionSource, /title: `填写 \$\{service\.label\} 模型名称`/);
  assert.match(extensionSource, /prompt: '请填写接口实际支持的模型 ID'/);
  assert.doesNotMatch(extensionSource, /DeepSeek'.*detail:|OpenAI'.*detail:/);
  assert.match(extensionSource, /本地 Ollama（免费）'.*detail: '连接 http:\/\/127\.0\.0\.1:11434'/);
  assert.match(extensionSource, /正在验证.*service\.label/);
  assert.match(extensionSource, /更新并验证 AI API Key/);
  assert.ok(
    extensionSource.indexOf("title: '正在验证 AI API Key…'")
      < extensionSource.indexOf('context.secrets.store(AI_API_KEY_SECRET, apiKey)')
  );
  assert.ok(
    extensionSource.indexOf('await vscode.window.withProgress')
      < extensionSource.lastIndexOf('activateAiProfile(context, profile')
  );
  assert.match(extensionSource, /配置未保存，API 验证失败/);
  assert.match(extensionSource, /createQuickPick<TranslationModeQuickPickItem>/);
  assert.match(extensionSource, /picker\.activeItems = current/);
  assert.match(extensionSource, /REMOVE_AI_PROFILE_BUTTON/);
  assert.match(extensionSource, /移除此 AI 配置/);
  assert.match(extensionSource, /removeAiProfile/);
  assert.match(extensionSource, /AI 配置并切换为普通免费翻译/);
  assert.match(extensionSource, /showInformationMessage\('已切换为普通免费翻译'\)/);
  assert.doesNotMatch(extensionSource, /已切换为普通免费翻译（/);
  assert.match(extensionSource, /showInformationMessage\('已切换为 AI 增强翻译'\)/);
  assert.match(extensionSource, /showInformationMessage\('AI 增强翻译已启用'\)/);
  assert.match(extensionSource, /showInformationMessage\('AI 增强翻译连接正常'\)/);
  assert.doesNotMatch(extensionSource, /showInformationMessage\(`[^`]*\$\{result\[0\]\}/);
  assert.match(extensionSource, /AI_PROFILES_STATE/);
  assert.match(extensionSource, /AI_PROFILE_SECRET_PREFIX/);
  assert.match(extensionSource, /Migrate the single configuration used by 0\.10\.0/);
  assert.match(extensionSource, /isOllamaModelAvailable\(profile\.endpoint, profile\.model\)/);
  assert.match(extensionSource, /profile\.verifiedAt > 0/);
  assert.doesNotMatch(extensionSource, /DeepL 优先，不可用时自动切换 Bing\/Google；无需 API Key/);
  assert.doesNotMatch(extensionSource, /本地模型已验证|使用已安全保存的 API Key/);
  assert.match(extensionSource, /: '当前：普通免费翻译'/);
  assert.match(extensionSource, /registerCommand\('cfInline\.selectTranslationMode'/);
  assert.match(extensionSource, /选择题面翻译模式/);
  assert.match(extensionSource, /当前正在使用/);
  assert.match(extensionSource, /executeCommand\('cfInline\.configureAiTranslation', \{ addNew: true \}\)/);
  assert.match(extensionSource, /savedProfiles\.length && !request\?\.addNew/);
  assert.match(extensionSource, /await selectTranslationMode\(context\)/);
  assert.match(extensionSource, /translationModeRequest/);
});

test('shows the login panel first and leaves Edge launch to its button', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');
  assert.match(source, /The first visible step is always the extension login page/);
  assert.match(source, /CfPanel\.createOrShow\(context, proxy!, edgeBridge\)/);
  assert.doesNotMatch(source, /registerCommand\('cfInline\.openLogin',[\s\S]{0,200}loginWithOfficialBrowser/);
});
