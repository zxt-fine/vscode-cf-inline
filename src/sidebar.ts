import * as vscode from 'vscode';
import { CfProxy } from './proxy';

const SIDEBAR_VIEW_ID = 'cfInline.activityView';

class CfSidebarItem extends vscode.TreeItem {
  constructor(
    label: string,
    icon: string,
    description?: string,
    command?: vscode.Command,
    tooltip?: string,
    collapsibleState = vscode.TreeItemCollapsibleState.None,
    readonly children: CfSidebarItem[] = []
  ) {
    super(label, collapsibleState);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.description = description;
    this.command = command;
    this.tooltip = tooltip ?? label;
  }
}

export class CfSidebarProvider implements vscode.TreeDataProvider<CfSidebarItem>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<CfSidebarItem | undefined | void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  private readonly handleSessionChange = (): void => {
    this.changeEmitter.fire();
  };

  private lastHealth = '';
  private readonly healthTimer: NodeJS.Timeout;
  private readonly configurationListener: vscode.Disposable;

  constructor(private readonly proxy: CfProxy) {
    proxy.on('sessionChange', this.handleSessionChange);
    this.lastHealth = this.healthKey();
    this.healthTimer = setInterval(() => {
      this.proxy.refreshSessionHealth();
      const health = this.healthKey();
      if (health !== this.lastHealth) {
        this.lastHealth = health;
        this.changeEmitter.fire();
      }
    }, 1_000);
    this.healthTimer.unref?.();
    this.configurationListener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('cfInline.aiTranslationEnabled')
        || event.affectsConfiguration('cfInline.aiProvider')
        || event.affectsConfiguration('cfInline.aiEndpoint')
        || event.affectsConfiguration('cfInline.aiModel')) {
        this.changeEmitter.fire();
      }
    });
  }

  getTreeItem(element: CfSidebarItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CfSidebarItem): CfSidebarItem[] {
    if (element) {
      return element.children;
    }
    const state = this.proxy.state();
    const connected = state.loggedIn && state.sessionReady;
    const statusItem = state.loginInProgress
      ? new CfSidebarItem('正在连接 Edge…', 'sync~spin', '请在浏览器完成登录', undefined, state.loginMessage)
      : connected
        ? new CfSidebarItem('Edge 会话正常', 'pass-filled', '可浏览、翻译和提交')
        : new CfSidebarItem(
            'Edge 会话已断开',
            'error',
            '浏览、翻译和提交暂不可用',
            undefined,
            state.loginMessage || '请先重新连接 Edge'
          );

    const primaryActions = connected
      ? [
          this.action('打开 Codeforces 浏览器', 'globe', '默认进入极速模式', 'cfInline.open'),
        ]
      : [
          this.action('重新连接 Edge', 'plug', '第一步：点击后完成登录', 'cfInline.openLogin'),
          this.action('打开插件登录页面', 'sign-in', '查看连接说明与登录进度', 'cfInline.open'),
        ];

    const translationConfig = vscode.workspace.getConfiguration('cfInline');
    const aiEnabled = translationConfig.get<boolean>('aiTranslationEnabled') ?? false;
    const aiModel = translationConfig.get<string>('aiModel')?.trim() || '未选择模型';
    const aiEndpoint = translationConfig.get<string>('aiEndpoint')?.trim() || '';
    let aiService = '自定义 AI';
    if ((translationConfig.get<string>('aiProvider') ?? 'ollama') === 'ollama') aiService = 'Ollama';
    else {
      try {
        const hostname = new URL(aiEndpoint).hostname.toLowerCase();
        if (hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')) aiService = 'DeepSeek';
        else if (hostname === 'api.openai.com' || hostname.endsWith('.openai.com')) aiService = 'OpenAI';
      } catch { /* retain the custom label for an incomplete custom endpoint */ }
    }
    const translationModeItem = this.action(
      '翻译模式',
      aiEnabled ? 'sparkle-filled' : 'globe',
      aiEnabled ? `AI：${aiService} / ${aiModel}` : '普通免费翻译（DeepL 优先）',
      'cfInline.selectTranslationMode'
    );

    const secondaryActions = connected
      ? [
          this.action('个人刷题仪表盘', 'graph', '收藏、进度、Rating、标签和错误统计', 'cfInline.openDashboard'),
          this.action('配置 AI 增强翻译', 'sparkle', '可选：Ollama 或 OpenAI 兼容模型', 'cfInline.configureAiTranslation'),
          this.action('测试 AI 翻译连接', 'beaker', '验证当前接口和模型', 'cfInline.testAiTranslation'),
          this.action('重新验证 Codeforces 账号', 'account', '仅在连接异常时使用', 'cfInline.openLogin'),
        ]
      : [this.action('配置 AI 增强翻译', 'sparkle', '无需登录即可预先配置', 'cfInline.configureAiTranslation')];

    return [
      this.group('连接状态', 'pulse', [statusItem]),
      this.group('翻译设置', 'symbol-misc', [translationModeItem]),
      this.group(connected ? '常用操作' : '恢复连接', connected ? 'rocket' : 'debug-disconnect', primaryActions),
      ...(secondaryActions.length ? [this.group('其他操作', 'ellipsis', secondaryActions)] : []),
    ];
  }

  private healthKey(): string {
    const state = this.proxy.state();
    return `${state.loggedIn}:${state.sessionReady}:${state.loginInProgress}:${state.loginMessage}`;
  }

  private group(label: string, icon: string, children: CfSidebarItem[]): CfSidebarItem {
    return new CfSidebarItem(
      label,
      icon,
      undefined,
      undefined,
      label,
      vscode.TreeItemCollapsibleState.Expanded,
      children
    );
  }

  private action(label: string, icon: string, description: string, command: string): CfSidebarItem {
    return new CfSidebarItem(label, icon, description, { command, title: label }, `${label} — ${description}`);
  }

  dispose(): void {
    this.proxy.off('sessionChange', this.handleSessionChange);
    clearInterval(this.healthTimer);
    this.configurationListener.dispose();
    this.changeEmitter.dispose();
  }
}

export function registerCfSidebar(proxy: CfProxy): vscode.Disposable[] {
  const provider = new CfSidebarProvider(proxy);
  const tree = vscode.window.createTreeView(SIDEBAR_VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: false,
  });
  let opening = false;
  const visibility = tree.onDidChangeVisibility((event) => {
    if (!event.visible || opening) {
      return;
    }
    opening = true;
    void Promise.resolve(vscode.commands.executeCommand('cfInline.open')).finally(() => {
      opening = false;
    });
  });
  return [provider, tree, visibility];
}
