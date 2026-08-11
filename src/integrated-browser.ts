import * as vscode from 'vscode';
import { CfProxy } from './proxy';

const NATIVE_BROWSER_COMMAND = 'workbench.action.browser.open';
const SIMPLE_BROWSER_COMMAND = 'simpleBrowser.show';

export function prefersIntegratedBrowser(): boolean {
  return vscode.workspace
    .getConfiguration('cfInline')
    .get<string>('viewer', 'integratedBrowser') === 'integratedBrowser';
}

export function prefersFastMode(): boolean {
  return vscode.workspace.getConfiguration('cfInline').get<boolean>('fastMode', true);
}

export function integratedBrowserUrl(
  proxy: Pick<CfProxy, 'origin' | 'currentUrlPath'>,
  fastMode = prefersFastMode()
): string {
  if (fastMode) {
    return `${proxy.origin}/__cf_inline/fast`;
  }
  return `${proxy.origin}/__cf_inline/full`;
}

export async function openInIntegratedBrowser(proxy: CfProxy): Promise<void> {
  if (!proxy.isLoggedIn() || !proxy.isSessionReady()) {
    throw new Error('请先连接并验证 Codeforces Edge 会话');
  }

  const url = integratedBrowserUrl(proxy);
  const commands = new Set(await vscode.commands.getCommands(true));
  if (commands.has(NATIVE_BROWSER_COMMAND)) {
    await vscode.commands.executeCommand(NATIVE_BROWSER_COMMAND, url);
    return;
  }
  if (commands.has(SIMPLE_BROWSER_COMMAND)) {
    await vscode.commands.executeCommand(SIMPLE_BROWSER_COMMAND, url);
    return;
  }
  throw new Error('当前 VS Code 版本没有可用的集成浏览器，请升级 VS Code 或改用内嵌面板');
}
