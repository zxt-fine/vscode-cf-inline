import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import WebSocket, { RawData } from 'ws';
import {
  buildPageZoomClientScript,
  CONTROLLED_CODEFORCES_DESKTOP_CSS,
  translateHtmlItems,
  TranslationHttpRequest,
  UI_TRANSLATIONS,
} from './localization';
import { request as directHttpRequest } from './net';
import {
  BrowserCookie,
  CfBrowserSubmissionRequest,
  CfProxy,
  CfTransportRequest,
  CfTransportResponse,
  CfUpstreamTransport,
} from './proxy';

interface DevToolsVersion {
  webSocketDebuggerUrl: string;
}

interface DevToolsTarget {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

interface CdpResponse {
  id?: number;
  result?: unknown;
  error?: { message?: string };
}

interface CookieResult {
  cookies: BrowserCookie[];
}

interface BrowserVersion {
  userAgent: string;
}

export interface CapturedBrowserSession {
  cookies: BrowserCookie[];
  userAgent: string;
  transport: CfUpstreamTransport;
}

export interface CaptureOptions {
  isCancelled: () => boolean;
  onStatus?: (message: string) => void;
  profileDirectory?: string;
  background?: boolean;
  timeoutMs?: number;
}

const MY_GROUPS_PATH = '/groups/my';
const LOGIN_URL = `https://codeforces.com/enter?back=${encodeURIComponent(MY_GROUPS_PATH)}`;
let activeLogin: Promise<void> | undefined;
let activeRestore: Promise<boolean> | undefined;
let activeLoginStatus: string | undefined;
let activeLoginStatusBar: vscode.StatusBarItem | undefined;
const activeLoginStatusListeners = new Set<(message: string) => void>();

function reportActiveLoginStatus(message: string): void {
  activeLoginStatus = message;
  if (activeLoginStatusBar) {
    activeLoginStatusBar.text = `$(sync~spin) Codeforces：${message}`;
    activeLoginStatusBar.tooltip = `Codeforces 登录进度\n\n${message}`;
    activeLoginStatusBar.show();
  }
  for (const listener of activeLoginStatusListeners) {
    listener(message);
  }
}

function startActiveLoginStatusBar(): void {
  activeLoginStatusBar?.dispose();
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.name = 'Codeforces 登录进度';
  activeLoginStatusBar = item;
  reportActiveLoginStatus('正在准备 Edge 登录窗口；登录完成后请勿关闭 Edge…');
}

function finishActiveLoginStatusBar(success: boolean, message: string): void {
  const item = activeLoginStatusBar;
  if (!item) {
    return;
  }
  item.text = `${success ? '$(check)' : '$(error)'} Codeforces：${message}`;
  item.tooltip = message;
  item.show();
  const timer = setTimeout(() => {
    if (activeLoginStatusBar === item) {
      activeLoginStatusBar = undefined;
    }
    item.dispose();
  }, success ? 4000 : 8000);
  timer.unref();
}

function subscribeToActiveLoginStatus(
  listener?: (message: string) => void
): () => void {
  if (!listener) {
    return () => undefined;
  }
  activeLoginStatusListeners.add(listener);
  if (activeLoginStatus) {
    listener(activeLoginStatus);
  }
  return () => activeLoginStatusListeners.delete(listener);
}

export function buildBrowserArguments(
  profileDir: string,
  port: number,
  background = false
): string[] {
  return [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    ...(background
      ? ['--start-minimized']
      : ['--window-size=1200,800', '--window-position=80,50']),
    '--new-window',
    LOGIN_URL,
  ];
}

export async function captureCodeforcesSession(
  options: CaptureOptions
): Promise<CapturedBrowserSession> {
  const executable = await findEdgeExecutable();
  if (!executable) {
    throw new Error('未找到 Microsoft Edge，无法启动安全的 Codeforces 登录窗口。');
  }

  const temporaryProfile = !options.profileDirectory;
  const profileDir = options.profileDirectory
    ? path.resolve(options.profileDirectory)
    : await fs.mkdtemp(path.join(os.tmpdir(), 'cf-inline-login-'));
  await fs.mkdir(profileDir, { recursive: true });
  const port = await reservePort();
  let browserProcess: ChildProcess | undefined;
  let browserClient: CdpClient | undefined;
  let keepBrowserAlive = false;

  try {
    options.onStatus?.(
      options.background ? '正在恢复已保存的 Codeforces 会话…' : '正在打开 Codeforces 官方登录页面…'
    );
    browserProcess = spawn(
      executable,
      buildBrowserArguments(profileDir, port, options.background),
      { stdio: 'ignore', windowsHide: options.background ?? false }
    );
    browserProcess.on('error', () => undefined);

    const debuggerInfo = await waitForBrowserDebugger(port, options);
    browserClient = await CdpClient.connect(debuggerInfo.webSocketDebuggerUrl);
    const version = (await browserClient.send('Browser.getVersion')) as BrowserVersion;
    if (!/\bEdg\//i.test(version.userAgent)) {
      throw new Error('已启动的浏览器不是 Microsoft Edge，已停止建立 Codeforces 会话。');
    }
    options.onStatus?.('已确认 Microsoft Edge（插件专用受控配置，扩展和同步保持关闭）。');

    if (!options.background) {
      let appearanceClient: CdpClient | undefined;
      try {
        const appearanceTarget = await waitForCodeforcesPageTarget(port);
        appearanceClient = await CdpClient.connect(appearanceTarget.webSocketDebuggerUrl!);
        await installControlledEdgeAppearance(appearanceClient);
      } catch {
        // Appearance enhancement is retried after login and must never block authentication.
      } finally {
        appearanceClient?.close();
      }
    }

    options.onStatus?.(
      options.background
        ? '正在验证已保存的账号和主要入口…'
        : '请在浏览器中完成人机验证和登录；登录完成后请勿关闭 Edge，插件需要它在后台保持连接。'
    );
    const startedAt = Date.now();
    const deadline = startedAt + (options.timeoutMs ?? 10 * 60 * 1000);
    const observedCookieNames = new Set<string>();
    let nextVerificationAt = 0;
    while (Date.now() < deadline) {
      if (options.isCancelled()) {
        throw new Error('已取消 Codeforces 登录。');
      }
      const result = (await browserClient.send('Storage.getCookies')) as CookieResult;
      const codeforcesCookies = result.cookies.filter(isCodeforcesCookie);
      for (const cookie of codeforcesCookies) {
        observedCookieNames.add(cookie.name);
      }
      if (
        options.background &&
        Date.now() - startedAt >= 5_000 &&
        !hasLoggedInCookie(codeforcesCookies)
      ) {
        throw new Error('已保存的 Codeforces 登录状态已失效');
      }
      if (hasLoggedInCookie(codeforcesCookies) && Date.now() >= nextVerificationAt) {
        nextVerificationAt = Date.now() + 3000;
        options.onStatus?.('已检测到账号，正在逐项验证 Edge 会话…');
        let transport: EdgeBrowserTransport | undefined;
        try {
          const target = await waitForCodeforcesPageTarget(port);
          const pageClient = await CdpClient.connect(target.webSocketDebuggerUrl!);
          await installControlledEdgeAppearance(pageClient);
          transport = new EdgeBrowserTransport(
            browserProcess,
            profileDir,
            browserClient,
            pageClient,
            target.id,
            port,
            temporaryProfile
          );
          await transport.verifySession((message) => options.onStatus?.(message));
          options.onStatus?.('账号验证完成，正在最小化 Edge 并建立安全会话…');
          await transport.minimizeWindow();
          keepBrowserAlive = true;
          return {
            cookies: codeforcesCookies,
            userAgent: version.userAgent,
            transport,
          };
        } catch (err) {
          transport?.closePageClient();
          options.onStatus?.(
            `登录已检测到，但 Edge 会话尚未通过验证：${errorMessage(err)}。请保留此窗口，插件会继续重试。`
          );
        }
      }
      await delay(1000);
    }
    const observed = [...observedCookieNames].sort().join(', ') || '无';
    throw new Error(
      `等待 Codeforces 登录超时，未检测到有效登录 Cookie。已检测到的 Codeforces Cookie：${observed}`
    );
  } finally {
    if (!keepBrowserAlive && browserClient) {
      try {
        await browserClient.send('Browser.close');
      } catch {
        // The user may already have closed the temporary browser window.
      }
      browserClient.close();
    }
    if (!keepBrowserAlive && browserProcess && browserProcess.exitCode === null) {
      browserProcess.kill();
      await waitForProcessExit(browserProcess, 5000);
    }
    if (!keepBrowserAlive && temporaryProfile) {
      await cleanupProfile(profileDir);
    }
  }
}

function warmTranslationSession(transport: CfUpstreamTransport): void {
  if (!transport.translateHtmlItems) {
    return;
  }
  // Do not put Bing session establishment on the first problem's critical
  // path. This runs only after Edge login has already been requested and
  // verified; failures remain silent because normal translation still has its
  // own provider fallback and error reporting.
  const timer = setTimeout(() => {
    void transport
      .translateHtmlItems!(['Codeforces translation service warm-up.'])
      .catch(() => undefined);
  }, 1200);
  timer.unref();
}

export function loginWithOfficialBrowser(
  context: vscode.ExtensionContext,
  proxy: CfProxy,
  onStatus?: (message: string) => void
): Promise<void> {
  if (activeLogin) {
    const unsubscribe = subscribeToActiveLoginStatus(onStatus);
    return activeLogin.finally(unsubscribe);
  }
  if (proxy.isLoggedIn() && proxy.isSessionReady()) {
    onStatus?.('Codeforces 会话已经连接并验证通过。');
    return Promise.resolve();
  }
  activeLoginStatus = undefined;
  const unsubscribe = subscribeToActiveLoginStatus(onStatus);
  startActiveLoginStatusBar();
  const login = Promise.resolve(vscode.window.withProgress(
    {
      // VS Code renders notification progress as an overlay. It does not
      // resize or navigate the Codeforces editor, so maximized/fullscreen
      // browser state remains independent from the visible login reminder.
      location: vscode.ProgressLocation.Notification,
      title: 'Codeforces 登录',
      cancellable: true,
    },
    async (progress, token) => {
      await proxy.detachTransport();
      const profileDirectory = path.join(context.globalStorageUri.fsPath, 'edge-profile');
      const session = await captureCodeforcesSession({
        isCancelled: () => token.isCancellationRequested,
        onStatus: (message) => {
          reportActiveLoginStatus(message);
          progress.report({ message });
        },
        profileDirectory,
      });
      try {
        reportActiveLoginStatus('验证完成，正在连接 Codeforces 会话…');
        proxy.attachBrowserSession(session.cookies, session.userAgent, session.transport);
        warmTranslationSession(session.transport);
        reportActiveLoginStatus('Codeforces 会话已连接，正在打开页面…');
      } catch (err) {
        await session.transport.dispose();
        throw err;
      }
    }
  ));
  activeLogin = login;
  void login.then(
    () => finishActiveLoginStatusBar(true, '登录验证完成，会话已经连接'),
    (err) => finishActiveLoginStatusBar(false, `登录失败：${errorMessage(err)}`)
  );
  return login.finally(() => {
    unsubscribe();
    if (activeLogin === login) {
      activeLogin = undefined;
      activeLoginStatus = undefined;
    }
  });
}

export function restoreSavedBrowserSession(
  context: vscode.ExtensionContext,
  proxy: CfProxy
): Promise<boolean> {
  if (proxy.isLoggedIn() && proxy.isSessionReady()) {
    return Promise.resolve(true);
  }
  if (activeRestore) {
    return activeRestore;
  }
  if (activeLogin) {
    return activeLogin.then(
      () => proxy.isLoggedIn() && proxy.isSessionReady(),
      () => false
    );
  }
  const restore = (async () => {
    const profileDirectory = path.join(context.globalStorageUri.fsPath, 'edge-profile');
    try {
      await fs.access(path.join(profileDirectory, 'Local State'));
    } catch {
      return false;
    }
    await proxy.detachTransport();
    let session: CapturedBrowserSession | undefined;
    try {
      session = await captureCodeforcesSession({
        isCancelled: () => false,
        profileDirectory,
        background: true,
        timeoutMs: 25_000,
      });
      proxy.attachBrowserSession(session.cookies, session.userAgent, session.transport);
      warmTranslationSession(session.transport);
      return true;
    } catch {
      if (session) {
        await session.transport.dispose();
      }
      return false;
    }
  })();
  activeRestore = restore;
  return restore.finally(() => {
    if (activeRestore === restore) {
      activeRestore = undefined;
    }
  });
}

class CdpClient {
  private nextId = 1;
  private closed = false;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout }
  >();

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data: RawData) => this.handleMessage(data));
    socket.on('close', () => {
      this.closed = true;
      this.rejectPending(new Error('浏览器登录窗口已关闭。'));
    });
    socket.on('error', (err) => {
      this.closed = true;
      this.rejectPending(err);
    });
  }

  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连接浏览器登录窗口超时。')), 10000);
      socket.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    return new CdpClient(socket);
  }

  send(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = 10000
  ): Promise<unknown> {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('浏览器登录窗口已关闭。'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`浏览器操作超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }), (err) => {
        if (!err) {
          return;
        }
        const pending = this.pending.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(id);
          pending.reject(err);
        }
      });
    });
  }

  close(): void {
    this.closed = true;
    this.socket.close();
  }

  isOpen(): boolean {
    return !this.closed && this.socket.readyState === WebSocket.OPEN;
  }

  private handleMessage(data: RawData): void {
    let message: CdpResponse;
    try {
      message = JSON.parse(data.toString()) as CdpResponse;
    } catch {
      return;
    }
    if (!message.id) {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message ?? '浏览器操作失败。'));
    } else {
      pending.resolve(message.result);
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

interface RuntimeEvaluationResult {
  result?: { value?: BrowserFetchResult };
  exceptionDetails?: { text?: string };
}

interface BrowserFetchResult {
  error?: string;
  status?: number;
  headers?: Record<string, string>;
  bodyBase64?: string;
  finalUrl?: string;
}

interface SubmissionPageState {
  url?: string;
  title?: string;
  readyState?: string;
  hasForm?: boolean;
  ftaa?: string;
  bfaa?: string;
  action?: string;
  turnstileRequired?: boolean;
  turnstileToken?: string;
  loginRequired?: boolean;
  challenged?: boolean;
}

const MAX_CONCURRENT_BROWSER_REQUESTS = 12;

interface BrowserRequestWaiter {
  priority: number;
  resolve: () => void;
}

interface PrefetchedDocument {
  response: CfTransportResponse;
  expiresAt: number;
}

class EdgeBrowserTransport implements CfUpstreamTransport {
  private disposed = false;
  private activeRequests = 0;
  private readonly requestWaiters: BrowserRequestWaiter[] = [];
  private readonly prefetchedDocuments = new Map<string, PrefetchedDocument>();
  private reconnectPromise: Promise<void> | undefined;
  private submissionInProgress = false;

  constructor(
    private readonly browserProcess: ChildProcess,
    private readonly profileDir: string,
    private readonly browserClient: CdpClient,
    private pageClient: CdpClient,
    private targetId: string,
    private readonly debuggerPort: number,
    private readonly deleteProfileOnDispose: boolean
  ) {}

  closePageClient(): void {
    this.pageClient.close();
  }

  isAlive(): boolean {
    return !this.disposed && this.browserClient.isOpen() && this.pageClient.isOpen();
  }

  async verifySession(onStatus?: (message: string) => void): Promise<void> {
    await this.waitForCodeforcesDocument();
    onStatus?.('正在确认账号和“我的群组”入口…');
    const requestUrl = new URL(MY_GROUPS_PATH, 'https://codeforces.com').toString();
    const response = await this.requestOnce({
      url: requestUrl,
      method: 'GET',
      headers: { Accept: 'text/html,application/xhtml+xml' },
      body: Buffer.alloc(0),
    });
    assertUsableCodeforcesPage(response, '我的群组');
    assertAuthenticatedCodeforcesPage(response, '我的群组');
    if (!isPersonalGroupsUrl(response.finalUrl)) {
      throw new Error('“我的群组”被重定向到全部群组，尚未确认个人群组页面');
    }
    this.prefetchedDocuments.set(requestUrl, { response, expiresAt: Date.now() + 45_000 });
    onStatus?.('账号验证完成；其他入口将在需要时加载，避免触发额外验证。');
  }

  async minimizeWindow(): Promise<void> {
    try {
      const windowInfo = (await this.browserClient.send('Browser.getWindowForTarget', {
        targetId: this.targetId,
      })) as { windowId: number };
      await this.browserClient.send('Browser.setWindowBounds', {
        windowId: windowInfo.windowId,
        bounds: { windowState: 'minimized' },
      });
    } catch {
      // The network bridge still works if the window manager refuses minimization.
    }
  }

  async request(request: CfTransportRequest): Promise<CfTransportResponse> {
    if (this.disposed) {
      throw new Error('Edge 浏览器会话已关闭');
    }
    const url = new URL(request.url);
    if (!isCodeforcesHost(url.hostname)) {
      throw new Error(`拒绝通过登录会话访问非 Codeforces 地址：${url.hostname}`);
    }
    const prefetched = this.readPrefetchedDocument(request);
    if (prefetched) {
      return prefetched;
    }
    await this.acquireRequestSlot(request.priority ?? 50);
    try {
      const client = this.pageClient;
      try {
        return await this.requestOnce(request, client);
      } catch (firstError) {
        if (this.disposed) {
          throw firstError;
        }
        if (isTransientExecutionContextError(firstError)) {
          await delay(300);
          return this.requestOnce(request, this.pageClient);
        }
        if (!isDisconnectedBrowserError(firstError)) {
          throw firstError;
        }
        await this.reconnectPage(client);
        return this.requestOnce(request, this.pageClient);
      }
    } finally {
      this.releaseRequestSlot();
    }
  }

  private readPrefetchedDocument(request: CfTransportRequest): CfTransportResponse | undefined {
    if (request.method.toUpperCase() !== 'GET' || (request.priority ?? 0) < 90) {
      return undefined;
    }
    const entry = this.prefetchedDocuments.get(new URL(request.url).toString());
    if (!entry) {
      return undefined;
    }
    this.prefetchedDocuments.delete(new URL(request.url).toString());
    return entry.expiresAt > Date.now() ? entry.response : undefined;
  }

  async translateHtmlItems(items: string[]): Promise<string[]> {
    if (this.disposed || !this.isAlive()) {
      throw new Error('Edge 浏览器会话已关闭，无法翻译题面');
    }
    return translateHtmlItems(items, async (translationRequest: TranslationHttpRequest) => {
      const translationUrl = new URL(translationRequest.url);
      if (['cn.bing.com', 'translate.googleapis.com'].includes(translationUrl.hostname.toLowerCase())) {
        const response = await directHttpRequest({
          url: translationRequest.url,
          method: translationRequest.method,
          headers: translationRequest.headers,
          body: translationRequest.body,
          timeoutMs: translationRequest.timeoutMs,
        });
        return { statusCode: response.statusCode, body: response.body };
      }
      throw new Error(`拒绝访问未授权的翻译服务：${translationUrl.hostname}`);
    });
  }

  async submitSolution(request: CfBrowserSubmissionRequest): Promise<CfTransportResponse> {
    if (this.disposed || !this.isAlive()) {
      throw new Error('Edge 浏览器会话已关闭，无法提交代码');
    }
    const submitUrl = new URL(request.url);
    if (!isCodeforcesHost(submitUrl.hostname)) {
      throw new Error(`拒绝向非 Codeforces 地址提交代码：${submitUrl.hostname}`);
    }
    if (this.submissionInProgress) {
      throw new Error('已有一份代码正在提交，请等待当前提交完成');
    }
    this.submissionInProgress = true;
    let requestSlotAcquired = false;
    let temporaryTargetId: string | undefined;
    let temporaryClient: CdpClient | undefined;
    let submissionClient: CdpClient | undefined;
    try {
      await this.acquireRequestSlot(100);
      requestSlotAcquired = true;
      const primaryState = await readOfficialSubmitPageState(this.pageClient).catch(
        (): SubmissionPageState => ({})
      );
      let primaryPath = '';
      try {
        primaryPath = primaryState.url ? new URL(primaryState.url).pathname : '';
      } catch {
        primaryPath = '';
      }
      if (primaryPath === submitUrl.pathname && primaryState.hasForm) {
        submissionClient = this.pageClient;
      } else {
        const created = (await this.browserClient.send('Target.createTarget', {
          url: 'about:blank',
          background: true,
        })) as { targetId?: string };
        temporaryTargetId = created.targetId;
        if (!temporaryTargetId) {
          throw new Error('Edge 未能创建官方提交页面');
        }
        const target = await waitForDevToolsTarget(this.debuggerPort, temporaryTargetId);
        if (!target.webSocketDebuggerUrl) {
          throw new Error('Edge 官方提交页面缺少调试连接');
        }
        temporaryClient = await CdpClient.connect(target.webSocketDebuggerUrl);
        submissionClient = temporaryClient;
        await submissionClient.send('Page.enable');
        await submissionClient.send('Page.navigate', { url: submitUrl.toString() }, 60_000);
      }
      const state = await waitForOfficialSubmitPage(submissionClient, 30_000);
      if (state.loginRequired) {
        throw new Error('Codeforces 登录状态已失效，请重新登录后提交');
      }
      if (state.challenged) {
        await this.revealSubmissionVerification(submitUrl.toString());
        throw new Error('Codeforces 要求完成反机器人验证；已在 Edge 中打开验证页面，请完成后重新提交');
      }
      if (!state.hasForm) {
        throw new Error('Codeforces 官方提交页面未找到提交表单');
      }
      if (state.turnstileRequired && !state.turnstileToken) {
        await this.revealSubmissionVerification(submitUrl.toString());
        throw new Error('Codeforces 提交页要求反机器人验证；已在 Edge 中打开验证页面，请完成后重新提交');
      }
      if (!isLiveAntiBotValue(state.ftaa) || !isLiveAntiBotValue(state.bfaa)) {
        await this.revealSubmissionVerification(submitUrl.toString());
        throw new Error('Codeforces 官方反机器人字段尚未生成；已在 Edge 中打开提交页，请等待页面完成验证后重试');
      }
      const evaluated = (await submissionClient.send(
        'Runtime.evaluate',
        {
          expression: buildOfficialSubmissionExpression(request),
          awaitPromise: true,
          returnByValue: true,
        },
        90_000
      )) as RuntimeEvaluationResult;
      if (evaluated.exceptionDetails) {
        throw new Error(evaluated.exceptionDetails.text ?? 'Edge 官方页面提交执行失败');
      }
      const result = evaluated.result?.value;
      if (!result) {
        throw new Error('Edge 官方提交页面没有返回结果');
      }
      if (result.error) {
        throw new Error(result.error);
      }
      if (
        result.status === undefined ||
        !result.headers ||
        result.bodyBase64 === undefined ||
        !result.finalUrl
      ) {
        throw new Error('Edge 官方提交页面返回了不完整的结果');
      }
      const responseBody = Buffer.from(result.bodyBase64, 'base64');
      if (/Please complete (?:the )?anti-bot verification/i.test(responseBody.toString('utf8'))) {
        await this.revealSubmissionVerification(submitUrl.toString());
        throw new Error('Codeforces 仍要求反机器人验证；已在 Edge 中打开官方提交页，请完成验证后重新提交');
      }
      return {
        statusCode: result.status,
        headers: result.headers,
        body: responseBody,
        finalUrl: result.finalUrl,
      };
    } finally {
      temporaryClient?.close();
      if (temporaryTargetId) {
        try {
          await this.browserClient.send('Target.closeTarget', { targetId: temporaryTargetId });
        } catch {
          // The temporary tab may already have closed after a successful submit.
        }
      }
      if (requestSlotAcquired) {
        this.releaseRequestSlot();
      }
      this.submissionInProgress = false;
    }
  }

  private async revealSubmissionVerification(url: string): Promise<void> {
    try {
      await this.pageClient.send('Page.navigate', { url }, 30_000);
      const windowInfo = (await this.browserClient.send('Browser.getWindowForTarget', {
        targetId: this.targetId,
      })) as { windowId: number };
      await this.browserClient.send('Browser.setWindowBounds', {
        windowId: windowInfo.windowId,
        bounds: { windowState: 'normal', left: 80, top: 50, width: 1200, height: 800 },
      });
    } catch {
      // Keep the original verification error if Edge cannot be brought forward.
    }
  }

  private async requestOnce(
    request: CfTransportRequest,
    client: CdpClient = this.pageClient,
    allowTranslationHost = false
  ): Promise<CfTransportResponse> {
    const url = new URL(request.url);
    const allowedTranslationHost =
      allowTranslationHost && url.hostname.toLowerCase() === 'translate.googleapis.com';
    if (!isCodeforcesHost(url.hostname) && !allowedTranslationHost) {
      throw new Error(`拒绝通过登录会话访问非 Codeforces 地址：${url.hostname}`);
    }
    const payload = {
      url: url.toString(),
      method: request.method,
      headers: sanitizeFetchHeaders(request.headers),
      bodyBase64: request.body.length > 0 ? request.body.toString('base64') : '',
      credentials: (allowedTranslationHost ? 'omit' : 'include') as 'omit' | 'include',
      cacheMode: browserFetchCacheMode(url, request.method, allowedTranslationHost),
      timeoutMs: request.timeoutMs ?? (allowedTranslationHost ? 12_000 : 55_000),
    };
    const expression = buildFetchExpression(payload);
    const evaluated = (await client.send(
      'Runtime.evaluate',
      {
        expression,
        awaitPromise: true,
        returnByValue: true,
      },
       Math.max(10_000, (request.timeoutMs ?? (allowedTranslationHost ? 12_000 : 55_000)) + 5_000)
    )) as RuntimeEvaluationResult;
    if (evaluated.exceptionDetails) {
      const details = evaluated.exceptionDetails;
      throw new Error(details.text ?? 'Edge 页面请求执行失败');
    }
    const result = evaluated.result?.value;
    const upstreamLabel = allowedTranslationHost ? 'Google 翻译' : 'Codeforces';
    if (!result) {
      throw new Error(`Edge 没有返回${upstreamLabel}响应`);
    }
    if (result.error) {
      throw new Error(`Edge 请求${upstreamLabel}失败：${result.error}`);
    }
    if (
      result.status === undefined ||
      !result.headers ||
      result.bodyBase64 === undefined ||
      !result.finalUrl
    ) {
      throw new Error(`Edge 返回了不完整的${upstreamLabel}响应`);
    }
    return {
      statusCode: result.status,
      headers: result.headers,
      body: Buffer.from(result.bodyBase64, 'base64'),
      finalUrl: result.finalUrl,
    };
  }

  private async evaluatePageIdentity(): Promise<{ url: string; title: string; origin: string }> {
    const evaluated = (await this.pageClient.send('Runtime.evaluate', {
      expression: '({ url: location.href, title: document.title, origin: location.origin })',
      returnByValue: true,
    })) as {
      result?: { value?: { url?: string; title?: string; origin?: string }; description?: string };
      exceptionDetails?: { text?: string };
    };
    if (evaluated.exceptionDetails) {
      throw new Error(evaluated.exceptionDetails.text ?? '无法读取 Edge 页面状态');
    }
    const value = evaluated.result?.value;
    if (!value) {
      throw new Error(`Edge 页面没有返回执行结果（${evaluated.result?.description ?? '未知原因'}）`);
    }
    return {
      url: value.url ?? '',
      title: value.title ?? '',
      origin: value.origin ?? '',
    };
  }

  private async waitForCodeforcesDocument(): Promise<void> {
    const deadline = Date.now() + 20000;
    let lastUrl = '';
    while (Date.now() < deadline) {
      const page = await this.evaluatePageIdentity();
      lastUrl = page.url;
      if (isCodeforcesUrl(page.url)) {
        return;
      }
      await delay(250);
    }
    throw new Error(`浏览器页面未进入 Codeforces 官方域名（${lastUrl || '空页面'}）`);
  }

  private async reconnectPage(failedClient: CdpClient): Promise<void> {
    if (this.pageClient !== failedClient && this.pageClient.isOpen()) {
      return;
    }
    if (!this.reconnectPromise) {
      this.reconnectPromise = (async () => {
        failedClient.close();
        const target = await waitForCodeforcesPageTarget(this.debuggerPort);
        const replacement = await CdpClient.connect(target.webSocketDebuggerUrl!);
        await installControlledEdgeAppearance(replacement);
        if (this.disposed) {
          replacement.close();
          throw new Error('Edge 浏览器会话已关闭');
        }
        this.pageClient = replacement;
        this.targetId = target.id;
        await this.evaluatePageIdentity();
      })();
    }
    try {
      await this.reconnectPromise;
    } finally {
      this.reconnectPromise = undefined;
    }
  }

  private async acquireRequestSlot(priority: number): Promise<void> {
    if (this.activeRequests < MAX_CONCURRENT_BROWSER_REQUESTS) {
      this.activeRequests += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      const waiter = { priority, resolve };
      const insertionIndex = this.requestWaiters.findIndex(
        (queued) => queued.priority < waiter.priority
      );
      if (insertionIndex === -1) {
        this.requestWaiters.push(waiter);
      } else {
        this.requestWaiters.splice(insertionIndex, 0, waiter);
      }
    });
  }

  private releaseRequestSlot(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    const next = this.requestWaiters.shift();
    if (next) {
      // Reserve the released slot before waking the waiter so a newly arriving
      // resource cannot briefly overbook the browser request pool.
      this.activeRequests += 1;
      next.resolve();
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.prefetchedDocuments.clear();
    this.pageClient.close();
    try {
      await this.browserClient.send('Browser.close', undefined, 5000);
    } catch {
      // The user may have manually closed the minimized Edge session.
    }
    this.browserClient.close();
    if (this.browserProcess.exitCode === null) {
      this.browserProcess.kill();
      await waitForProcessExit(this.browserProcess, 5000);
    }
    if (this.deleteProfileOnDispose) {
      await cleanupProfile(this.profileDir);
    }
  }
}

function browserFetchCacheMode(
  url: URL,
  method: string,
  allowTranslationHost: boolean
): 'default' | 'force-cache' | 'no-store' {
  if (allowTranslationHost || method.toUpperCase() !== 'GET') {
    return 'no-store';
  }
  if (!/\.(?:css|js|mjs|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot)$/i.test(url.pathname)) {
    return 'no-store';
  }
  return /\/s\/\d+\//i.test(url.pathname) || url.search.length > 1
    ? 'force-cache'
    : 'default';
}

export function buildControlledEdgeAppearanceScript(): string {
  const controlledTranslations: Record<string, string> = {
    ...UI_TRANSLATIONS,
    'Главная': '主页',
    'Топ': '热门',
    'Каталог': '目录',
    'Соревнования': '比赛',
    'Тренировки': '训练营',
    'Архив': '题库',
    'Группы': '团体',
    'Рейтинг': '排行榜',
    'Образование': '培训',
    'Календарь': '日历',
    'Помощь': '帮助',
    'Выйти': '退出登录',
    'Название': '名称',
    'Начало': '开始时间',
    'Длит.': '持续时间',
    'Результаты': '结果',
    'Войти': '进入',
    'Виртуальное участие': '虚拟参赛',
    'Подготовил': '创建者',
    'Условия': '说明',
    'Фильтр тренировок': '训练营筛选',
    'Сезон': '赛季',
    'Тип соревнования': '比赛类型',
    'Формат соревнования': '比赛形式',
    'Длительность, часов': '持续时间（小时）',
    'Сложность': '难度',
    'Упорядочить по': '排序方式',
    'Скрыть прошедшие': '隐藏已结束项目',
    'Выбрать': '应用',
    'Сбросить': '重置',
    'Найти тренировку': '查找训练营',
  };
  for (const [key, value] of Object.entries(controlledTranslations)) {
    const upper = key.toUpperCase();
    if (!controlledTranslations[upper]) {
      controlledTranslations[upper] = value;
    }
  }
  const translations = JSON.stringify(controlledTranslations).replace(/</g, '\\u003c');
  const pageZoom = buildPageZoomClientScript();
  const controlledDesktopStyle = JSON.stringify(CONTROLLED_CODEFORCES_DESKTOP_CSS);
  return `(function(){
    if(!/(^|\\.)codeforces\\.com$/i.test(location.hostname))return;
    ${pageZoom};
    var dictionary=${translations};
    function switchRussianPageToEnglish(){
      var bodyText=(document.body&&document.body.innerText)||'';
      if(!/(?:ГЛАВНАЯ|СОРЕВНОВАНИЯ|ТРЕНИРОВКИ|Выйти)/i.test(bodyText))return false;
      if(sessionStorage.getItem('cf-inline-locale-en-attempted')==='1')return false;
      var link=document.querySelector('a[href*="locale=en"],a[href*="/lang/en"]');
      if(!link)return false;
      sessionStorage.setItem('cf-inline-locale-en-attempted','1');
      location.replace(link.href);return true;
    }
    function installStyle(){
      if(document.getElementById('cf-inline-controlled-edge-style'))return;
      var style=document.createElement('style');
      style.id='cf-inline-controlled-edge-style';
      style.textContent=${controlledDesktopStyle};
      (document.head||document.documentElement).appendChild(style);
    }
    function localize(root){
      if(!root)return;
      var walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      var nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
      nodes.forEach(function(node){
        var parent=node.parentElement;if(!parent||parent.closest('script,style,noscript,pre,code,textarea,[contenteditable="true"]'))return;
        var raw=node.nodeValue||'',trimmed=raw.trim(),translated=dictionary[trimmed];
        if(translated)node.nodeValue=raw.replace(trimmed,translated);
      });
    }
    function apply(){installStyle();if(switchRussianPageToEnglish())return;localize(document.body||document.documentElement);}
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
    new MutationObserver(function(records){records.forEach(function(record){record.addedNodes.forEach(function(node){if(node.nodeType===1)localize(node);});});}).observe(document.documentElement,{childList:true,subtree:true});
  })()`;
}

async function installControlledEdgeAppearance(client: CdpClient): Promise<void> {
  const source = buildControlledEdgeAppearanceScript();
  await client.send('Page.enable');
  await client.send('Page.addScriptToEvaluateOnNewDocument', { source });
  await client.send('Runtime.evaluate', { expression: source, returnByValue: true });
}

function buildFetchExpression(payload: {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyBase64: string;
  credentials: 'include' | 'omit';
  cacheMode: 'default' | 'force-cache' | 'no-store';
  timeoutMs: number;
}): string {
  const data = JSON.stringify(payload);
  return `(async () => {
    let timedOut = false;
    try {
      const request = ${data};
      const bytes = request.bodyBase64
        ? Uint8Array.from(atob(request.bodyBase64), (char) => char.charCodeAt(0))
        : undefined;
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, request.timeoutMs);
      let response;
      try {
        response = await fetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: bytes,
          credentials: request.credentials,
          redirect: 'follow',
          cache: request.cacheMode,
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }
      const buffer = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < buffer.length; offset += 32768) {
        binary += String.fromCharCode(...buffer.subarray(offset, offset + 32768));
      }
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        bodyBase64: btoa(binary),
        finalUrl: response.url
      };
    } catch (error) {
      return {
        error: timedOut
          ? '请求超时（' + request.timeoutMs + ' ms）'
          : (error instanceof Error ? error.message : String(error))
      };
    }
  })()`;
}

export function buildOfficialSubmissionExpression(request: CfBrowserSubmissionRequest): string {
  const payload = JSON.stringify({
    url: request.url,
    contestId: request.contestId,
    index: request.index,
    programTypeId: request.programTypeId,
    sourceBase64: Buffer.from(request.source, 'utf8').toString('base64'),
  });
  return `(async () => {
    try {
      const request = ${payload};
      const form = document.querySelector('form.submit-form');
      if (!form) return { error: 'Codeforces 官方提交表单不存在' };
      const sourceBytes = Uint8Array.from(atob(request.sourceBase64), (char) => char.charCodeAt(0));
      const source = new TextDecoder().decode(sourceBytes);
      const ftaa = String(window._ftaa || '');
      const bfaa = String(window._bfaa || '');
      const turnstile = document.querySelector('[name="turnstileToken"],[name="cf-turnstile-response"]');
      const live = (value) => value && !/^(?:n\\/?a|null|undefined|0+)$/i.test(value);
      if (!live(ftaa) || !live(bfaa)) {
        return { error: 'Codeforces 官方反机器人字段尚未生成，请在 Edge 中完成验证后重试' };
      }
      const setField = (name, value) => {
        let control = form.querySelector('[name="' + name + '"]');
        if (!control) {
          control = document.createElement('input');
          control.type = 'hidden';
          control.name = name;
          form.appendChild(control);
        }
        control.value = String(value);
      };
      const csrf = form.querySelector('input[name="csrf_token"]')?.value
        || document.querySelector('meta[name="X-Csrf-Token" i]')?.getAttribute('content')
        || '';
      if (!csrf) return { error: 'Codeforces 官方提交页缺少 CSRF 校验信息' };
      setField('csrf_token', csrf);
      setField('ftaa', ftaa);
      setField('bfaa', bfaa);
      setField('action', 'submitSolutionFormSubmitted');
      setField('contestId', request.contestId);
      setField('submittedProblemIndex', request.index);
      setField('submittedProblemCode', request.contestId + request.index);
      setField('programTypeId', request.programTypeId);
      setField('source', source);
      setField('sourceSize', String(sourceBytes.length));
      setField('tabSize', '4');
      const target = new URL(form.getAttribute('action') || request.url, location.href);
      if (!target.searchParams.has('csrf_token')) target.searchParams.set('csrf_token', csrf);
      const data = new FormData(form);
      data.set('csrf_token', csrf);
      data.set('ftaa', ftaa);
      data.set('bfaa', bfaa);
      data.set('action', 'submitSolutionFormSubmitted');
      data.set('contestId', request.contestId);
      data.set('submittedProblemIndex', request.index);
      data.set('submittedProblemCode', request.contestId + request.index);
      data.set('programTypeId', request.programTypeId);
      data.set('source', source);
      data.set('sourceFile', '');
      data.set('sourceSize', String(sourceBytes.length));
      data.set('tabSize', '4');
      if (turnstile && turnstile.name && turnstile.value) data.set(turnstile.name, turnstile.value);
      const response = await fetch(target.href, {
        method: 'POST',
        body: data,
        credentials: 'include',
        redirect: 'follow',
        cache: 'no-store'
      });
      const buffer = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < buffer.length; offset += 32768) {
        binary += String.fromCharCode(...buffer.subarray(offset, offset + 32768));
      }
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        bodyBase64: btoa(binary),
        finalUrl: response.url
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  })()`;
}

function sanitizeFetchHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (
      lower === 'host' ||
      lower === 'cookie' ||
      lower === 'content-length' ||
      lower === 'user-agent' ||
      lower === 'origin' ||
      lower === 'referer' ||
      lower === 'accept-encoding' ||
      lower.startsWith('sec-')
    ) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function assertUsableCodeforcesPage(response: CfTransportResponse, label: string): void {
  const finalUrl = new URL(response.finalUrl);
  const body = response.body.toString('utf8');
  if (!isCodeforcesHost(finalUrl.hostname)) {
    throw new Error(`${label} 被重定向到非 Codeforces 地址`);
  }
  if (/^\/enter(?:\/|$)/i.test(finalUrl.pathname) || /id=["']enterForm["']/i.test(body)) {
    throw new Error(`${label} 仍要求登录`);
  }
  if (isCloudflareChallenge(body, response.statusCode)) {
    throw new Error(`${label} 仍被 Cloudflare 验证拦截`);
  }
  if (response.statusCode < 200 || response.statusCode >= 400) {
    throw new Error(`${label} 返回 HTTP ${response.statusCode}`);
  }
  if (!/<html\b|<!doctype\s+html/i.test(body)) {
    throw new Error(`${label} 没有返回有效网页`);
  }
}

function assertAuthenticatedCodeforcesPage(
  response: CfTransportResponse,
  label: string
): void {
  const body = response.body.toString('utf8');
  const state = detectCodeforcesAuthentication(body, response.finalUrl);
  if (state !== 'authenticated') {
    throw new Error(
      state === 'anonymous'
        ? `${label} 页面确认账号尚未登录，请在 Edge 中完成账号登录`
        : `${label} 页面未能确认已登录账号，请保留 Edge 窗口并等待插件重试`
    );
  }
}

export type CodeforcesAuthenticationState = 'authenticated' | 'anonymous' | 'unknown';

export function isPersonalGroupsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return isCodeforcesHost(url.hostname) && /^\/groups\/my\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

/** Detect account state from the rendered Codeforces navigation, not from stale cookies. */
export function detectCodeforcesAuthentication(
  html: string,
  finalUrl = 'https://codeforces.com/'
): CodeforcesAuthenticationState {
  let pathname = '';
  try {
    pathname = new URL(finalUrl).pathname;
  } catch {
    // The HTML markers below can still provide a definitive answer.
  }
  const hasEnterForm = /id\s*=\s*["']enterForm["']/i.test(html);
  const hasLogoutLink = /href\s*=\s*["'][^"']*\/logout(?:\?[^"']*)?["']/i.test(html);
  const hasProfileLink = /href\s*=\s*["'][^"']*\/profile\/[^"'/?#]+(?:[?#][^"']*)?["']/i.test(html);
  const hasAnonymousNavigation =
    /href\s*=\s*["'][^"']*\/enter(?:\?[^"']*)?["']/i.test(html) &&
    /href\s*=\s*["'][^"']*\/register(?:\?[^"']*)?["']/i.test(html);

  if (/^\/enter(?:\/|$)/i.test(pathname) || hasEnterForm || hasAnonymousNavigation) {
    return 'anonymous';
  }
  if (hasLogoutLink && hasProfileLink) {
    return 'authenticated';
  }
  return 'unknown';
}

function isCloudflareChallenge(html: string, status: number): boolean {
  return (
    /<title>\s*(?:Just a moment|请稍候|Checking your browser)/i.test(html) ||
    /\/cdn-cgi\/challenge-platform|cf-chl-/i.test(html) ||
    (status === 403 && /cloudflare/i.test(html))
  );
}

function isTransientExecutionContextError(error: unknown): boolean {
  const message = errorMessage(error);
  return /execution context was destroyed|cannot find context|inspected target navigated/i.test(message);
}

function isDisconnectedBrowserError(error: unknown): boolean {
  const message = errorMessage(error);
  return /浏览器登录窗口已关闭|websocket.*closed|target closed|session closed|no target with given id/i.test(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function waitForBrowserDebugger(
  port: number,
  options: CaptureOptions
): Promise<DevToolsVersion> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (options.isCancelled()) {
      throw new Error('已取消 Codeforces 登录。');
    }
    try {
      const version = await getJson<DevToolsVersion>(`http://127.0.0.1:${port}/json/version`);
      if (version.webSocketDebuggerUrl) {
        return version;
      }
    } catch {
      // Chrome/Edge is still starting.
    }
    await delay(250);
  }
  throw new Error('浏览器登录窗口启动超时。');
}

async function waitForCodeforcesPageTarget(port: number): Promise<DevToolsTarget> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const targets = await getJson<DevToolsTarget[]>(`http://127.0.0.1:${port}/json/list`);
      const target = targets.find(
        (item) =>
          item.type === 'page' &&
          isCodeforcesUrl(item.url) &&
          !!item.webSocketDebuggerUrl
      );
      if (target) {
        return target;
      }
    } catch {
      // The login redirect may still be completing.
    }
    await delay(250);
  }
  throw new Error('已登录，但未找到可用的 Codeforces Edge 页面。');
}

async function waitForDevToolsTarget(port: number, targetId: string): Promise<DevToolsTarget> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const targets = await getJson<DevToolsTarget[]>(`http://127.0.0.1:${port}/json/list`);
      const target = targets.find(
        (item) => item.id === targetId && item.type === 'page' && !!item.webSocketDebuggerUrl
      );
      if (target) {
        return target;
      }
    } catch {
      // The temporary target may not be exposed by the debugger yet.
    }
    await delay(100);
  }
  throw new Error('Edge 临时提交页面启动超时');
}

async function waitForOfficialSubmitPage(
  client: CdpClient,
  timeoutMs: number
): Promise<SubmissionPageState> {
  const deadline = Date.now() + timeoutMs;
  let lastState: SubmissionPageState = {};
  while (Date.now() < deadline) {
    try {
      lastState = await readOfficialSubmitPageState(client);
      if (lastState.loginRequired || lastState.challenged) {
        return lastState;
      }
      if (
        lastState.readyState === 'complete' &&
        lastState.hasForm &&
        isLiveAntiBotValue(lastState.ftaa) &&
        isLiveAntiBotValue(lastState.bfaa) &&
        (!lastState.turnstileRequired || !!lastState.turnstileToken) &&
        !!lastState.action
      ) {
        return lastState;
      }
    } catch (error) {
      if (!isTransientExecutionContextError(error)) {
        throw error;
      }
    }
    await delay(150);
  }
  return lastState;
}

async function readOfficialSubmitPageState(client: CdpClient): Promise<SubmissionPageState> {
  const evaluated = (await client.send('Runtime.evaluate', {
    expression: `(() => {
      const form = document.querySelector('form.submit-form');
      const text = (document.body && document.body.innerText || '').slice(0, 12000);
      const turnstile = document.querySelector('[name="turnstileToken"],[name="cf-turnstile-response"]');
      return {
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        hasForm: !!form,
        ftaa: String(window._ftaa || ''),
        bfaa: String(window._bfaa || ''),
        action: form ? form.action : '',
        turnstileRequired: !!document.querySelector('.cf-turnstile,iframe[src*="turnstile"]'),
        turnstileToken: String(turnstile && turnstile.value || ''),
        loginRequired: /^\\/enter(?:\\/|$)/i.test(location.pathname) || !!document.querySelector('#enterForm'),
        challenged: /Just a moment|Checking your browser|请稍候/i.test(document.title) || /cf-chl-|challenge-platform|complete the anti-bot verification/i.test(text)
      };
    })()`,
    returnByValue: true,
  })) as { result?: { value?: SubmissionPageState } };
  return evaluated.result?.value ?? {};
}

function isLiveAntiBotValue(value: string | undefined): boolean {
  return !!value && !/^(?:n\/?a|null|undefined|0+)$/i.test(value.trim());
}

async function findEdgeExecutable(): Promise<string | undefined> {
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const candidates = [
    programFiles && path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    programFilesX86 && path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter((value): value is string => !!value);

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next installed browser.
    }
  }
  return undefined;
}

function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('无法为浏览器登录分配本地端口。'));
        return;
      }
      const port = address.port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function getJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk as Buffer));
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
        } catch (err) {
          reject(err);
        }
      });
    });
    request.setTimeout(2000, () => request.destroy(new Error('request timed out')));
    request.on('error', reject);
  });
}

function hasLoggedInCookie(cookies: BrowserCookie[]): boolean {
  return cookies.some(
    (cookie) =>
      cookie.name === 'X-User-Sha1' &&
      /^[0-9a-f]{40}$/i.test(cookie.value) &&
      !/^0+$/.test(cookie.value)
  );
}

function isCodeforcesCookie(cookie: BrowserCookie): boolean {
  const domain = cookie.domain.replace(/^\./, '').toLowerCase();
  return domain === 'codeforces.com' || domain.endsWith('.codeforces.com');
}

function isCodeforcesUrl(value: string): boolean {
  try {
    return isCodeforcesHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isCodeforcesHost(hostname: string): boolean {
  return /^(?:m[1-3]\.)?codeforces\.com$/i.test(hostname);
}

async function cleanupProfile(profileDir: string): Promise<void> {
  await delay(300);
  try {
    await fs.rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Windows may keep a profile file locked briefly; the OS temp folder can clean it later.
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForProcessExit(process: ChildProcess, timeoutMs: number): Promise<void> {
  if (process.exitCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    process.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
