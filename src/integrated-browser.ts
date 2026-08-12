import * as vscode from 'vscode';
import { CfProxy } from './proxy';

const NATIVE_BROWSER_COMMAND = 'workbench.action.browser.open';
const SIMPLE_BROWSER_COMMAND = 'simpleBrowser.show';

interface NativeBrowserOpenOptions {
  url: string;
  reuseUrlFilter: string;
}

const pendingNativeOpens = new Map<string, Promise<void>>();

export function isCodeforcesBrowserTabLabel(label: string): boolean {
  return /^Codeforces (?:极速|正常)模式$/.test(label.trim());
}

async function closeDuplicateCodeforcesBrowserTabs(): Promise<void> {
  const tabGroups = vscode.window.tabGroups;
  const matching = tabGroups.all
    .flatMap((group) => [...group.tabs])
    .filter((tab) => isCodeforcesBrowserTabLabel(tab.label));
  if (matching.length <= 1) return;

  const active = tabGroups.activeTabGroup.activeTab;
  const keeper = active && matching.includes(active) ? active : matching[matching.length - 1];
  const duplicates = matching.filter((tab) => tab !== keeper && !tab.isDirty);
  if (duplicates.length) {
    await tabGroups.close(duplicates, true);
  }
}

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

export function integratedBrowserReuseFilter(proxy: Pick<CfProxy, 'origin'>): string {
  // VS Code treats the path in reuseUrlFilter as a glob. Match both the fast
  // and full shells, including their changing ?path= query, but never match an
  // unrelated integrated-browser tab.
  return `${proxy.origin}/__cf_inline/*`;
}

export async function openInIntegratedBrowser(proxy: CfProxy): Promise<void> {
  if (!proxy.isLoggedIn() || !proxy.isSessionReady()) {
    throw new Error('请先连接并验证 Codeforces Edge 会话');
  }

  const url = integratedBrowserUrl(proxy);
  const commands = new Set(await vscode.commands.getCommands(true));
  if (commands.has(NATIVE_BROWSER_COMMAND)) {
    const options: NativeBrowserOpenOptions = {
      url,
      reuseUrlFilter: integratedBrowserReuseFilter(proxy),
    };
    const existing = pendingNativeOpens.get(proxy.origin);
    if (existing) {
      await existing;
      return;
    }
    const opening = Promise.resolve(
      vscode.commands.executeCommand(NATIVE_BROWSER_COMMAND, options)
    ).then(() => undefined);
    pendingNativeOpens.set(proxy.origin, opening);
    try {
      await opening;
      await closeDuplicateCodeforcesBrowserTabs();
    } finally {
      if (pendingNativeOpens.get(proxy.origin) === opening) {
        pendingNativeOpens.delete(proxy.origin);
      }
    }
    return;
  }
  if (commands.has(SIMPLE_BROWSER_COMMAND)) {
    await vscode.commands.executeCommand(SIMPLE_BROWSER_COMMAND, url);
    return;
  }
  throw new Error('当前 VS Code 版本没有可用的集成浏览器，请升级 VS Code 或改用内嵌面板');
}
