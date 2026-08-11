import { EventEmitter } from 'events';
import * as http from 'http';
import { URL } from 'url';
import { Cookie, CookieJar } from 'tough-cookie';
import {
  buildLocalizationClientScript,
  LocalizationOptions,
} from './localization';

export interface CfProxyOptions {
  baseUrl: string;
  defaultPath: string;
  port: number;
  fastMode?: boolean;
  localizeInterface?: boolean;
  autoTranslateStatements?: boolean;
}

export interface CfState {
  proxyOrigin: string;
  currentPath: string;
  loggedIn: boolean;
  sessionReady: boolean;
  loginInProgress: boolean;
  loginMessage: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

type AuthenticationState = 'authenticated' | 'anonymous' | 'unknown';

export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface CfTransportRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Buffer;
  priority?: number;
  timeoutMs?: number;
}

export interface CfTransportResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer;
  finalUrl: string;
}

export interface CfBrowserSubmissionRequest {
  url: string;
  contestId: string;
  index: string;
  programTypeId: string;
  source: string;
}

export interface CfUpstreamTransport {
  request(request: CfTransportRequest): Promise<CfTransportResponse>;
  translateHtmlItems?(items: string[]): Promise<string[]>;
  submitSolution?(request: CfBrowserSubmissionRequest): Promise<CfTransportResponse>;
  dispose(): Promise<void>;
  isAlive?(): boolean;
}

const MAX_BODY_SIZE = 64 * 1024 * 1024;
const STATIC_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const STATIC_CACHE_MAX_ENTRIES = 256;
const STATIC_CACHE_DEFAULT_TTL_MS = 30 * 60 * 1000;
const STATIC_CACHE_MAX_ITEM_BYTES = 8 * 1024 * 1024;
// Fast mode deliberately prefers a recently rendered page over another slow
// round trip to Codeforces. The explicit Refresh button still invalidates one
// entry immediately when the user needs the newest data.
const FAST_PAGE_FRESH_TTL_MS = 10 * 60 * 1000;
const FAST_PAGE_STALE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_UPSTREAM_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const SKIPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'proxy-authenticate',
  'proxy-authorization',
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'strict-transport-security',
  'public-key-pins',
  'public-key-pins-report-only',
]);

interface StaticCacheEntry {
  response: CfTransportResponse;
  expiresAt: number;
  size: number;
}

interface PageSnapshotEntry {
  response: CfTransportResponse;
  freshUntil: number;
  staleUntil: number;
}

export class CfProxy extends EventEmitter {
  private readonly baseUrl: string;
  private readonly defaultPath: string;
  private readonly requestedPort: number;
  private server?: http.Server;
  private actualPort = 0;
  private jar = new CookieJar();
  private history: string[] = [];
  private historyIndex = -1;
  private currentPath = '';
  private suppressRecord = false;
  private upstreamUserAgent: string | undefined = DEFAULT_UPSTREAM_USER_AGENT;
  private sessionReady = false;
  private loginInProgress = false;
  private loginMessage = '';
  private transport: CfUpstreamTransport | undefined;
  private readonly staticCache = new Map<string, StaticCacheEntry>();
  private readonly inFlightStaticRequests = new Map<string, Promise<CfTransportResponse>>();
  private readonly pageSnapshots = new Map<string, PageSnapshotEntry>();
  private readonly inFlightPageRequests = new Map<string, Promise<CfTransportResponse>>();
  private staticCacheBytes = 0;
  private readonly localizationOptions: LocalizationOptions;

  constructor(options: CfProxyOptions) {
    super();
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.defaultPath = options.defaultPath.startsWith('/')
      ? options.defaultPath
      : `/${options.defaultPath}`;
    this.requestedPort = options.port;
    this.localizationOptions = {
      localizeInterface: options.localizeInterface ?? true,
      autoTranslateStatements: options.autoTranslateStatements ?? true,
    };
  }

  get origin(): string {
    return `http://127.0.0.1:${this.actualPort}`;
  }

  get cookieJar(): CookieJar {
    return this.jar;
  }

  get upstreamOrigin(): string {
    return this.baseUrl;
  }

  get userAgent(): string | undefined {
    return this.upstreamUserAgent;
  }

  get currentUrlPath(): string {
    return this.currentPath || this.defaultPath;
  }

  isLoggedIn(): boolean {
    const cookies = this.jar.getCookiesSync(`${this.baseUrl}/`);
    const userCookie = cookies.find((cookie) => cookie.key === 'X-User-Sha1');
    return !!userCookie && isValidUserSha1(userCookie.value);
  }

  isSessionReady(): boolean {
    return this.sessionReady && !!this.transport && (this.transport.isAlive?.() ?? true);
  }

  async submitSolution(request: CfBrowserSubmissionRequest): Promise<CfTransportResponse> {
    const transport = this.transport;
    if (!this.isSessionReady() || !transport) {
      throw new Error('请先连接并验证 Codeforces Edge 会话');
    }
    if (!transport.submitSolution) {
      throw new Error('当前 Edge 会话不支持官方页面提交，请重新登录后重试');
    }
    return transport.submitSolution(request);
  }

  setLoginProgress(inProgress: boolean, message = ''): void {
    this.loginInProgress = inProgress;
    this.loginMessage = message;
    this.emit('sessionChange');
  }

  attachBrowserSession(
    cookies: BrowserCookie[],
    userAgent: string,
    transport: CfUpstreamTransport
  ): void {
    const previous = this.transport;
    const nextJar = new CookieJar();
    for (const source of cookies) {
      const domain = source.domain.replace(/^\./, '').toLowerCase();
      if (domain !== 'codeforces.com' && !domain.endsWith('.codeforces.com')) {
        continue;
      }
      const cookie = new Cookie({
        key: source.name,
        value: source.value,
        domain,
        path: source.path || '/',
        secure: source.secure,
        httpOnly: source.httpOnly,
        sameSite: source.sameSite?.toLowerCase() as 'strict' | 'lax' | 'none' | undefined,
        expires:
          source.expires && source.expires > 0
            ? new Date(source.expires * 1000)
            : 'Infinity',
      });
      try {
        nextJar.setCookieSync(cookie, `https://${domain}${source.path || '/'}`);
      } catch {
        // Ignore malformed browser cookies while importing the rest of the session.
      }
    }
    const importedUser = nextJar
      .getCookiesSync(`${this.baseUrl}/`)
      .find((cookie) => cookie.key === 'X-User-Sha1');
    if (!importedUser || !isValidUserSha1(importedUser.value)) {
      throw new Error('Edge 会话中没有检测到有效的 Codeforces 登录状态');
    }

    // Publish the Cookie snapshot and the already verified transport together so
    // the webview can never observe the false "saved but disconnected" state.
    this.jar = nextJar;
    this.upstreamUserAgent = userAgent;
    this.transport = transport;
    this.sessionReady = true;
    this.clearPageSnapshots();
    this.emit('cookieChange');
    this.emit('sessionChange');
    if (previous && previous !== transport) {
      void previous.dispose();
    }
  }

  async detachTransport(): Promise<void> {
    const transport = this.transport;
    this.transport = undefined;
    this.sessionReady = false;
    this.jar = new CookieJar();
    this.clearPageSnapshots();
    this.emit('cookieChange');
    this.emit('sessionChange');
    if (transport) {
      await transport.dispose();
    }
  }

  async start(): Promise<void> {
    try {
      await this.listen(this.requestedPort);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (this.requestedPort === 0 || code !== 'EADDRINUSE') {
        throw err;
      }
      await this.listen(0);
    }
  }

  private listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });
      this.server.keepAliveTimeout = 30_000;
      this.server.headersTimeout = 35_000;
      this.server.on('error', reject);
      this.server.listen(port, '127.0.0.1', () => {
        const address = this.server?.address();
        if (address && typeof address === 'object') {
          this.actualPort = address.port;
        }
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await this.detachTransport();
    this.staticCache.clear();
    this.inFlightStaticRequests.clear();
    this.clearPageSnapshots();
    this.staticCacheBytes = 0;
    if (!this.server) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.server?.closeAllConnections?.();
      this.server?.close(() => resolve());
    });
    this.server = undefined;
  }

  state(): CfState {
    return {
      proxyOrigin: this.origin,
      currentPath: this.currentUrlPath,
      loggedIn: this.isLoggedIn(),
      sessionReady: this.isSessionReady(),
      loginInProgress: this.loginInProgress,
      loginMessage: this.loginMessage,
      canGoBack: this.historyIndex > 0,
      canGoForward: this.historyIndex >= 0 && this.historyIndex < this.history.length - 1,
    };
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const rawUrl = req.url ?? '/';
      if (new URL(rawUrl, this.origin).pathname === '/__cf_inline/translate') {
        await this.handleTranslation(req, res);
        return;
      }
      if (new URL(rawUrl, this.origin).pathname === '/__cf_inline/submit') {
        await this.handleBrowserSubmission(req, res);
        return;
      }
      if (rawUrl.startsWith('/__cf_inline/')) {
        this.handleInline(rawUrl, req, res);
        return;
      }
      const localPath = new URL(rawUrl, this.origin).pathname;
      if (/^\/service-worker-[^/]+\.js$/i.test(localPath)) {
        res.writeHead(404, {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/javascript; charset=utf-8',
        });
        res.end('// Service workers are disabled inside Codeforces Inline.');
        return;
      }

      const target = this.resolveTarget(rawUrl);
      await this.forward(req, res, target);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Proxy error: ${err instanceof Error ? err.message : String(err)}`);
      } else {
        res.end();
      }
    }
  }

  private resolveTarget(rawUrl: string): URL {
    let pathAndQuery = rawUrl;
    if (/^https?:\/\//i.test(rawUrl)) {
      const parsed = new URL(rawUrl);
      pathAndQuery = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return new URL(pathAndQuery, this.baseUrl);
  }

  private async forward(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    target: URL
  ): Promise<void> {
    const chunks: Buffer[] = [];
    let size = 0;
    await new Promise<void>((resolveBody, rejectBody) => {
      req.on('data', (chunk) => {
        size += (chunk as Buffer).length;
        if (size > MAX_BODY_SIZE) {
          rejectBody(new Error('Request body too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk as Buffer);
      });
      req.on('end', resolveBody);
      req.on('error', rejectBody);
    });
    const body = Buffer.concat(chunks);

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const lower = key.toLowerCase();
      if (
        lower === 'host' ||
        lower === 'connection' ||
        lower === 'cookie' ||
        lower === 'content-length' ||
        lower === 'upgrade' ||
        lower === 'keep-alive' ||
        lower === 'origin' ||
        lower === 'referer' ||
        lower === 'user-agent' ||
        lower === 'accept-encoding' ||
        lower.startsWith('sec-ch-') ||
        lower.startsWith('sec-fetch-')
      ) {
        continue;
      }
      if (value !== undefined) {
        headers[key] = Array.isArray(value) ? value.join(', ') : value;
      }
    }

    if (!this.transport) {
      this.writeUpstreamError(res, new Error('请先通过 Edge 登录并建立浏览器会话'));
      return;
    }
    try {
      const transport = this.transport;
      const cacheKey = isStaticAssetRequest(req, target)
        ? `${target.toString()}\n${req.headers.accept ?? ''}`
        : undefined;
      const pageKey = isFastSnapshotRequest(req, target)
        ? target.toString()
        : undefined;
      const cached = cacheKey ? this.readStaticCache(cacheKey) : undefined;
      if (cached) {
        this.handleTransportResponse(req, res, cached);
        return;
      }
      const transportRequest: CfTransportRequest = {
        url: target.toString(),
        method: req.method ?? 'GET',
        headers,
        body,
        priority: requestPriority(req, target),
      };
      if (pageKey) {
        const snapshot = this.pageSnapshots.get(pageKey);
        if (snapshot?.freshUntil && snapshot.freshUntil > Date.now()) {
          this.handleTransportResponse(req, res, snapshot.response);
          return;
        }
        if (snapshot?.staleUntil && snapshot.staleUntil > Date.now()) {
          void this.requestFastPage(pageKey, transport, transportRequest).catch(() => undefined);
          this.handleTransportResponse(req, res, snapshot.response);
          return;
        }
        if (snapshot) {
          this.pageSnapshots.delete(pageKey);
        }
      }
      let responsePromise = cacheKey ? this.inFlightStaticRequests.get(cacheKey) : undefined;
      if (!responsePromise && pageKey) {
        responsePromise = this.requestFastPage(pageKey, transport, transportRequest);
      }
      if (!responsePromise) {
        responsePromise = transport.request(transportRequest);
        if (cacheKey) {
          this.inFlightStaticRequests.set(cacheKey, responsePromise);
          void responsePromise.finally(() => {
            if (this.inFlightStaticRequests.get(cacheKey) === responsePromise) {
              this.inFlightStaticRequests.delete(cacheKey);
            }
          }).catch(() => undefined);
        }
      }
      const response = await responsePromise;
      if (cacheKey) {
        this.storeStaticCache(cacheKey, response);
      }
      this.handleTransportResponse(req, res, response);
    } catch (err) {
      if (this.transport?.isAlive?.() === false) {
        this.sessionReady = false;
        this.emit('sessionChange');
      }
      this.writeUpstreamError(res, err instanceof Error ? err : new Error(String(err)));
    }
  }

  private requestFastPage(
    key: string,
    transport: CfUpstreamTransport,
    request: CfTransportRequest
  ): Promise<CfTransportResponse> {
    const existing = this.inFlightPageRequests.get(key);
    if (existing) {
      return existing;
    }
    const pending = transport.request(request).then((response) => {
      if (this.transport === transport && isCacheableFastSnapshot(key, response)) {
        const now = Date.now();
        this.pageSnapshots.set(key, {
          response,
          freshUntil: now + FAST_PAGE_FRESH_TTL_MS,
          staleUntil: now + FAST_PAGE_STALE_TTL_MS,
        });
      }
      return response;
    });
    this.inFlightPageRequests.set(key, pending);
    void pending.finally(() => {
      if (this.inFlightPageRequests.get(key) === pending) {
        this.inFlightPageRequests.delete(key);
      }
    }).catch(() => undefined);
    return pending;
  }

  private clearPageSnapshots(): void {
    this.pageSnapshots.clear();
    this.inFlightPageRequests.clear();
  }

  private clearPageSnapshot(pathAndQuery: string): void {
    try {
      const target = new URL(pathAndQuery, this.baseUrl).toString();
      this.pageSnapshots.delete(target);
    } catch {
      // Ignore malformed local refresh paths.
    }
  }

  private readStaticCache(key: string): CfTransportResponse | undefined {
    const entry = this.staticCache.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.staticCache.delete(key);
      this.staticCacheBytes -= entry.size;
      return undefined;
    }
    // Refresh insertion order so eviction behaves as a small LRU cache.
    this.staticCache.delete(key);
    this.staticCache.set(key, entry);
    return entry.response;
  }

  private storeStaticCache(key: string, response: CfTransportResponse): void {
    if (!isCacheableStaticResponse(response)) {
      return;
    }
    const existing = this.staticCache.get(key);
    if (existing) {
      this.staticCacheBytes -= existing.size;
      this.staticCache.delete(key);
    }
    const entry: StaticCacheEntry = {
      response,
      expiresAt: Date.now() + staticCacheTtl(response.headers),
      size: response.body.length,
    };
    this.staticCache.set(key, entry);
    this.staticCacheBytes += entry.size;
    while (
      this.staticCache.size > STATIC_CACHE_MAX_ENTRIES ||
      this.staticCacheBytes > STATIC_CACHE_MAX_BYTES
    ) {
      const oldestKey = this.staticCache.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      const oldest = this.staticCache.get(oldestKey);
      this.staticCache.delete(oldestKey);
      this.staticCacheBytes -= oldest?.size ?? 0;
    }
  }

  private writeUpstreamError(res: http.ServerResponse, err: Error): void {
    if (res.headersSent) {
      res.end();
      return;
    }
    const detail = escapeHtml(err.message);
    const errorJson = JSON.stringify(err.message).replace(/</g, '\\u003c');
    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Codeforces 会话已断开</title><style>:root{color-scheme:light dark}*{box-sizing:border-box}body{min-height:100vh;margin:0;display:flex;align-items:center;justify-content:center;padding:28px;background:#f5f7fb;color:#222;font:15px/1.65 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}.card{width:min(620px,100%);padding:26px;border:1px solid #d9dee8;border-radius:10px;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.08)}h2{margin:0 0 10px;color:#c62828}p{margin:9px 0}code{display:block;margin:14px 0;padding:9px 11px;border-radius:5px;background:#f2f2f2;overflow-wrap:anywhere}.actions{display:flex;align-items:center;gap:12px;margin-top:18px;flex-wrap:wrap}button{padding:9px 17px;border:1px solid #1976d2;border-radius:6px;background:#1976d2;color:#fff;font:inherit;cursor:pointer}button:disabled{opacity:.65;cursor:wait}#status{color:#596273}@media(prefers-color-scheme:dark){body{background:#17191d;color:#e6e8eb}.card{border-color:#373b43;background:#202328}code{background:#30343a}#status{color:#adb4be}}</style></head><body><main class="card"><h2>Edge 会话已断开</h2><p>检测到用于 Codeforces 登录的 Edge 已关闭，当前页面无法继续访问官网。</p><code>${detail}</code><p>点击下方按钮后会重新打开 Edge。请完成登录并保持 Edge 在后台运行；验证成功后本页会自动恢复。</p><div class="actions"><button id="relogin" type="button">重新登录</button><span id="status">等待重新连接</span></div></main><script>(function(){var button=document.getElementById('relogin');var status=document.getElementById('status');window.addEventListener('contextmenu',function(event){event.preventDefault();event.stopImmediatePropagation()},true);if(window.name==='cfInlineMain'){try{window.parent.postMessage({__cfInlinePageError:true,message:${errorJson}},'*')}catch(e){}}function requestLogin(){button.disabled=true;status.textContent='正在打开 Edge 登录页面…';fetch('/__cf_inline/relogin',{method:'POST',headers:{'X-CF-Inline':'relogin'},cache:'no-store'}).then(function(response){if(!response.ok)throw new Error('请求失败');return response.json()}).then(apply).catch(function(error){button.disabled=false;status.textContent='无法启动登录：'+String(error)})}function apply(state){if(state.sessionReady&&state.loggedIn){status.textContent='登录完成，正在恢复页面…';location.reload();return}button.disabled=!!state.loginInProgress;button.textContent=state.loginInProgress?'登录进行中…':'重新登录';status.textContent=state.loginMessage||(state.loginInProgress?'请在 Edge 中完成登录…':'Edge 会话仍未连接')}function check(){fetch('/__cf_inline/state',{cache:'no-store'}).then(function(r){return r.json()}).then(apply).catch(function(){status.textContent='正在等待插件本地服务…'}).finally(function(){setTimeout(check,1000)})}button.addEventListener('click',requestLogin);check()})()</script></body></html>`;
    res.writeHead(502, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(html)),
    });
    res.end(html);
  }

  private handleTransportResponse(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    response: CfTransportResponse
  ): void {
      const status = response.statusCode;
      const outHeaders: http.OutgoingHttpHeaders = {};
      for (const [key, value] of Object.entries(response.headers)) {
        const lower = key.toLowerCase();
        if (
          SKIPPED_RESPONSE_HEADERS.has(lower) ||
          lower === 'set-cookie' ||
          lower === 'content-length' ||
          lower === 'content-encoding'
        ) {
          continue;
        }
        outHeaders[key] = value;
      }
      let finalBody: Buffer<ArrayBufferLike> = response.body;
      const contentType = response.headers['content-type'] ?? '';
      const isHtml = /text\/html/i.test(contentType);
      if (isHtml) {
        let html = finalBody.toString('utf8');
        const challenged = isCloudflareChallenge(html, status);
        const authentication = detectAuthenticationState(html, response.finalUrl);
        const wasReady = this.sessionReady;
        if (challenged) {
          this.sessionReady = false;
        } else if (authentication === 'anonymous') {
          this.sessionReady = false;
        } else if (
          authentication === 'authenticated' &&
          status >= 200 &&
          status < 400 &&
          this.upstreamUserAgent
        ) {
          this.sessionReady = true;
        }
        if (wasReady !== this.sessionReady) {
          this.emit('sessionChange');
        }
        html = this.removeCspMeta(html);
        html = removeFrameStopScripts(html);
        html = this.rewriteHtml(html);
        const finalUrl = new URL(response.finalUrl);
        html = injectScriptBeforeBody(
          html,
          finalUrl.pathname + finalUrl.search,
          status,
          authentication,
          this.localizationOptions
        );
        finalBody = Buffer.from(html, 'utf8');
      }
      outHeaders['content-length'] = String(finalBody.length);
      if (req.method === 'HEAD') {
        res.writeHead(status, outHeaders);
        res.end();
        return;
      }
      res.writeHead(status, outHeaders);
      res.end(finalBody);
  }

  private handleInline(
    rawUrl: string,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    const parsed = new URL(rawUrl, this.origin);
    if (parsed.pathname === '/__cf_inline/fast') {
      this.writeFastMode(res, parsed.searchParams.get('path'));
      return;
    }
    if (parsed.pathname === '/__cf_inline/full') {
      this.writeFullMode(res, parsed.searchParams.get('path'));
      return;
    }
    if (parsed.pathname === '/__cf_inline/bridge') {
      this.writeBridge(res);
      return;
    }
    if (parsed.pathname === '/__cf_inline/state') {
      this.writeJson(res, this.state());
      return;
    }
    if (parsed.pathname === '/__cf_inline/relogin') {
      if (req.method !== 'POST' || req.headers['x-cf-inline'] !== 'relogin') {
        this.writeJson(res, { error: '无效的重新登录请求' }, 403);
        return;
      }
      if (!this.loginInProgress) {
        this.setLoginProgress(true, '正在打开 Edge 登录页面…');
        queueMicrotask(() => this.emit('reloginRequest'));
      }
      this.writeJson(res, this.state(), 202);
      return;
    }
    if (parsed.pathname === '/__cf_inline/go') {
      const dir = Number(parsed.searchParams.get('dir') ?? '0');
      const nextIndex = Math.min(
        this.history.length - 1,
        Math.max(0, this.historyIndex + dir)
      );
      if (nextIndex !== this.historyIndex) {
        this.historyIndex = nextIndex;
        this.currentPath = this.history[nextIndex] ?? this.defaultPath;
        this.suppressRecord = true;
      }
      this.writeJson(res, { path: this.currentUrlPath });
      return;
    }
    if (parsed.pathname === '/__cf_inline/home') {
      this.writeJson(res, { path: this.defaultPath });
      return;
    }
    if (parsed.pathname === '/__cf_inline/visited') {
      const page = parsed.searchParams.get('path');
      if (page && page.startsWith('/') && !page.startsWith('/__cf_inline/')) {
        this.recordPage(page);
      }
      this.writeJson(res, this.state());
      return;
    }
    if (parsed.pathname === '/__cf_inline/fast-refresh') {
      const page = parsed.searchParams.get('path');
      if (page && isFastAreaPath(page)) {
        this.clearPageSnapshot(page);
        this.writeJson(res, { ok: true });
      } else {
        this.writeJson(res, { error: '只能刷新极速模式支持的 Codeforces 页面' }, 400);
      }
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }

  private async handleTranslation(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (req.method !== 'POST') {
      this.writeJson(res, { error: '翻译接口仅接受 POST 请求' }, 405);
      return;
    }
    if (req.headers['x-cf-inline'] !== 'translate') {
      this.writeJson(res, { error: '无效的翻译请求' }, 403);
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > 512 * 1024) {
          throw new Error('翻译请求内容过长');
        }
        chunks.push(bytes);
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        items?: unknown;
      };
      if (!Array.isArray(payload.items) || !payload.items.every((item) => typeof item === 'string')) {
        throw new Error('翻译请求格式无效');
      }
      if (!this.transport?.translateHtmlItems) {
        throw new Error('请先连接 Edge 会话后再翻译题面');
      }
      const items = await this.transport.translateHtmlItems(payload.items as string[]);
      this.writeJson(res, { items });
    } catch (err) {
      this.writeJson(
        res,
        { error: err instanceof Error ? err.message : String(err) },
        502
      );
    }
  }

  private async handleBrowserSubmission(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (req.method !== 'POST') {
      this.writeJson(res, { error: '提交接口仅接受 POST 请求' }, 405);
      return;
    }
    if (req.headers['x-cf-inline'] !== 'submit') {
      this.writeJson(res, { error: '无效的代码提交请求' }, 403);
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > 2 * 1024 * 1024) {
          throw new Error('待提交的源代码过长');
        }
        chunks.push(bytes);
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        submitPath?: unknown;
        contestId?: unknown;
        index?: unknown;
        programTypeId?: unknown;
        source?: unknown;
      };
      if (
        typeof payload.submitPath !== 'string' ||
        !isAllowedSubmitPath(payload.submitPath) ||
        typeof payload.contestId !== 'string' ||
        !/^\d+$/.test(payload.contestId) ||
        typeof payload.index !== 'string' ||
        !/^[A-Za-z0-9]+$/.test(payload.index) ||
        typeof payload.programTypeId !== 'string' ||
        !/^\d+$/.test(payload.programTypeId) ||
        typeof payload.source !== 'string' ||
        !payload.source.trim()
      ) {
        throw new Error('代码提交参数无效');
      }
      const response = await this.submitSolution({
        url: new URL(payload.submitPath, this.baseUrl).toString(),
        contestId: payload.contestId,
        index: payload.index,
        programTypeId: payload.programTypeId,
        source: payload.source,
      });
      this.writeJson(res, {
        status: response.statusCode,
        url: response.finalUrl,
        html: response.body.toString('utf8'),
      });
    } catch (err) {
      this.writeJson(
        res,
        { error: err instanceof Error ? err.message : String(err) },
        502
      );
    }
  }

  private writeJson(res: http.ServerResponse, data: unknown, status = 200): void {
    res.writeHead(status, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify(data));
  }

  private writeBridge(res: http.ServerResponse): void {
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
      (function () {
        function post(type, data) {
          parent.postMessage(Object.assign({ __cfInlineBridge: true, type: type }, data || {}), '*');
        }
        function refresh() {
          fetch('/__cf_inline/state', { cache: 'no-store' })
            .then(function (response) { return response.json(); })
            .then(function (state) { post('state', { state: state }); })
            .catch(function (error) { post('error', { message: String(error) }); });
        }
        window.addEventListener('message', function (event) {
          var command = event.data || {};
          if (!command.__cfInlineBridgeCommand) return;
          if (command.type === 'go') {
            fetch('/__cf_inline/go?dir=' + encodeURIComponent(String(command.dir || 0)), { cache: 'no-store' })
              .then(function (response) { return response.json(); })
              .then(function (result) { post('navigate', { path: result.path }); refresh(); })
              .catch(function (error) { post('error', { message: String(error) }); });
          } else if (command.type === 'refresh') {
            refresh();
          }
        });
        setInterval(refresh, 500);
        refresh();
      })();
    </script></body></html>`;
    res.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(html)),
    });
    res.end(html);
  }

  private writeFastMode(res: http.ServerResponse, requestedPath: string | null): void {
    const candidate = this.currentUrlPath;
    const initialPath = requestedPath && isSafeLocalPagePath(requestedPath) && isFastAreaPath(requestedPath)
      ? requestedPath
      : (isFastAreaPath(candidate) ? candidate : '/groups/my');
    const initialPathJson = JSON.stringify(initialPath).replace(/</g, '\\u003c');
    const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Codeforces 极速模式</title>
<style>
:root{color-scheme:light dark;--bg:#f5f7fb;--panel:#fff;--line:#d9dee8;--text:#20242b;--muted:#68707d;--brand:#1976d2;--brand-soft:#e8f2fd;--danger:#c62828}*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden}body{display:flex;flex-direction:column;background:var(--bg);color:var(--text);font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}.progress{height:3px;flex:0 0 3px;background:transparent;overflow:hidden}.progress::after{content:"";display:block;width:35%;height:100%;background:var(--brand);transform:translateX(-110%)}body.loading .progress::after{animation:run 1s ease-in-out infinite}@keyframes run{to{transform:translateX(320%)}}header{display:flex;align-items:center;gap:10px;min-height:54px;padding:8px 12px;background:var(--panel);border-bottom:1px solid var(--line);box-shadow:0 1px 4px rgba(0,0,0,.05);z-index:2}.brand{font-weight:700;white-space:nowrap;color:var(--brand)}nav{display:flex;gap:5px;min-width:0}button,.entry{appearance:none;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--text);font:inherit;text-decoration:none;padding:7px 11px;cursor:pointer;white-space:nowrap}.entry:hover,button:hover{background:var(--brand-soft)}.entry.active{color:var(--brand);background:var(--brand-soft);border-color:#b8d7f5}.tools{display:flex;gap:2px;margin-left:auto}.tools button{padding:6px 9px;border-color:var(--line)}.status{display:flex;align-items:center;gap:7px;min-height:30px;padding:5px 13px;color:var(--muted);background:var(--panel);border-bottom:1px solid var(--line);font-size:12px}.dot{width:7px;height:7px;border-radius:50%;background:#43a047;flex:none}.status.error{color:var(--danger)}.status.error .dot{background:var(--danger)}.path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.loading-text{margin-left:auto;display:none;color:var(--brand)}body.loading .loading-text{display:block}.relogin{display:none;margin-left:auto;padding:3px 9px;border-color:var(--danger);color:var(--danger);font-size:12px}.status.error .relogin{display:block}.relogin:disabled{opacity:.6;cursor:wait}iframe{display:block;flex:1;width:100%;min-height:0;border:0;background:#fff}@media(max-width:660px){.brand{display:none}header{gap:4px;padding-inline:6px}.entry{padding-inline:8px}.tools button{padding-inline:7px}}@media(prefers-color-scheme:dark){:root{--bg:#17191d;--panel:#202328;--line:#373b43;--text:#e6e8eb;--muted:#a4aab3;--brand:#64b5f6;--brand-soft:#18344d}iframe{background:#fff}}
</style></head><body class="loading"><div class="progress"></div><header><span class="brand">Codeforces 极速模式</span><nav><a class="entry" href="/groups/my" target="cfInlineMain" data-path="/groups/my">我的群组</a><a class="entry" href="/contests" target="cfInlineMain" data-path="/contests">比赛</a><a class="entry" href="/gyms" target="cfInlineMain" data-path="/gyms">训练营</a><a class="entry" href="/problemset" target="cfInlineMain" data-path="/problemset">题库</a></nav><div class="tools"><button id="normalMode" title="保留当前页面并切换到完整 Codeforces 界面">正常模式</button><button id="back" title="后退">←</button><button id="forward" title="前进">→</button><button id="refresh" title="从 Codeforces 刷新当前页面">刷新</button></div></header><div class="status" id="status"><span class="dot"></span><span class="path" id="path">正在连接…</span><span class="loading-text">正在加载 Codeforces…</span><button class="relogin" id="relogin" type="button">重新登录</button></div><iframe id="main" name="cfInlineMain" src="about:blank"></iframe>
<script>(function(){var initial=${initialPathJson};var frame=document.getElementById('main');var status=document.getElementById('status');var pathText=document.getElementById('path');var relogin=document.getElementById('relogin');var current=initial;var wasConnected=false;window.addEventListener('contextmenu',function(event){event.preventDefault();event.stopImmediatePropagation()},true);function loading(on,message){document.body.classList.toggle('loading',!!on);if(message)pathText.textContent=message}function rememberPath(){history.replaceState(null,'','/__cf_inline/fast?path='+encodeURIComponent(current))}function prefix(path,root){return path===root||path.indexOf(root+'/')===0}function area(path){if(prefix(path,'/groups')||prefix(path,'/group'))return'/groups/my';if(prefix(path,'/contests')||prefix(path,'/contest'))return'/contests';if(prefix(path,'/gyms')||prefix(path,'/gym'))return'/gyms';if(prefix(path,'/problemset'))return'/problemset';return''}function mark(path){document.querySelectorAll('.entry').forEach(function(link){link.classList.toggle('active',link.getAttribute('data-path')===area(path))})}function navigate(path){current=path||'/groups/my';rememberPath();mark(current);loading(true,'正在加载 '+current+'…');frame.src=current}function switchMode(url,message){loading(true,message);requestAnimationFrame(function(){setTimeout(function(){location.href=url},80)})}function requestRelogin(){relogin.disabled=true;relogin.textContent='登录进行中…';loading(false,'正在打开 Edge 登录页面…');fetch('/__cf_inline/relogin',{method:'POST',headers:{'X-CF-Inline':'relogin'},cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('请求失败');return r.json()}).then(applyState).catch(function(e){relogin.disabled=false;relogin.textContent='重新登录';loading(false,'无法启动登录：'+String(e))})}function applyState(s){var connected=!!s.loggedIn&&!!s.sessionReady;relogin.disabled=!!s.loginInProgress;relogin.textContent=s.loginInProgress?'登录进行中…':'重新登录';if(connected){status.classList.remove('error');if(!wasConnected){wasConnected=true;navigate(current)}return}wasConnected=false;status.classList.add('error');loading(false,s.loginMessage||'Edge 会话已断开，请重新登录并保持 Edge 在后台运行')}document.querySelectorAll('.entry').forEach(function(link){link.addEventListener('click',function(){current=link.getAttribute('data-path')||'/groups/my';rememberPath();mark(current);loading(true,'正在加载 '+current+'…')})});document.getElementById('normalMode').onclick=function(){switchMode('/__cf_inline/full?path='+encodeURIComponent(current),'正在切换到正常模式…')};document.getElementById('back').onclick=function(){loading(true,'正在返回上一页…');fetch('/__cf_inline/go?dir=-1',{cache:'no-store'}).then(function(r){return r.json()}).then(function(v){navigate(v.path)}).catch(function(e){loading(false,String(e))})};document.getElementById('forward').onclick=function(){loading(true,'正在前往下一页…');fetch('/__cf_inline/go?dir=1',{cache:'no-store'}).then(function(r){return r.json()}).then(function(v){navigate(v.path)}).catch(function(e){loading(false,String(e))})};document.getElementById('refresh').onclick=function(){loading(true,'正在从 Codeforces 刷新 '+current+'…');fetch('/__cf_inline/fast-refresh?path='+encodeURIComponent(current),{cache:'no-store'}).then(function(){frame.src=current}).catch(function(e){loading(false,String(e))})};relogin.onclick=requestRelogin;window.addEventListener('message',function(event){if(event.origin!==location.origin)return;var data=event.data||{};if(data.__cfInlinePageLoading){loading(true,'正在加载 Codeforces…')}if(data.__cfInlineUrl){current=data.__cfInlineUrl;rememberPath();mark(current);pathText.textContent=current}if(data.__cfInlinePageReady){current=data.path||current;rememberPath();mark(current);status.classList.remove('error');loading(false,current)}if(data.__cfInlinePageError){status.classList.add('error');loading(false,data.message||'Codeforces 会话暂不可用')}});frame.addEventListener('load',function(){if(frame.src!=='about:blank')setTimeout(function(){loading(false,current)},800)});function check(){fetch('/__cf_inline/state',{cache:'no-store'}).then(function(r){return r.json()}).then(applyState).catch(function(){status.classList.add('error');loading(false,'无法连接插件本地服务')})}setInterval(check,1000);mark(initial);navigate(initial);check()})()</script></body></html>`;
    res.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-src 'self'; connect-src 'self'; img-src 'self' data:",
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(html)),
    });
    res.end(html);
  }

  private writeFullMode(res: http.ServerResponse, requestedPath: string | null): void {
    const initialPath = requestedPath && isSafeLocalPagePath(requestedPath)
      ? requestedPath
      : (isSafeLocalPagePath(this.currentUrlPath) ? this.currentUrlPath : this.defaultPath);
    const initialPathJson = JSON.stringify(initialPath).replace(/</g, '\\u003c');
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Codeforces 正常模式</title><style>:root{color-scheme:light dark;--panel:#fff;--line:#d9dee8;--text:#20242b;--muted:#68707d;--brand:#1976d2;--soft:#e8f2fd;--danger:#c62828}*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden}body{display:flex;flex-direction:column;background:#f5f7fb;color:var(--text);font:14px -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}.progress{height:3px;flex:0 0 3px;overflow:hidden}.progress:after{content:"";display:block;width:35%;height:100%;background:var(--brand);transform:translateX(-110%)}body.loading .progress:after{animation:run 1s ease-in-out infinite}@keyframes run{to{transform:translateX(320%)}}header{display:flex;align-items:center;gap:8px;min-height:46px;padding:6px 10px;background:var(--panel);border-bottom:1px solid var(--line)}strong{color:var(--brand);white-space:nowrap}.path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:12px}.loading-text{display:none;color:var(--brand);font-size:12px;white-space:nowrap}body.loading .loading-text{display:inline}button{appearance:none;border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--text);padding:6px 10px;font:inherit;cursor:pointer;white-space:nowrap}button:hover{background:var(--soft)}.mode{color:var(--brand);border-color:#b8d7f5}.tools{display:flex;gap:3px;margin-left:auto}.relogin{display:none;border-color:var(--danger);color:var(--danger)}body.disconnected .relogin{display:inline-block}.relogin:disabled{opacity:.6;cursor:wait}iframe{display:block;flex:1;width:100%;min-height:0;border:0;background:#fff}@media(max-width:560px){strong,.path{display:none}header{padding-inline:6px}}@media(prefers-color-scheme:dark){:root{--panel:#202328;--line:#373b43;--text:#e6e8eb;--muted:#a4aab3;--brand:#64b5f6;--soft:#18344d}body{background:#17191d}}</style></head><body class="loading"><div class="progress"></div><header><strong>Codeforces 正常模式</strong><span class="path" id="path">正在加载…</span><span class="loading-text" id="loadingText">正在加载完整 Codeforces 页面…</span><div class="tools"><button class="relogin" id="relogin" type="button">重新登录</button><button class="mode" id="fastMode">切换到极速模式</button><button id="back" title="后退">←</button><button id="forward" title="前进">→</button><button id="refresh">刷新</button></div></header><iframe id="main" name="cfInlineMain" src="about:blank"></iframe><script>(function(){var current=${initialPathJson};var frame=document.getElementById('main');var path=document.getElementById('path');var loadingText=document.getElementById('loadingText');var relogin=document.getElementById('relogin');var wasConnected=true;window.addEventListener('contextmenu',function(event){event.preventDefault();event.stopImmediatePropagation()},true);function loading(on,message){document.body.classList.toggle('loading',!!on);if(message)loadingText.textContent=message}function rememberPath(){history.replaceState(null,'','/__cf_inline/full?path='+encodeURIComponent(current))}function navigate(value){current=value||'/';rememberPath();path.textContent=current;loading(true,'正在加载完整 Codeforces 页面…');frame.src=current}function switchMode(url,message){loading(true,message);requestAnimationFrame(function(){setTimeout(function(){location.href=url},80)})}function requestRelogin(){relogin.disabled=true;relogin.textContent='登录进行中…';path.textContent='正在打开 Edge 登录页面…';fetch('/__cf_inline/relogin',{method:'POST',headers:{'X-CF-Inline':'relogin'},cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('请求失败');return r.json()}).then(applyState).catch(function(e){relogin.disabled=false;relogin.textContent='重新登录';path.textContent='无法启动登录：'+String(e)})}function applyState(s){var connected=!!s.loggedIn&&!!s.sessionReady;document.body.classList.toggle('disconnected',!connected);relogin.disabled=!!s.loginInProgress;relogin.textContent=s.loginInProgress?'登录进行中…':'重新登录';if(connected){if(!wasConnected){wasConnected=true;navigate(current)}return}wasConnected=false;loading(false);path.textContent=s.loginMessage||'Edge 会话已断开，请重新登录'}document.getElementById('fastMode').onclick=function(){switchMode('/__cf_inline/fast?path='+encodeURIComponent(current),'正在切换到极速模式…')};document.getElementById('back').onclick=function(){loading(true,'正在返回上一页…');try{frame.contentWindow.history.back()}catch(e){}};document.getElementById('forward').onclick=function(){loading(true,'正在前往下一页…');try{frame.contentWindow.history.forward()}catch(e){}};document.getElementById('refresh').onclick=function(){loading(true,'正在重新加载完整页面…');try{frame.contentWindow.location.reload()}catch(e){navigate(current)}};relogin.onclick=requestRelogin;window.addEventListener('message',function(event){if(event.origin!==location.origin)return;var data=event.data||{};if(data.__cfInlinePageLoading)loading(true,'正在加载完整 Codeforces 页面…');if(data.__cfInlineUrl){current=data.__cfInlineUrl;rememberPath();path.textContent=current}if(data.__cfInlinePageReady){current=data.path||current;rememberPath();path.textContent=current;loading(false)}if(data.__cfInlinePageError){path.textContent=data.message||'Codeforces 会话暂不可用';loading(false)}});frame.addEventListener('load',function(){if(frame.src!=='about:blank')setTimeout(function(){loading(false)},800)});function check(){fetch('/__cf_inline/state',{cache:'no-store'}).then(function(r){return r.json()}).then(applyState).catch(function(){document.body.classList.add('disconnected');path.textContent='无法连接插件本地服务'})}setInterval(check,1000);navigate(current);check()})()</script></body></html>`;
    res.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-src 'self'; connect-src 'self'; img-src 'self' data:",
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(html)),
    });
    res.end(html);
  }

  private recordPage(path: string): void {
    if (this.suppressRecord) {
      this.suppressRecord = false;
      return;
    }
    if (path === this.currentPath && this.historyIndex >= 0) {
      return;
    }
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(path);
    this.historyIndex = this.history.length - 1;
    this.currentPath = path;
  }

  private rewriteHtml(html: string): string {
    const hosts = new Set([
      new URL(this.baseUrl).host,
      'codeforces.com',
      'm1.codeforces.com',
      'm2.codeforces.com',
      'm3.codeforces.com',
    ]);
    let rewritten = html;
    for (const host of hosts) {
      rewritten = rewritten
        .split(`https://${host}`)
        .join(this.origin)
        .split(`http://${host}`)
        .join(this.origin)
        .split(`//${host}`)
        .join(this.origin);
    }
    return rewritten;
  }

  private removeCspMeta(html: string): string {
    const metaTagRe = /<meta\b[^>]*>/gi;
    return html.replace(metaTagRe, (tag) => {
      const attrs = parseAttributes(tag);
      const httpEquiv = attrs['http-equiv'] ?? '';
      return /content-security-policy/i.test(httpEquiv) ? '' : tag;
    });
  }

}

function isStaticAssetRequest(req: http.IncomingMessage, target: URL): boolean {
  if ((req.method ?? 'GET').toUpperCase() !== 'GET' || req.headers.range) {
    return false;
  }
  return /\.(?:css|js|mjs|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot)(?:$)/i.test(
    target.pathname
  );
}

function isFastSnapshotRequest(req: http.IncomingMessage, target: URL): boolean {
  if ((req.method ?? 'GET').toUpperCase() !== 'GET' || req.headers.range) {
    return false;
  }
  const destination = String(req.headers['sec-fetch-dest'] ?? '').toLowerCase();
  const accept = String(req.headers.accept ?? '').toLowerCase();
  if (destination !== 'document' && !accept.includes('text/html')) {
    return false;
  }
  return isFastSnapshotPath(target.pathname);
}

function isFastSnapshotPath(pathname: string): boolean {
  // Contest indexes and contest home pages contain server-rendered countdown
  // values. Reusing their HTML makes a newly opened page count down from an
  // old snapshot, even though Codeforces' timer script itself is still alive.
  // Keep caching problem documents and other expensive fast-mode pages.
  return isFastAreaPath(pathname) && !isTimeSensitiveSnapshotPath(pathname);
}

function isTimeSensitiveSnapshotPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return (
    /^\/(?:contests|gyms)$/i.test(normalized) ||
    /^\/(?:contest|gym)\/\d+$/i.test(normalized) ||
    /^\/group\/[^/]+\/contest\/\d+$/i.test(normalized)
  );
}

function isFastAreaPath(pathAndQuery: string): boolean {
  try {
    const pathname = new URL(pathAndQuery, 'https://codeforces.com').pathname;
    return (
      /^\/groups?(?:\/|$)/i.test(pathname) ||
      /^\/(?:contests|contest)(?:\/|$)/i.test(pathname) ||
      /^\/(?:gyms|gym)(?:\/|$)/i.test(pathname) ||
      /^\/problemset(?:\/|$)/i.test(pathname)
    );
  } catch {
    return false;
  }
}

function isSafeLocalPagePath(pathAndQuery: string): boolean {
  if (
    !pathAndQuery.startsWith('/') ||
    pathAndQuery.startsWith('//') ||
    pathAndQuery.includes('\\') ||
    pathAndQuery.startsWith('/__cf_inline/')
  ) {
    return false;
  }
  try {
    const parsed = new URL(pathAndQuery, 'https://codeforces.com');
    return parsed.origin === 'https://codeforces.com';
  } catch {
    return false;
  }
}

function isCacheableFastSnapshot(key: string, response: CfTransportResponse): boolean {
  if (
    response.statusCode < 200 ||
    response.statusCode >= 300 ||
    response.body.length === 0 ||
    !/text\/html/i.test(response.headers['content-type'] ?? '')
  ) {
    return false;
  }
  const html = response.body.toString('utf8');
  if (
    isCloudflareChallenge(html, response.statusCode) ||
    detectAuthenticationState(html, response.finalUrl) !== 'authenticated'
  ) {
    return false;
  }
  try {
    const requested = new URL(key);
    const final = new URL(response.finalUrl);
    return (
      isCodeforcesHost(final.hostname) &&
      isFastSnapshotPath(requested.pathname) &&
      isFastSnapshotPath(final.pathname) &&
      (requested.pathname.replace(/\/+$/, '') === '/groups/my'
        ? final.pathname.replace(/\/+$/, '') === '/groups/my'
        : true)
    );
  } catch {
    return false;
  }
}

function requestPriority(req: http.IncomingMessage, target: URL): number {
  const method = (req.method ?? 'GET').toUpperCase();
  const destination = String(req.headers['sec-fetch-dest'] ?? '').toLowerCase();
  const accept = String(req.headers.accept ?? '').toLowerCase();
  if (method !== 'GET' || destination === 'document' || accept.includes('text/html')) {
    return 100;
  }
  if (isStaticAssetRequest(req, target)) {
    return 10;
  }
  return 60;
}

function isCacheableStaticResponse(response: CfTransportResponse): boolean {
  if (
    response.statusCode !== 200 ||
    response.body.length === 0 ||
    response.body.length > STATIC_CACHE_MAX_ITEM_BYTES
  ) {
    return false;
  }
  const contentType = response.headers['content-type'] ?? '';
  if (/text\/html|application\/json/i.test(contentType)) {
    return false;
  }
  const cacheControl = response.headers['cache-control'] ?? '';
  return !/\b(?:no-store|no-cache|private)\b/i.test(cacheControl);
}

function staticCacheTtl(headers: Record<string, string>): number {
  const cacheControl = headers['cache-control'] ?? '';
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl);
  if (!match) {
    return STATIC_CACHE_DEFAULT_TTL_MS;
  }
  return Math.max(60_000, Math.min(24 * 60 * 60 * 1000, Number(match[1]) * 1000));
}

function isCloudflareChallenge(html: string, status: number): boolean {
  return (
    /<title>\s*(?:Just a moment|请稍候|Checking your browser)/i.test(html) ||
    (status === 403 && /\/cdn-cgi\/challenge-platform|cf-chl-/i.test(html))
  );
}

function isCodeforcesHost(host: string): boolean {
  return /^(?:m[1-3]\.)?codeforces\.com$/i.test(host);
}

function isValidUserSha1(value: string): boolean {
  return /^[0-9a-f]{40}$/i.test(value) && !/^0+$/.test(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function removeFrameStopScripts(html: string): string {
  return html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (tag, body: string) => {
    const stopsEmbeddedPage =
      /window\.parent\.frames\.length/i.test(body) &&
      /window\.stop\s*\(\s*\)/i.test(body);
    return stopsEmbeddedPage ? '' : tag;
  });
}

function injectScriptBeforeBody(
  html: string,
  finalPath?: string,
  status = 200,
  authentication: AuthenticationState = 'unknown',
  localizationOptions: LocalizationOptions = {
    localizeInterface: true,
    autoTranslateStatements: true,
  }
): string {
  const pathJson = JSON.stringify(finalPath ?? '');
  const statusJson = JSON.stringify(status);
  const authJson = JSON.stringify(authentication);
  const script = [
    '<script>',
    '(function () {',
    "  var isPrimaryView = window.name === 'cfInlineMain' || window.top === window.self;",
    '  function notify() {',
    `    var pagePath = ${pathJson} || (location.pathname + location.search);`,
    "    try { window.parent.postMessage({ __cfInlineUrl: pagePath }, '*'); } catch (e) {}",
    '    if (isPrimaryView) {',
    "      try { fetch('/__cf_inline/visited?path=' + encodeURIComponent(pagePath), { cache: 'no-store' }); } catch (e) {}",
    `      try { window.parent.postMessage({ __cfInlinePageReady: true, path: pagePath, status: ${statusJson}, authentication: ${authJson} }, '*'); } catch (e) {}`,
    '    }',
    '  }',
    '  notify();',
    '  function simplifyFastNavigation() {',
    "    var inFastShell = false; try { inFastShell = window.name === 'cfInlineMain' && window.parent.location.pathname === '/__cf_inline/fast'; } catch (e) {}",
    '    if (!inFastShell) return;',
    "    document.documentElement.setAttribute('data-cf-inline-fast-page', 'true');",
    "    var allowedPaths = ['/contests', '/gyms', '/problemset', '/groups'];",
    "    var allowedLabels = /^(?:Contests|比赛|Gym|训练营|Problemset|题库|Groups|群组)$/i;",
    "    document.querySelectorAll('.menu-list > li').forEach(function (item) {",
    "      if (item.classList.contains('backLava')) { item.style.setProperty('display', 'none', 'important'); return; }",
    "      var link = item.querySelector('a[href]'); var keep = false;",
    "      if (link) { try { var pathname = new URL(link.getAttribute('href'), location.origin).pathname.replace(/\\/+$/, '') || '/'; keep = allowedPaths.some(function (root) { return pathname === root || pathname.indexOf(root + '/') === 0; }); } catch (e) {} }",
    "      if (!link) keep = allowedLabels.test((item.textContent || '').trim());",
    "      if (!keep) { item.setAttribute('data-cf-inline-fast-hidden', 'true'); item.style.setProperty('display', 'none', 'important'); }",
    '    });',
    '  }',
    '  simplifyFastNavigation();',
    '  function installReliableCountdowns() {',
    '    var tracked = new Map(); var timerStartedAt = Date.now();',
    '    function parseSeconds(text) {',
    "      var match = /^(\\d{1,3}):([0-5]\\d):([0-5]\\d)$/.exec(String(text || '').trim());",
    '      if (!match) return 0;',
    '      return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);',
    '    }',
    '    function pad(value) { return value < 10 ? \'0\' + value : String(value); }',
    '    function formatSeconds(value) {',
    '      var seconds = value % 60; var totalMinutes = (value - seconds) / 60; var minutes = totalMinutes % 60; var hours = (totalMinutes - minutes) / 60;',
    "      return pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);",
    '    }',
    '    function discover() {',
    "      document.querySelectorAll('.countdown').forEach(function (element) {",
    '        if (tracked.has(element)) return;',
    '        var seconds = parseSeconds(element.textContent);',
    '        if (seconds > 0) { tracked.set(element, { seconds: seconds, startedAt: Date.now() }); element.setAttribute(\'data-cf-inline-live-countdown\', \'true\'); }',
    '      });',
    '    }',
    '    function tick() {',
    '      discover(); var now = Date.now();',
    '      tracked.forEach(function (entry, element) {',
    '        if (!element.isConnected) { tracked.delete(element); return; }',
    '        var passed = Math.floor((now - entry.startedAt) / 1000); var remaining = Math.max(0, entry.seconds - passed); element.textContent = formatSeconds(remaining);',
    '        if (remaining === 0) tracked.delete(element);',
    '      });',
    '      var elapsed = Date.now() - timerStartedAt; var delay = Math.max(50, 1000 - (elapsed % 1000));',
    '      window.setTimeout(tick, delay);',
    '    }',
    '    discover(); tick();',
    '  }',
    '  installReliableCountdowns();',
    "  window.addEventListener('contextmenu', function (event) { event.preventDefault(); event.stopImmediatePropagation(); }, true);",
    '  var fastPrefetchTimer = 0; var fastPrefetched = new Set();',
    '  function scheduleFastPrefetch(link) {',
    "    var inFastShell = false; try { inFastShell = window.name === 'cfInlineMain' && window.parent.location.pathname === '/__cf_inline/fast'; } catch (e) {}",
    '    if (!inFastShell || !link || link.hasAttribute(\'download\')) return;',
    "    var target; try { target = new URL(link.href, location.href); } catch (e) { return; }",
    "    if (target.origin !== location.origin || !/^\\/(?:groups?|contests?|gyms?|problemset)(?:\\/|$)/i.test(target.pathname)) return;",
    "    var key = target.pathname + target.search; if (fastPrefetched.has(key)) return; clearTimeout(fastPrefetchTimer);",
    "    fastPrefetchTimer = setTimeout(function () { fastPrefetched.add(key); fetch(key, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'text/html' } }).catch(function () { fastPrefetched.delete(key); }); }, 220);",
    '  }',
    "  document.addEventListener('pointerover', function (event) { var link = event.target && event.target.closest ? event.target.closest('a[href]') : null; scheduleFastPrefetch(link); }, true);",
    "  document.addEventListener('focusin', function (event) { var link = event.target && event.target.closest ? event.target.closest('a[href]') : null; scheduleFastPrefetch(link); }, true);",
    '  var directProgressTimers = [];',
    '  function showDirectNavigationProgress() {',
    "    var style = document.getElementById('cf-inline-direct-progress-style');",
    '    if (!style) {',
    "      style = document.createElement('style'); style.id = 'cf-inline-direct-progress-style';",
    "      style.textContent = '#cf-inline-direct-progress{position:fixed;z-index:2147483647;left:0;right:0;top:0;height:6px;background:rgba(25,118,210,.16);pointer-events:none;transition:opacity .25s ease}#cf-inline-direct-progress>span{display:block;width:8%;height:100%;background:linear-gradient(90deg,#0d6efd,#42a5f5);box-shadow:0 0 12px #1976d2;transition:width .45s ease-out}#cf-inline-direct-progress>em{position:fixed;right:12px;top:12px;padding:5px 9px;border-radius:4px;background:#1976d2;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.24);font:12px/1.2 -apple-system,Segoe UI,sans-serif;font-style:normal}';",
    '      (document.head || document.documentElement).appendChild(style);',
    '    }',
    "    var holder = document.getElementById('cf-inline-direct-progress');",
    "    if (!holder) { holder = document.createElement('div'); holder.id = 'cf-inline-direct-progress'; holder.setAttribute('role', 'progressbar'); holder.setAttribute('aria-label', '正在加载 Codeforces 页面'); holder.innerHTML = '<span></span><em>正在加载…</em>'; (document.body || document.documentElement).appendChild(holder); }",
    "    holder.style.opacity = '1'; var bar = holder.firstElementChild; if (!bar) return; bar.style.width = '8%';",
    '    directProgressTimers.forEach(function (timer) { clearTimeout(timer); }); directProgressTimers = [];',
    "    [[80,'22%'],[320,'42%'],[800,'63%'],[1600,'78%'],[3000,'88%'],[6000,'94%']].forEach(function (step) { directProgressTimers.push(setTimeout(function () { bar.style.width = step[1]; }, step[0])); });",
    '  }',
    '  function rememberNavigationProgress() { try { sessionStorage.setItem(\'cfInline.navigationStarted\', String(Date.now())); } catch (e) {} }',
    '  function completeRememberedNavigationProgress() {',
    "    var started = 0; try { started = Number(sessionStorage.getItem('cfInline.navigationStarted') || '0'); sessionStorage.removeItem('cfInline.navigationStarted'); } catch (e) {}",
    '    if (!started || Date.now() - started > 30000) return;',
    "    showDirectNavigationProgress(); directProgressTimers.forEach(function (timer) { clearTimeout(timer); }); directProgressTimers = []; var holder = document.getElementById('cf-inline-direct-progress'); var bar = holder && holder.firstElementChild; if (!holder || !bar) return; bar.style.width = '72%';",
    "    requestAnimationFrame(function () { bar.style.width = '100%'; setTimeout(function () { holder.style.opacity = '0'; setTimeout(function () { holder.remove(); }, 260); }, 420); });",
    '  }',
    '  function delayDirectNavigation(event, link) {',
    "    if (!isPrimaryView || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.hasAttribute('download') || (link.target && link.target !== '_self')) return false;",
    "    var target; try { target = new URL(link.href, location.href); } catch (e) { return false; }",
    "    if (target.origin !== location.origin || (target.hash && target.pathname === location.pathname && target.search === location.search)) return false;",
    '    event.preventDefault(); rememberNavigationProgress(); showDirectNavigationProgress();',
    '    requestAnimationFrame(function () { setTimeout(function () { location.assign(target.href); }, 120); });',
    '    return true;',
    '  }',
    "  document.addEventListener('click', function (event) {",
    "    var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;",
    "    if (isPrimaryView && link && !/^#|^javascript:/i.test(link.getAttribute('href') || '')) {",
    "      var delayed = delayDirectNavigation(event, link); if (!delayed && !link.hasAttribute('download') && (!link.target || link.target === '_self')) showDirectNavigationProgress();",
    "      try { window.parent.postMessage({ __cfInlinePageLoading: true }, '*'); } catch (e) {}",
    '    }',
    '    setTimeout(notify, 50);',
    '  }, true);',
    "  document.addEventListener('submit', function () {",
    "    if (isPrimaryView) { rememberNavigationProgress(); showDirectNavigationProgress(); try { window.parent.postMessage({ __cfInlinePageLoading: true }, '*'); } catch (e) {} }",
    '  }, true);',
    "  window.addEventListener('beforeunload', showDirectNavigationProgress);",
    '  completeRememberedNavigationProgress();',
    '})();',
    '</script>',
  ].join('') + buildLocalizationClientScript(localizationOptions);
  const marker = '</body>';
  const index = html.toLowerCase().lastIndexOf(marker);
  if (index === -1) {
    return html + script;
  }
  return html.slice(0, index) + script + html.slice(index);
}

function detectAuthenticationState(html: string, finalUrl: string): AuthenticationState {
  let pathname = '';
  try {
    pathname = new URL(finalUrl).pathname;
  } catch {
    // Fall through to HTML markers.
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

function isAllowedSubmitPath(value: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(value, 'https://codeforces.com').pathname;
  } catch {
    return false;
  }
  return /^(?:\/contest\/\d+\/submit|\/gym\/\d+\/submit|\/problemset\/submit|\/group\/[A-Za-z0-9_-]+\/contest\/\d+\/submit)\/?$/i.test(
    pathname
  );
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(tag))) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}
