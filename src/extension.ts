import * as vscode from 'vscode';
import { loginWithOfficialBrowser } from './browser-login';
import { prefersIntegratedBrowser, openInIntegratedBrowser } from './integrated-browser';
import { CfPanel } from './panel';
import { CfProxy } from './proxy';
import { registerCfSidebar } from './sidebar';
import { submitCurrentFile } from './submit';

let proxy: CfProxy | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('cfInline');
  const configuredPath = config.get<string>('defaultPath') ?? '/';
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
  });
  await proxy.start();

  // Versions before 0.2 stored only cookies and then incorrectly presented
  // them as a reusable Cloudflare session. Remove that stale marker once;
  // the dedicated Edge profile now retains the official login safely.
  await context.secrets.delete('cfInline.session');

  context.subscriptions.push(...registerCfSidebar(proxy));

  const handleReloginRequest = (): void => {
    const activeProxy = proxy!;
    activeProxy.setLoginProgress(true, '正在打开 Edge 登录页面…');
    void loginWithOfficialBrowser(context, activeProxy, (message) => {
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
  proxy.on('reloginRequest', handleReloginRequest);

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
      CfPanel.createOrShow(context, proxy!);
    }),
    vscode.commands.registerCommand('cfInline.openIntegratedBrowser', async () => {
      try {
        if (!proxy!.isLoggedIn() || !proxy!.isSessionReady()) {
          CfPanel.createOrShow(context, proxy!);
          return;
        }
        await openInIntegratedBrowser(proxy!);
      } catch (err) {
        void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
      }
    }),
    vscode.commands.registerCommand('cfInline.openPanel', () => {
      CfPanel.createOrShow(context, proxy!);
    }),
    vscode.commands.registerCommand('cfInline.submit', async () => {
      if (!proxy!.isLoggedIn() || !proxy!.isSessionReady()) {
        CfPanel.createOrShow(context, proxy!);
        void vscode.window.showInformationMessage(
          '提交前需要连接 Codeforces。请在插件页面点击登录按钮；登录完成后不要关闭 Edge。'
        );
        return;
      }
      await submitCurrentFile(context, proxy!);
    }),
    vscode.commands.registerCommand('cfInline.openLogin', () => {
      CfPanel.createOrShow(context, proxy!);
    }),
    {
      dispose: () => {
        proxy?.off('reloginRequest', handleReloginRequest);
        void proxy?.stop();
      },
    }
  );

  // Do not start Edge during VS Code activation. A saved session is checked only
  // after the user explicitly opens this extension or requests an authenticated action.
}

export function deactivate(): void {
  // Cleanup is handled through the disposable registered during activation.
}
