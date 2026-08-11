import * as vscode from 'vscode';
import { CfProxy } from './proxy';

const SIDEBAR_VIEW_ID = 'cfInline.sidebar';

class CfSidebarItem extends vscode.TreeItem {
  constructor(
    label: string,
    icon: string,
    description?: string,
    command?: vscode.Command,
    tooltip?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
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

  constructor(private readonly proxy: CfProxy) {
    proxy.on('sessionChange', this.handleSessionChange);
  }

  getTreeItem(element: CfSidebarItem): vscode.TreeItem {
    return element;
  }

  getChildren(): CfSidebarItem[] {
    const state = this.proxy.state();
    const connected = state.loggedIn && state.sessionReady;
    const status = state.loginInProgress
      ? new CfSidebarItem('正在登录 Codeforces…', 'sync~spin', undefined, undefined, state.loginMessage)
      : connected
        ? new CfSidebarItem('Codeforces 已连接', 'pass-filled', '可浏览和提交')
        : new CfSidebarItem('Codeforces 未连接', 'warning', '需要登录', undefined, state.loginMessage || '点击下方按钮登录');

    return [
      status,
      new CfSidebarItem(
        '打开 Codeforces',
        'globe',
        '极速模式',
        { command: 'cfInline.open', title: '打开 Codeforces' },
        '在 VS Code 中打开 Codeforces'
      ),
      new CfSidebarItem(
        connected ? '重新登录或恢复连接' : '登录并连接',
        'account',
        undefined,
        { command: 'cfInline.openLogin', title: '登录并连接' },
        '打开插件登录页面；只有点击登录按钮后才会启动 Edge'
      ),
      new CfSidebarItem(
        '提交当前代码文件',
        'cloud-upload',
        undefined,
        { command: 'cfInline.submit', title: '提交当前代码文件' },
        '将当前编辑器中的代码提交到 Codeforces'
      ),
    ];
  }

  dispose(): void {
    this.proxy.off('sessionChange', this.handleSessionChange);
    this.changeEmitter.dispose();
  }
}

export function registerCfSidebar(proxy: CfProxy): vscode.Disposable[] {
  const provider = new CfSidebarProvider(proxy);
  return [provider, vscode.window.registerTreeDataProvider(SIDEBAR_VIEW_ID, provider)];
}
