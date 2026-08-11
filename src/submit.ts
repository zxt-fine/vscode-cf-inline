import * as path from 'path';
import * as vscode from 'vscode';
import { request } from './net';
import { CfProxy } from './proxy';

export interface ProblemRef {
  contestId: string;
  index: string;
  kind: 'contest' | 'gym' | 'problemset' | 'group';
  groupId?: string;
}

interface SubmitPageInfo {
  csrfToken: string;
  languages: { label: string; value: string }[];
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.cpp': 'GNU++20',
  '.cc': 'GNU++20',
  '.cxx': 'GNU++20',
  '.c': 'GNU C17',
  '.py': 'PyPy 3-64',
  '.java': 'Java 21',
  '.kt': 'Kotlin',
  '.go': 'Go',
  '.rs': 'Rust 1.79',
};

export async function submitCurrentFile(
  context: vscode.ExtensionContext,
  proxy: CfProxy
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.isUntitled) {
    vscode.window.showWarningMessage('请先打开要提交的代码文件。');
    return;
  }

  const fileName = path.basename(editor.document.fileName);
  const source = editor.document.getText();
  if (!source.trim()) {
    vscode.window.showWarningMessage('当前文件是空的，不能提交。');
    return;
  }

  const problem = await resolveProblem(proxy);
  if (!problem) {
    return;
  }

  if (!proxy.isLoggedIn() || !proxy.isSessionReady()) {
    const action = await vscode.window.showWarningMessage(
      '尚未连接可用的 Codeforces Edge 会话。请先在 Codeforces Inline 面板完成登录和四项验证。',
      '打开面板'
    );
    if (action === '打开面板') {
      await vscode.commands.executeCommand('cfInline.open');
    }
    return;
  }

  const baseUrl = proxy.origin;
  const submitUrl = buildSubmitUrl(baseUrl, problem);
  const pageResp = await request({
    url: submitUrl,
    headers: { Accept: 'text/html' },
  });
  if (pageResp.statusCode >= 400) {
    throw new Error(`无法打开提交页面（HTTP ${pageResp.statusCode}）`);
  }

  const pageInfo = parseSubmitPage(pageResp.body.toString('utf8'));
  const language = await pickLanguage(context, fileName, pageInfo.languages);
  if (!language) {
    return;
  }

  const submitResp = await proxy.submitSolution({
    url: buildSubmitUrl(proxy.upstreamOrigin, problem),
    contestId: problem.contestId,
    index: problem.index,
    programTypeId: language.value,
    source,
  });

  const bodyText = submitResp.body.toString('utf8');
  if (/\/enter(?:\?|$)/.test(submitResp.finalUrl) || /id=["']enterForm["']/i.test(bodyText)) {
    throw new Error('登录已过期，请先在 Codeforces Inline 面板中重新登录。');
  }
  const error = extractSubmitError(submitResp.statusCode, bodyText);
  if (error) {
    throw new Error(error);
  }

  await context.globalState.update('cfInline.lastLanguage', language.value);
  vscode.window.showInformationMessage(
    `已提交 ${problem.contestId}${problem.index}（${fileName}），语言：${language.label}。`
  );
}

async function resolveProblem(proxy: CfProxy): Promise<ProblemRef | undefined> {
  const currentPath = proxy.currentUrlPath;
  const fromPath = parseProblemFromPath(currentPath);
  if (fromPath) {
    return fromPath;
  }

  const input = await vscode.window.showInputBox({
    prompt: '当前页面不是题目页。请输入题号（如 2050A）或完整题目 URL。',
    ignoreFocusOut: true,
  });
  if (!input) {
    return undefined;
  }
  const parsed = parseProblemInput(input);
  if (!parsed) {
    vscode.window.showWarningMessage('无法识别题号，请使用类似 2050A 或题目 URL 的格式。');
    return undefined;
  }
  return parsed;
}

export function parseProblemFromPath(pathname: string): ProblemRef | undefined {
  const group = pathname.match(
    /^\/group\/([^/]+)\/contest\/(\d+)\/problem\/([A-Za-z0-9]+)/
  );
  if (group) {
    return {
      groupId: group[1],
      contestId: group[2],
      index: group[3],
      kind: 'group',
    };
  }
  const contest = pathname.match(/^\/contest\/(\d+)\/problem\/([A-Za-z0-9]+)/);
  if (contest) {
    return { contestId: contest[1], index: contest[2], kind: 'contest' };
  }
  const gym = pathname.match(/^\/gym\/(\d+)\/problem\/([A-Za-z0-9]+)/);
  if (gym) {
    return { contestId: gym[1], index: gym[2], kind: 'gym' };
  }
  const problemset = pathname.match(/^\/problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/);
  if (problemset) {
    return { contestId: problemset[1], index: problemset[2], kind: 'problemset' };
  }
  return undefined;
}

export function parseProblemInput(input: string): ProblemRef | undefined {
  const trimmed = input.trim();
  const urlGroup = trimmed.match(
    /\/group\/([^/]+)\/contest\/(\d+)\/problem\/([A-Za-z0-9]+)/
  );
  if (urlGroup) {
    return {
      groupId: urlGroup[1],
      contestId: urlGroup[2],
      index: urlGroup[3],
      kind: 'group',
    };
  }
  const urlMatch = trimmed.match(/\/contest\/(\d+)\/problem\/([A-Za-z0-9]+)/);
  if (urlMatch) {
    return { contestId: urlMatch[1], index: urlMatch[2], kind: 'contest' };
  }
  const urlGym = trimmed.match(/\/gym\/(\d+)\/problem\/([A-Za-z0-9]+)/);
  if (urlGym) {
    return { contestId: urlGym[1], index: urlGym[2], kind: 'gym' };
  }
  const urlSet = trimmed.match(/\/problemset\/problem\/(\d+)\/([A-Za-z0-9]+)/);
  if (urlSet) {
    return { contestId: urlSet[1], index: urlSet[2], kind: 'problemset' };
  }
  const codeMatch = trimmed.match(/^(\d+)([A-Za-z0-9]{1,2})$/);
  if (codeMatch) {
    return { contestId: codeMatch[1], index: codeMatch[2], kind: 'contest' };
  }
  return undefined;
}

export function buildSubmitUrl(baseUrl: string, problem: ProblemRef): string {
  if (problem.kind === 'group' && problem.groupId) {
    return `${baseUrl}/group/${problem.groupId}/contest/${problem.contestId}/submit`;
  }
  if (problem.kind === 'problemset') {
    return `${baseUrl}/problemset/submit`;
  }
  if (problem.kind === 'gym') {
    return `${baseUrl}/gym/${problem.contestId}/submit`;
  }
  return `${baseUrl}/contest/${problem.contestId}/submit`;
}

export function parseSubmitPage(html: string): SubmitPageInfo {
  const formMatch = html.match(
    /(<form\b[^>]*class=["'][^"']*submit-form[^"']*["'][^>]*>)([\s\S]*?<\/form>)/i
  );
  if (!formMatch) {
    throw new Error('未能找到 Codeforces 提交表单，可能页面结构发生了变化。');
  }
  const formHtml = formMatch[2];

  const csrfMeta = html.match(
    /<meta[^>]+name=["']X-Csrf-Token["'][^>]+content=["']([^"']+)["']/i
  );
  const csrfInput = formHtml.match(
    /<input[^>]+name=["']csrf_token["'][^>]+value=["']([^"']*)["']/i
  );
  const csrfToken = csrfMeta?.[1] ?? csrfInput?.[1] ?? '';
  if (!csrfToken) {
    throw new Error('未能从提交页面提取 CSRF Token，可能页面结构发生了变化。');
  }

  const languages: { label: string; value: string }[] = [];
  const languageSelect = formHtml.match(
    /<select[^>]*name=["']programTypeId["'][^>]*>([\s\S]*?)<\/select>/i
  );
  if (languageSelect) {
    const optionRe = /<option\s+value=["'](\d+)["'][^>]*>([\s\S]*?)<\/option>/gi;
    let match: RegExpExecArray | null;
    while ((match = optionRe.exec(languageSelect[1]))) {
      const label = match[2].replace(/<[^>]+>/g, '').trim();
      if (label) {
        languages.push({ label, value: match[1] });
      }
    }
  }

  return { csrfToken, languages };
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/g, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

async function pickLanguage(
  context: vscode.ExtensionContext,
  fileName: string,
  languages: { label: string; value: string }[]
): Promise<{ label: string; value: string } | undefined> {
  if (languages.length === 0) {
    const manual = await vscode.window.showInputBox({
      prompt: '未能解析提交语言列表，请手动输入 Codeforces 的 programTypeId。',
      ignoreFocusOut: true,
    });
    return manual ? { label: manual, value: manual } : undefined;
  }

  const config = vscode.workspace.getConfiguration('cfInline');
  const preferred = config.get<string>('defaultLanguage') ?? 'auto';
  const extensionPreference = LANGUAGE_BY_EXTENSION[path.extname(fileName).toLowerCase()];
  const preference = preferred === 'auto' ? extensionPreference : preferred;
  const remembered = context.globalState.get<string>('cfInline.lastLanguage');

  let defaultIndex = 0;
  if (remembered) {
    defaultIndex = languages.findIndex((lang) => lang.value === remembered);
  }
  if (defaultIndex < 0 && preference) {
    defaultIndex = languages.findIndex((lang) =>
      lang.label.toLowerCase().includes(preference.toLowerCase())
    );
  }
  if (defaultIndex < 0) {
    defaultIndex = 0;
  }

  const items = languages.map((lang) => ({
    label: lang.label,
    description: '',
    value: lang.value,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: '选择提交语言，可搜索',
    matchOnDescription: true,
    ignoreFocusOut: true,
  });
  if (!picked) {
    return undefined;
  }
  return { label: picked.label, value: picked.value };
}

export function extractSubmitError(statusCode: number, body: string): string | undefined {
  if (statusCode >= 400) {
    const code = body.match(/<code\b[^>]*>([\s\S]*?)<\/code>/i);
    const detail = code ? submitHtmlText(code[1]) : '';
    return `提交请求失败（HTTP ${statusCode}）${detail ? `：${detail}` : ''}`;
  }
  // The proxy injects its own localization/submit helper script into every
  // HTML response. Never scan script source as visible Codeforces feedback,
  // otherwise the error-recognition regular expressions match themselves.
  const visibleBody = stripNonVisibleHtml(body);
  let successMessage = '';
  const errorBlockPattern = /<(?:span|div|p)[^>]*class=["'][^"']*(?:error|genericError|submit-error)[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div|p)>/gi;
  let errorBlock: RegExpExecArray | null;
  while ((errorBlock = errorBlockPattern.exec(visibleBody))) {
    const message = submitHtmlText(errorBlock[1]);
    if (message) {
      if (isSubmitSuccessMessage(message)) {
        successMessage = message;
        continue;
      }
      return `提交被拒绝：${message}`;
    }
  }
  const dataErrorPattern = /\bdata-error\s*=\s*(["'])([\s\S]*?)\1/gi;
  let dataError: RegExpExecArray | null;
  while ((dataError = dataErrorPattern.exec(visibleBody))) {
    const message = submitHtmlText(dataError[2]);
    if (message) {
      if (isSubmitSuccessMessage(message)) {
        successMessage = message;
        continue;
      }
      return `提交被拒绝：${message}`;
    }
  }
  const scriptMessage = body.match(
    /(?:Codeforces\.)?(showMessage|showError)\s*\(\s*(["'])([\s\S]*?)\2\s*\)/i
  );
  if (scriptMessage) {
    const message = submitHtmlText(
      scriptMessage[3].replace(/\\n/g, ' ').replace(/\\([\\"'])/g, '$1')
    );
    if (message) {
      if (scriptMessage[1].toLowerCase() === 'showmessage' && isSubmitSuccessMessage(message)) {
        successMessage = message;
      } else {
        return `提交被拒绝：${message}`;
      }
    }
  }
  if (/invalid csrf|csrf token/i.test(visibleBody)) {
    return '提交被拒绝：CSRF Token 失效，请刷新后重试。';
  }
  const pageText = submitHtmlText(visibleBody);
  const knownError = pageText.match(
    /(?:Source should differ from previously submitted|You have submitted (?:exactly )?the same code before|Duplicate submission|Source should be non-empty|You have no rights to submit|Contest is over|Registration is closed)[^.!?\n]*(?:[.!?]|$)/i
  );
  if (knownError) {
    return `提交被拒绝：${knownError[0].trim()}`;
  }
  if (successMessage || isSubmitSuccessMessage(pageText)) {
    return undefined;
  }
  if (/class=["'][^"']*submit-form[^"']*["']/i.test(visibleBody)) {
    return 'Codeforces 返回了提交页面，未确认提交成功。请使用网页提交并查看页面中的错误提示。';
  }
  return undefined;
}

function stripNonVisibleHtml(value: string): string {
  return value.replace(
    /<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    ' '
  );
}

export function isSubmitSuccessMessage(value: string): boolean {
  return (
    /\bSolution\s+(?:(?:to|for)\s+)?(?:the\s+)?problem\s+[A-Za-z0-9]+\s+has\s+been\s+submitted\s+successfully\b/i.test(value) ||
    /Решение\s+задачи\s+[A-Za-zА-Яа-яЁё0-9]+\s+успешно\s+отправлено\s+на\s+проверку/i.test(value)
  );
}

function submitHtmlText(value: string): string {
  return decodeHtmlAttribute(value.replace(/<[^>]+>/g, ' '))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}
