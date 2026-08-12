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
          this.action('提交当前编辑器代码', 'cloud-upload', '提交当前打开的代码文件', 'cfInline.submit'),
        ]
      : [
          this.action('重新连接 Edge', 'plug', '第一步：点击后完成登录', 'cfInline.openLogin'),
          this.action('打开插件登录页面', 'sign-in', '查看连接说明与登录进度', 'cfInline.open'),
        ];

    const secondaryActions = connected
      ? [this.action('重新验证 Codeforces 账号', 'account', '仅在连接异常时使用', 'cfInline.openLogin')]
      : [];

    return [
      this.group('连接状态', 'pulse', [statusItem]),
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
