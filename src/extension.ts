import * as vscode from 'vscode';
import { AiTranslationOptions, enhanceTranslationsWithAi, isOllamaModelAvailable } from './ai-translation';
import {
  ACTIVE_AI_PROFILE_STATE,
  AI_PROFILES_STATE,
  AI_PROFILE_SECRET_PREFIX,
  AiSavedProfile,
  AiService,
  aiServiceLabel,
  createAiProfile,
  detectAiService,
  normalizeAiProfiles,
  upsertAiProfile,
} from './ai-profiles';
import { EdgeBridgeServer, loginWithEdgeBridge, restoreEdgeBridgeSession, revealEdgeExtension } from './edge-bridge';
import { prefersIntegratedBrowser, openInIntegratedBrowser } from './integrated-browser';
import { CfPanel } from './panel';
import { CfProxy } from './proxy';
import { registerCfSidebar } from './sidebar';
import { parseOfficialSolvedAllTime, PracticeStore, summarizeDashboard } from './practice';

let proxy: CfProxy | undefined;
const AI_API_KEY_SECRET = 'cfInline.aiApiKey';

interface TranslationModeQuickPickItem extends vscode.QuickPickItem {
  value: 'standard' | 'profile' | 'add';
  profile?: AiSavedProfile;
}

const REMOVE_AI_PROFILE_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('trash'),
  tooltip: '移除此 AI 配置',
};

async function loadAiProfiles(context: vscode.ExtensionContext): Promise<AiSavedProfile[]> {
  let profiles = normalizeAiProfiles(context.globalState.get<unknown>(AI_PROFILES_STATE));
  const config = vscode.workspace.getConfiguration('cfInline');
  const configuredModel = config.get<string>('aiModel')?.trim() ?? '';
  const configuredEndpoint = config.get<string>('aiEndpoint')?.trim() ?? '';
  const legacyKey = await context.secrets.get(AI_API_KEY_SECRET);
  // Migrate the single configuration used by 0.10.0 into the profile list.
  // The secret remains in SecretStorage and is copied to a profile-specific
  // slot; it is never placed in globalState or settings.json.
  if (!profiles.length && configuredModel && configuredEndpoint && ((config.get<boolean>('aiTranslationEnabled') ?? false) || legacyKey)) {
    const provider = config.get<'openaiCompatible' | 'ollama'>('aiProvider') ?? 'ollama';
    const migrated = createAiProfile(
      detectAiService(provider, configuredEndpoint, configuredModel),
      provider,
      configuredEndpoint,
      configuredModel,
      Date.now(),
      0
    );
    profiles = [migrated];
    await context.globalState.update(AI_PROFILES_STATE, profiles);
    await context.globalState.update(ACTIVE_AI_PROFILE_STATE, migrated.id);
    if (legacyKey) {
      await context.secrets.store(`${AI_PROFILE_SECRET_PREFIX}${migrated.id}`, legacyKey);
      await context.secrets.delete(AI_API_KEY_SECRET);
    }
  }

  // Older profile migration could mistake the manifest's default
  // "Ollama / qwen3:8b" values for a successfully configured local model.
  // Keep only legacy profiles for which there is actual local/API evidence.
  const checked: AiSavedProfile[] = [];
  for (const profile of profiles) {
    if (profile.verifiedAt > 0) {
      checked.push(profile);
      continue;
    }
    const available = profile.provider === 'ollama'
      ? await isOllamaModelAvailable(profile.endpoint, profile.model)
      : !!(await context.secrets.get(`${AI_PROFILE_SECRET_PREFIX}${profile.id}`));
    if (available) checked.push({ ...profile, verifiedAt: Date.now() });
    else await context.secrets.delete(`${AI_PROFILE_SECRET_PREFIX}${profile.id}`);
  }
  if (checked.length !== profiles.length || checked.some((profile, index) => profile !== profiles[index])) {
    profiles = normalizeAiProfiles(checked);
    await context.globalState.update(AI_PROFILES_STATE, profiles);
  }
  const activeProfileId = context.globalState.get<string>(ACTIVE_AI_PROFILE_STATE);
  if (activeProfileId && !profiles.some((profile) => profile.id === activeProfileId)) {
    await context.globalState.update(ACTIVE_AI_PROFILE_STATE, undefined);
    await config.update('aiTranslationEnabled', false, vscode.ConfigurationTarget.Global);
    await config.update('aiProvider', undefined, vscode.ConfigurationTarget.Global);
    await config.update('aiEndpoint', undefined, vscode.ConfigurationTarget.Global);
    await config.update('aiModel', undefined, vscode.ConfigurationTarget.Global);
  }
  return profiles;
}

async function activateAiProfile(
  context: vscode.ExtensionContext,
  profile: AiSavedProfile,
  apiKey?: string
): Promise<void> {
  const config = vscode.workspace.getConfiguration('cfInline');
  const updated = { ...profile, updatedAt: Date.now() };
  const profiles = upsertAiProfile(await loadAiProfiles(context), updated);
  if (apiKey) await context.secrets.store(`${AI_PROFILE_SECRET_PREFIX}${profile.id}`, apiKey);
  await context.globalState.update(AI_PROFILES_STATE, profiles);
  await context.globalState.update(ACTIVE_AI_PROFILE_STATE, profile.id);
  await config.update('aiProvider', profile.provider, vscode.ConfigurationTarget.Global);
  await config.update('aiEndpoint', profile.endpoint, vscode.ConfigurationTarget.Global);
  await config.update('aiModel', profile.model, vscode.ConfigurationTarget.Global);
  await config.update('aiTranslationEnabled', true, vscode.ConfigurationTarget.Global);
}

async function removeAiProfile(context: vscode.ExtensionContext, profile: AiSavedProfile): Promise<void> {
  const profiles = (await loadAiProfiles(context)).filter((item) => item.id !== profile.id);
  const activeProfileId = context.globalState.get<string>(ACTIVE_AI_PROFILE_STATE);
  await context.secrets.delete(`${AI_PROFILE_SECRET_PREFIX}${profile.id}`);
  await context.globalState.update(AI_PROFILES_STATE, profiles);
  if (activeProfileId === profile.id) {
    await context.globalState.update(ACTIVE_AI_PROFILE_STATE, undefined);
    const config = vscode.workspace.getConfiguration('cfInline');
    await config.update('aiTranslationEnabled', false, vscode.ConfigurationTarget.Global);
    await config.update('aiProvider', undefined, vscode.ConfigurationTarget.Global);
    await config.update('aiEndpoint', undefined, vscode.ConfigurationTarget.Global);
    await config.update('aiModel', undefined, vscode.ConfigurationTarget.Global);
  }
}

async function selectTranslationMode(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('cfInline');
  let profiles = await loadAiProfiles(context);
  let enabled = config.get<boolean>('aiTranslationEnabled') ?? false;
  let activeProfileId = context.globalState.get<string>(ACTIVE_AI_PROFILE_STATE);
  const picker = vscode.window.createQuickPick<TranslationModeQuickPickItem>();
  picker.title = '选择题面翻译模式';
  picker.placeholder = enabled ? '当前使用 AI 增强翻译' : '当前使用普通免费翻译';
  picker.matchOnDescription = true;
  picker.matchOnDetail = false;

  const rebuildItems = (): void => {
    const standard: TranslationModeQuickPickItem = {
      label: `${!enabled ? '$(check) ' : '$(globe) '}普通免费翻译`,
      description: !enabled ? '当前正在使用' : undefined,
      value: 'standard',
    };
    const profileItems: TranslationModeQuickPickItem[] = profiles.map((profile) => ({
      label: `${enabled && profile.id === activeProfileId ? '$(check) ' : '$(sparkle) '}${aiServiceLabel(profile.service)} / ${profile.model}`,
      description: enabled && profile.id === activeProfileId ? '当前正在使用' : undefined,
      value: 'profile',
      profile,
      buttons: [REMOVE_AI_PROFILE_BUTTON],
    }));
    const add: TranslationModeQuickPickItem = {
      label: '$(add) 添加新的 AI 配置',
      value: 'add',
    };
    const items = [standard, ...profileItems, add];
    picker.items = items;
    // VS Code paints the active item blue. Set it explicitly so only the
    // actual current translation mode is highlighted, rather than whichever
    // row happens to be first in the list.
    const current = enabled
      ? profileItems.find((item) => item.profile?.id === activeProfileId)
      : standard;
    picker.activeItems = current ? [current] : [standard];
    picker.placeholder = enabled ? '当前使用 AI 增强翻译' : '当前使用普通免费翻译';
  };

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      picker.dispose();
      resolve();
    };
    picker.onDidHide(finish);
    picker.onDidTriggerItemButton(async (event) => {
      const profile = event.item.profile;
      if (event.button !== REMOVE_AI_PROFILE_BUTTON || !profile) return;
      const confirmation = await vscode.window.showWarningMessage(
        `确定移除“${aiServiceLabel(profile.service)} / ${profile.model}”吗？配置及对应 API Key 将被删除。`,
        { modal: true },
        '移除'
      );
      if (confirmation !== '移除') return;
      await removeAiProfile(context, profile);
      profiles = profiles.filter((item) => item.id !== profile.id);
      if (activeProfileId === profile.id) {
        activeProfileId = undefined;
        enabled = false;
      }
      rebuildItems();
      void vscode.window.showInformationMessage(
        enabled
          ? '已移除 AI 配置'
          : '已移除 AI 配置并切换为普通免费翻译'
      );
    });
    picker.onDidAccept(async () => {
      const choice = picker.activeItems[0];
      if (!choice) return;
      if (choice.value === 'standard') {
        await config.update('aiTranslationEnabled', false, vscode.ConfigurationTarget.Global);
        picker.hide();
        void vscode.window.showInformationMessage('已切换为普通免费翻译');
        return;
      }
      if (choice.value === 'add') {
        picker.hide();
        await vscode.commands.executeCommand('cfInline.configureAiTranslation', { addNew: true });
        return;
      }
      const selected = choice.profile;
      if (!selected) return;
      const key = await context.secrets.get(`${AI_PROFILE_SECRET_PREFIX}${selected.id}`);
      if (selected.provider === 'openaiCompatible' && !key) {
        void vscode.window.showWarningMessage(`“${aiServiceLabel(selected.service)} / ${selected.model}”的 API Key 已缺失，请重新添加该配置。`);
        return;
      }
      await activateAiProfile(context, selected, key);
      picker.hide();
      void vscode.window.showInformationMessage('已切换为 AI 增强翻译');
    });
    rebuildItems();
    picker.show();
  });
}

async function readAiOptions(context: vscode.ExtensionContext): Promise<AiTranslationOptions> {
  const config = vscode.workspace.getConfiguration('cfInline');
  const provider = config.get<'openaiCompatible' | 'ollama'>('aiProvider') ?? 'ollama';
  const activeProfileId = context.globalState.get<string>(ACTIVE_AI_PROFILE_STATE);
  const profileKey = activeProfileId
    ? await context.secrets.get(`${AI_PROFILE_SECRET_PREFIX}${activeProfileId}`)
    : undefined;
  return {
    enabled: config.get<boolean>('aiTranslationEnabled') ?? false,
    provider,
    endpoint: config.get<string>('aiEndpoint') ?? '',
    model: config.get<string>('aiModel') ?? '',
    apiKey: profileKey ?? await context.secrets.get(AI_API_KEY_SECRET),
    timeoutMs: config.get<number>('aiTimeoutMs') ?? 60_000,
  };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('cfInline');
  await loadAiProfiles(context);
  const configuredPath = config.get<string>('defaultPath') ?? '/';
  let lastAiWarning = '';
  let lastAiWarningAt = 0;
  const practiceStore = new PracticeStore(context.globalState);
  proxy = new CfProxy({
    baseUrl: 'https://codeforces.com',
    // Migrate the former default to the account-specific group list on upgrade.
    defaultPath:
      configuredPath === '/groups' || configuredPath === '/groups/withMe'
        ? '/groups/my'
        : configuredPath,
    port: config.get<number>('proxyPort') ?? 0,
    localizeInterface: config.get<boolean>('localizeInterface') ?? true,
    autoTranslateStatements: config.get<boolean>('autoTranslateStatements') ?? true,
    fastMode: config.get<boolean>('fastMode') ?? true,
    writeClipboardText: async (text) => { await vscode.env.clipboard.writeText(text); },
    enhanceTranslations: async (sources, drafts) => {
      const options = await readAiOptions(context);
      if (!options.enabled) return drafts;
      try {
        return await enhanceTranslationsWithAi(sources, drafts, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const fallback = vscode.workspace.getConfiguration('cfInline').get<boolean>('aiFallbackToStandard') ?? true;
        if (!fallback) throw err;
        if (message !== lastAiWarning || Date.now() - lastAiWarningAt > 60_000) {
          lastAiWarning = message;
          lastAiWarningAt = Date.now();
          void vscode.window.showWarningMessage(`AI 增强翻译暂不可用，已使用普通译文：${message}`);
        }
        return drafts;
      }
    },
    practice: {
      getProblem: (contestId, index) => practiceStore.getProblem(contestId, index),
      saveProblem: (input) => practiceStore.saveProblem(input),
      deleteProblem: (contestId, index) => practiceStore.deleteProblem(contestId, index),
      dashboard: () => {
        const data = practiceStore.snapshot();
        return { data, summary: summarizeDashboard(data) };
      },
      sync: async (handle) => {
        const [response, profileResult] = await Promise.all([
          fetch(`${proxy!.origin}/api/user.status?handle=${encodeURIComponent(handle)}&from=1&count=10000`, { signal: AbortSignal.timeout(35_000) }),
          fetch(`${proxy!.origin}/profile/${encodeURIComponent(handle)}`, {
            headers: { Accept: 'text/html,application/xhtml+xml' },
            signal: AbortSignal.timeout(35_000),
          }).then(async (profileResponse) => profileResponse.ok ? parseOfficialSolvedAllTime(await profileResponse.text()) : undefined)
            .catch(() => undefined),
        ]);
        if (!response.ok) {
          throw new Error(`Codeforces API 返回 HTTP ${response.status}`);
        }
        const payload = await response.json() as { status?: string; comment?: string; result?: unknown };
        if (payload.status !== 'OK' || !Array.isArray(payload.result)) {
          throw new Error(payload.comment || 'Codeforces API 返回的数据无效');
        }
        const imported = await practiceStore.importSubmissions(handle, payload.result, profileResult);
        const data = practiceStore.snapshot();
        return { imported, data, summary: summarizeDashboard(data) };
      },
    },
  });
  await proxy.start();
  const edgeBridge = new EdgeBridgeServer();
  await edgeBridge.start();
  context.subscriptions.push(edgeBridge);

  // Versions before 0.2 stored only cookies and then incorrectly presented
  // them as a reusable Cloudflare session. Remove that stale marker once;
  // the dedicated Edge profile now retains the official login safely.
  await context.secrets.delete('cfInline.session');

  const handleReloginRequest = (): void => {
    const activeProxy = proxy!;
    activeProxy.setLoginProgress(true, '正在连接 Edge 会话…');
    void loginWithEdgeBridge(edgeBridge, activeProxy, (message) => {
      activeProxy.setLoginProgress(true, message);
    }).then(
      () => {
        activeProxy.setLoginProgress(false, '登录完成，正在恢复当前页面…');
      },
      (err) => {
        const message = err instanceof Error ? err.message : String(err);
        activeProxy.setLoginProgress(false, `登录失败：${message}`);
        void vscode.window.showErrorMessage(`Codeforces 重新登录失败：${message}`);
      }
    );
  };
  const handleTranslationModeRequest = (): void => {
    void vscode.commands.executeCommand('cfInline.selectTranslationMode');
  };
  proxy.on('reloginRequest', handleReloginRequest);
  proxy.on('translationModeRequest', handleTranslationModeRequest);
  edgeBridge.on('disconnect', () => proxy?.notifyTransportClosed());
  edgeBridge.on('connect', () => {
    if (!proxy?.isSessionReady()) void restoreEdgeBridgeSession(edgeBridge, proxy!);
  });
  edgeBridge.on('session', () => {
    if (!proxy?.isSessionReady() && edgeBridge.sessionSnapshot) void restoreEdgeBridgeSession(edgeBridge, proxy!);
  });
  edgeBridge.on('incompatible', (message: string) => {
    proxy?.setLoginProgress(false, message);
    void vscode.window.showErrorMessage(message);
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('cfInline.open', async () => {
      if (prefersIntegratedBrowser() && proxy!.isLoggedIn() && proxy!.isSessionReady()) {
        try {
          await openInIntegratedBrowser(proxy!);
          return;
        } catch (err) {
          void vscode.window.showWarningMessage(
            `无法打开 VS Code 集成浏览器，将改用内嵌面板：${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
      // The first visible step is always the extension login page. Edge is
      // launched only after the user presses its login button.
      CfPanel.createOrShow(context, proxy!, edgeBridge);
    }),
    vscode.commands.registerCommand('cfInline.openIntegratedBrowser', async () => {
      try {
        if (!proxy!.isLoggedIn() || !proxy!.isSessionReady()) {
          CfPanel.createOrShow(context, proxy!, edgeBridge);
          return;
        }
        await openInIntegratedBrowser(proxy!);
      } catch (err) {
        void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
      }
    }),
    vscode.commands.registerCommand('cfInline.openPanel', () => {
      CfPanel.createOrShow(context, proxy!, edgeBridge);
    }),
    vscode.commands.registerCommand('cfInline.openLogin', () => {
      CfPanel.createOrShow(context, proxy!, edgeBridge);
    }),
    vscode.commands.registerCommand('cfInline.installEdgeExtension', () => revealEdgeExtension(context)),
    vscode.commands.registerCommand('cfInline.openDashboard', async () => {
      await vscode.commands.executeCommand('simpleBrowser.show', `${proxy!.origin}/__cf_inline/dashboard`);
    }),
    vscode.commands.registerCommand('cfInline.selectTranslationMode', async () => {
      await selectTranslationMode(context);
    }),
    vscode.commands.registerCommand('cfInline.configureAiTranslation', async (request?: { addNew?: boolean }) => {
      const config = vscode.workspace.getConfiguration('cfInline');
      const currentProvider = config.get<string>('aiProvider') ?? 'ollama';
      const aiEnabled = config.get<boolean>('aiTranslationEnabled') ?? false;
      const savedProfiles = await loadAiProfiles(context);
      if (savedProfiles.length && !request?.addNew) {
        await selectTranslationMode(context);
        return;
      }
      const service = await vscode.window.showQuickPick([
        { label: 'DeepSeek', value: 'deepseek' },
        { label: '本地 Ollama（免费）', value: 'ollama', detail: '连接 http://127.0.0.1:11434' },
        { label: 'OpenAI', value: 'openai' },
        { label: '自定义 OpenAI 兼容 API', value: 'custom', detail: '其他兼容 Chat Completions 的服务商或自建服务' },
        { label: '关闭 AI 增强翻译', value: 'disabled', detail: '恢复普通免费快速翻译，不删除已保存的模型配置或密钥' },
      ], {
        title: '选择 AI 增强翻译服务',
        placeHolder: aiEnabled
          ? (currentProvider === 'ollama' ? '当前：本地 Ollama' : '当前：在线 AI')
          : '当前：普通免费翻译',
      });
      if (!service) return;
      if (service.value === 'disabled') {
        await config.update('aiTranslationEnabled', false, vscode.ConfigurationTarget.Global);
        void vscode.window.showInformationMessage('已切换为普通免费翻译');
        return;
      }
      let protocol: 'ollama' | 'openaiCompatible';
      let endpoint: string;
      if (service.value === 'custom') {
        protocol = 'openaiCompatible';
        const customEndpoint = await vscode.window.showInputBox({
          title: '自定义 AI 接口地址',
          prompt: '填写服务根地址或完整的 chat/completions 地址',
          value: config.get<string>('aiEndpoint') || 'https://api.example.com/v1',
          validateInput: (value) => value.trim() ? undefined : '接口地址不能为空',
          ignoreFocusOut: true,
        });
        if (customEndpoint === undefined) return;
        endpoint = customEndpoint.trim();
      } else {
        protocol = service.value === 'ollama' ? 'ollama' : 'openaiCompatible';
        endpoint = service.value === 'deepseek'
          ? 'https://api.deepseek.com/v1'
          : service.value === 'openai'
            ? 'https://api.openai.com/v1'
            : 'http://127.0.0.1:11434';
      }
      const enteredModel = await vscode.window.showInputBox({
        title: `填写 ${service.label} 模型名称`,
        prompt: '请填写接口实际支持的模型 ID',
        value: '',
        validateInput: (value) => value.trim() ? undefined : '模型名称不能为空',
        ignoreFocusOut: true,
      });
      if (enteredModel === undefined) return;
      const model = enteredModel.trim();
      let apiKey: string | undefined;
      if (protocol === 'openaiCompatible') {
        const enteredKey = await vscode.window.showInputBox({
          title: `填写 ${service.label} API Key`,
          prompt: '插件会立即验证；验证成功后才会安全保存并启用 AI 翻译',
          password: true,
          validateInput: (value) => value.trim() ? undefined : 'API Key 不能为空',
          ignoreFocusOut: true,
        });
        if (enteredKey === undefined) return;
        apiKey = enteredKey.trim();
      }
      const candidate: AiTranslationOptions = {
        enabled: true,
        provider: protocol,
        endpoint,
        model,
        apiKey,
        timeoutMs: config.get<number>('aiTimeoutMs') ?? 60_000,
      };
      try {
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `正在验证 ${service.label} / ${model}…`,
        }, async () => enhanceTranslationsWithAi(
          [`AI translation configuration verification ${Date.now()}. Reply using the requested JSON format.`],
          ['AI 翻译配置验证。'],
          candidate
        ));
        const profile = createAiProfile(service.value as AiService, protocol, endpoint, model);
        await activateAiProfile(context, profile, apiKey);
        void vscode.window.showInformationMessage('AI 增强翻译已启用');
      } catch (err) {
        void vscode.window.showErrorMessage(`配置未保存，API 验证失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }),
    vscode.commands.registerCommand('cfInline.setAiApiKey', async () => {
      const options = await readAiOptions(context);
      const activeProfileId = context.globalState.get<string>(ACTIVE_AI_PROFILE_STATE);
      if (!options.enabled || options.provider !== 'openaiCompatible' || !activeProfileId) {
        void vscode.window.showWarningMessage('请先配置并启用在线 AI 翻译');
        return;
      }
      const value = await vscode.window.showInputBox({
        title: '更新并验证 AI API Key',
        prompt: '验证成功后才会安全保存并用于 AI 翻译',
        password: true,
        ignoreFocusOut: true,
      });
      if (value === undefined) return;
      if (!value.trim()) {
        void vscode.window.showWarningMessage('API Key 不能为空；如需删除请执行“清除 AI API Key”。');
        return;
      }
      const apiKey = value.trim();
      try {
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: '正在验证 AI API Key…',
        }, async () => enhanceTranslationsWithAi(
          [`AI API key verification ${Date.now()}. Reply using the requested JSON format.`],
          ['AI API Key 验证。'],
          { ...options, apiKey }
        ));
        await context.secrets.store(AI_API_KEY_SECRET, apiKey);
        await context.secrets.store(`${AI_PROFILE_SECRET_PREFIX}${activeProfileId}`, apiKey);
        void vscode.window.showInformationMessage('AI API Key 已验证并保存');
      } catch (err) {
        void vscode.window.showErrorMessage(`API Key 验证失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }),
    vscode.commands.registerCommand('cfInline.clearAiApiKey', async () => {
      await context.secrets.delete(AI_API_KEY_SECRET);
      const activeProfileId = context.globalState.get<string>(ACTIVE_AI_PROFILE_STATE);
      if (activeProfileId) await context.secrets.delete(`${AI_PROFILE_SECRET_PREFIX}${activeProfileId}`);
      void vscode.window.showInformationMessage('AI API Key 已清除。');
    }),
    vscode.commands.registerCommand('cfInline.testAiTranslation', async () => {
      const options = await readAiOptions(context);
      if (!options.enabled) {
        void vscode.window.showWarningMessage('请先启用并配置 AI 增强翻译。');
        return;
      }
      try {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `正在测试 AI 模型 ${options.model}…` }, async () => {
          await enhanceTranslationsWithAi(
            ['On each turn, the player may swap the values, or pass.'],
            ['每回合，玩家可以交换这些值，或者通过。'],
            options
          );
          void vscode.window.showInformationMessage('AI 增强翻译连接正常');
        });
      } catch (err) {
        void vscode.window.showErrorMessage(`AI 增强翻译连接失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }),
    {
      dispose: () => {
        proxy?.off('reloginRequest', handleReloginRequest);
        proxy?.off('translationModeRequest', handleTranslationModeRequest);
        void proxy?.stop();
      },
    }
  );

  // Register the activity-bar click handler only after cfInline.open exists,
  // so the very first click after installation can open the editor page.
  context.subscriptions.push(...registerCfSidebar(proxy));

  // Do not open Edge during VS Code activation. The lightweight bridge may
  // reconnect itself, but visible login pages require an explicit user action.
}

export function deactivate(): void {
  // Cleanup is handled through the disposable registered during activation.
}
