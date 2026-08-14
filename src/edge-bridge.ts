import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as http from 'http';
import * as vscode from 'vscode';
import { WebSocket, WebSocketServer } from 'ws';
import { translateHtmlItems, TranslationHttpRequest } from './localization';
import { request as directHttpRequest } from './net';
import {
  BrowserCookie,
  CfBrowserSubmissionRequest,
  CfProxy,
  CfTransportRequest,
  CfTransportResponse,
  CfUpstreamTransport,
} from './proxy';

const BRIDGE_PORT_START = 27121;
const BRIDGE_PORT_END = 27130;
const BRIDGE_PATH = '/cf-inline-edge-bridge';
const EDGE_EXTENSION_ID = 'gdbpfejeiompakehnjkeggmimbomepgk';
const BRIDGE_PROTOCOL = 3;
const TASK_TIMEOUT_MS = 120_000;
const RECONNECT_GRACE_MS = 6_000;

interface BridgeResult {
  cookies?: BrowserCookie[];
  userAgent?: string;
  statusCode?: number;
  headers?: Record<string, string>;
  bodyBase64?: string;
  finalUrl?: string;
  valid?: boolean;
}

interface PendingTask {
  resolve(value: BridgeResult): void;
  reject(reason: Error): void;
  onProgress?: (message: string) => void;
  timer: NodeJS.Timeout;
  action: string;
}

export class EdgeBridgeServer extends EventEmitter implements vscode.Disposable {
  private server?: http.Server;
  private webSockets?: WebSocketServer;
  private socket?: WebSocket;
  private protocolReady = false;
  private latestSession?: BridgeResult;
  private handshakeTimer?: NodeJS.Timeout;
  private nextTaskId = 1;
  private readonly pending = new Map<number, PendingTask>();
  private disposed = false;
  private actualPort = 0;
  private shutdownPromise?: Promise<void>;
  private reconnectDeadline = 0;

  get port(): number { return this.actualPort; }
  get connected(): boolean { return this.protocolReady && this.socket?.readyState === WebSocket.OPEN; }
  get reconnecting(): boolean { return !this.disposed && !this.connected && Date.now() < this.reconnectDeadline; }
  get sessionSnapshot(): BridgeResult | undefined {
    return this.latestSession?.valid ? this.latestSession : undefined;
  }

  waitForConnection(timeoutMs: number): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Edge 桥接服务已关闭'));
    if (this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off('connect', connected);
        this.off('stopped', stopped);
        reject(new Error('未检测到配套 Edge 扩展，请确认已经安装并启用'));
      }, timeoutMs);
      const connected = (): void => {
        clearTimeout(timer);
        this.off('stopped', stopped);
        resolve();
      };
      const stopped = (): void => {
        clearTimeout(timer);
        this.off('connect', connected);
        reject(new Error('Edge 桥接服务已关闭'));
      };
      this.once('connect', connected);
      this.once('stopped', stopped);
    });
  }

  async start(): Promise<void> {
    if (this.server) return;
    let lastError: unknown;
    for (let port = BRIDGE_PORT_START; port <= BRIDGE_PORT_END; port += 1) {
      try {
        await this.listen(port);
        this.actualPort = port;
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('日常 Edge 桥接端口不可用');
  }

  private listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((_req, res) => {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Codeforces Inline Edge Bridge');
      });
      const webSockets = new WebSocketServer({ noServer: true, maxPayload: 70 * 1024 * 1024 });
      server.on('upgrade', (request, socket, head) => {
        const origin = String(request.headers.origin ?? '');
        const allowedOrigins = new Set([
          `chrome-extension://${EDGE_EXTENSION_ID}`,
          `extension://${EDGE_EXTENSION_ID}`,
        ]);
        if (request.url !== BRIDGE_PATH || !allowedOrigins.has(origin)) {
          socket.destroy();
          return;
        }
        webSockets.handleUpgrade(request, socket, head, (client) => webSockets.emit('connection', client));
      });
      webSockets.on('connection', (client) => this.accept(client));
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        this.server = server;
        this.webSockets = webSockets;
        resolve();
      });
    });
  }

  private accept(client: WebSocket): void {
    this.socket?.close(1000, 'replaced');
    this.socket = client;
    this.protocolReady = false;
    this.reconnectDeadline = Date.now() + RECONNECT_GRACE_MS;
    this.latestSession = undefined;
    clearTimeout(this.handshakeTimer);
    this.handshakeTimer = setTimeout(() => {
      if (this.socket === client && !this.protocolReady) {
        client.close(4001, 'bridge protocol handshake missing');
        this.emit('incompatible', '配套 Edge 扩展已连接，但协议确认超时；请稍后重新连接');
      }
    // Older compatible bridge builds confirm the protocol only after reading
    // cookies and inspecting an existing Codeforces tab. Keep enough time for
    // that work so a slow page is never misreported as an outdated extension.
    }, 30_000);
    client.on('message', (data) => this.receive(data.toString(), client));
    client.on('close', () => {
      if (this.socket !== client) return;
      this.socket = undefined;
      this.protocolReady = false;
      this.latestSession = undefined;
      this.reconnectDeadline = Date.now() + RECONNECT_GRACE_MS;
      clearTimeout(this.handshakeTimer);
      this.rejectAll(new Error('日常 Edge 已关闭或配套扩展已断开'));
      this.emit('disconnect');
    });
    client.on('error', () => undefined);
    client.send(JSON.stringify({ type: 'hello', protocol: BRIDGE_PROTOCOL }));
  }

  private receive(raw: string, source: WebSocket): void {
    // A replaced socket can still deliver a queued message after a newer Edge
    // connection has become active. Never let that stale message alter the
    // protocol or session state of the current connection.
    if (this.socket !== source) return;
    let message: { type?: string; protocol?: number; extensionVersion?: string; id?: number; ok?: boolean; value?: BridgeResult; error?: string; message?: string; cookies?: BrowserCookie[]; userAgent?: string; valid?: boolean };
    try { message = JSON.parse(raw); } catch { return; }
    if (message.type === 'ready') {
      if (message.protocol !== BRIDGE_PROTOCOL) {
        this.socket?.close(4002, 'bridge protocol mismatch');
        this.emit('incompatible', '配套 Edge 扩展版本不匹配，请在 Edge 扩展页点击“重新加载”');
        return;
      }
      clearTimeout(this.handshakeTimer);
      this.protocolReady = true;
      this.reconnectDeadline = 0;
      this.latestSession = {
        cookies: message.cookies ?? [],
        userAgent: message.userAgent,
        valid: message.valid === true,
      };
      this.emit('connect');
      this.emit('session', this.latestSession);
      return;
    }
    if (message.type === 'sessionState') {
      if (!this.protocolReady) return;
      this.latestSession = {
        cookies: message.cookies ?? [],
        userAgent: message.userAgent,
        valid: message.valid === true,
      };
      this.emit('session', this.latestSession);
      if (this.latestSession.valid) {
        for (const [id, task] of this.pending) {
          if (task.action !== 'authenticate') continue;
          clearTimeout(task.timer);
          this.pending.delete(id);
          task.resolve(this.latestSession);
        }
      }
      return;
    }
    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    if (message.type === 'progress') {
      if (message.message) pending.onProgress?.(message.message);
      return;
    }
    if (message.type !== 'result') return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.value ?? {});
    else pending.reject(new Error(message.error || '日常 Edge 扩展执行失败'));
  }

  run(action: string, payload: unknown, timeoutMs = TASK_TIMEOUT_MS, onProgress?: (message: string) => void): Promise<BridgeResult> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('尚未连接配套 Edge 扩展，请先安装并启用扩展'));
    }
    const id = this.nextTaskId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(
          action === 'authenticate'
            ? '配套 Edge 扩展已连接，但登录状态检查未返回；请在 edge://extensions 中重新加载该扩展后重试'
            : `配套 Edge 扩展执行“${action}”超时`
        ));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer, onProgress, action });
      socket.send(JSON.stringify({ type: 'task', id, action, payload }));
    });
  }

  private rejectAll(error: Error): void {
    for (const task of this.pending.values()) {
      clearTimeout(task.timer);
      task.reject(error);
    }
    this.pending.clear();
  }

  dispose(): void {
    void this.shutdown();
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = (async () => {
      this.disposed = true;
      this.emit('stopped');
      this.rejectAll(new Error('Edge 桥接服务已关闭'));
      const socket = this.socket;
      const server = this.server;
      const webSockets = this.webSockets;
      this.socket = undefined;
      this.server = undefined;
      this.webSockets = undefined;
      this.protocolReady = false;
      this.latestSession = undefined;
      this.actualPort = 0;
      this.reconnectDeadline = 0;
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = undefined;
      socket?.terminate();
      await Promise.allSettled([
        new Promise<void>((resolve) => {
          if (!server?.listening) { resolve(); return; }
          server.closeAllConnections?.();
          server.close(() => resolve());
        }),
        new Promise<void>((resolve) => {
          if (!webSockets) { resolve(); return; }
          webSockets.close(() => resolve());
        }),
      ]);
      this.removeAllListeners();
    })();
    return this.shutdownPromise;
  }
}

class EdgeBridgeTransport implements CfUpstreamTransport {
  private disposed = false;
  constructor(private readonly bridge: EdgeBridgeServer) {}

  isAlive(): boolean { return !this.disposed && (this.bridge.connected || this.bridge.reconnecting); }

  private async ensureConnected(): Promise<void> {
    if (this.disposed) throw new Error('日常 Edge 会话已断开');
    if (this.bridge.connected) return;
    if (!this.bridge.reconnecting) throw new Error('日常 Edge 会话已断开');
    await this.bridge.waitForConnection(RECONNECT_GRACE_MS);
  }

  async hasValidLoginCookie(): Promise<boolean> {
    if (!this.isAlive()) return false;
    await this.ensureConnected().catch(() => undefined);
    if (!this.bridge.connected) return false;
    if (this.bridge.sessionSnapshot) return true;
    return (await this.bridge.run('loginState', {}, 15_000)).valid === true;
  }

  async request(request: CfTransportRequest): Promise<CfTransportResponse> {
    await this.ensureConnected();
    const payload = {
      ...request,
      bodyBase64: request.body.toString('base64'),
      body: undefined,
    };
    const timeoutMs = Math.max(20_000, request.timeoutMs ?? 0) + 15_000;
    const retryable = /^(?:GET|HEAD)$/i.test(request.method);
    try {
      return decodeResponse(await this.bridge.run('request', payload, timeoutMs));
    } catch (error) {
      if (!retryable || !this.isAlive() || !isTransientBridgeRequestError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 180));
      if (!this.isAlive()) throw error;
      return decodeResponse(await this.bridge.run('request', payload, timeoutMs));
    }
  }

  async submitSolution(request: CfBrowserSubmissionRequest): Promise<CfTransportResponse> {
    await this.ensureConnected();
    return decodeResponse(await this.bridge.run('submit', request, 180_000));
  }

  async translateHtmlItems(items: string[]): Promise<string[]> {
    return translateHtmlItems(items, async (translationRequest: TranslationHttpRequest) => {
      const url = new URL(translationRequest.url);
      if (!['www2.deepl.com', 'cn.bing.com', 'translate.googleapis.com'].includes(url.hostname.toLowerCase())) {
        throw new Error(`拒绝访问未授权的翻译服务：${url.hostname}`);
      }
      const response = await directHttpRequest({
        url: translationRequest.url,
        method: translationRequest.method,
        headers: translationRequest.headers,
        body: translationRequest.body,
        timeoutMs: translationRequest.timeoutMs,
      });
      return { statusCode: response.statusCode, body: response.body };
    });
  }

  async dispose(): Promise<void> { this.disposed = true; }
}

function decodeResponse(value: BridgeResult): CfTransportResponse {
  if (typeof value.statusCode !== 'number' || !value.finalUrl || typeof value.bodyBase64 !== 'string') {
    throw new Error('日常 Edge 返回了无效响应');
  }
  return {
    statusCode: value.statusCode,
    headers: value.headers ?? {},
    body: Buffer.from(value.bodyBase64, 'base64'),
    finalUrl: value.finalUrl,
  };
}

function isTransientBridgeRequestError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /超时|timeout|timed out|aborted|signal|message port|frame (?:was )?removed|cannot access contents/i.test(message);
}

const activeLogins = new WeakMap<EdgeBridgeServer, Promise<void>>();

export function loginWithEdgeBridge(
  bridge: EdgeBridgeServer,
  proxy: CfProxy,
  onStatus?: (message: string) => void,
  interactive = true,
  forceReconnect = false
): Promise<void> {
  const existing = activeLogins.get(bridge);
  if (existing && !forceReconnect) return existing;
  if (!forceReconnect && proxy.isLoggedIn() && proxy.isSessionReady()) return Promise.resolve();
  const login = (async () => {
    if (existing) await existing.catch(() => undefined);
    if (forceReconnect) {
      onStatus?.('正在重建 Edge 会话…');
      await proxy.detachTransport();
      if (bridge.connected) {
        await bridge.run('resetExecutionTab', {}, 8_000).catch(() => undefined);
      }
    }
    let openedEdgeForLogin = false;
    if (!bridge.connected) {
      if (!interactive) throw new Error('日常 Edge 尚未运行');
      onStatus?.('正在打开日常 Edge；请勿关闭登录或验证标签页…');
      await vscode.env.openExternal(vscode.Uri.parse('https://codeforces.com/'));
      openedEdgeForLogin = true;
      await bridge.waitForConnection(20_000);
    }
    onStatus?.('正在读取日常 Edge 的 Codeforces 登录状态…');
    let result = bridge.sessionSnapshot;
    if (!result) result = await bridge.run('authenticate', { interactive: false }, 8_000, onStatus).catch(async (error) => {
      if (!interactive) throw error;
      onStatus?.('正在日常 Edge 中打开 Codeforces 官方登录页…');
      await vscode.env.openExternal(vscode.Uri.parse('https://codeforces.com/enter?back=%2F&mobile=false'));
      openedEdgeForLogin = true;
      onStatus?.('请在日常 Edge 中完成账号登录；只有网站实际显示人机验证时才需要验证，请勿关闭该标签页');
      return bridge.run('authenticate', { interactive: true }, 10 * 60_000, onStatus);
    });
    const cookies = [...(result.cookies ?? [])];
    // In bridge mode the rendered account controls can prove authentication
    // even when Edge does not expose Codeforces' HttpOnly account cookie to the
    // extension. CfProxy needs a local-only marker for its state machine; all
    // real upstream requests still run inside Edge and never send this marker.
    if (result.valid && !cookies.some((cookie) => cookie.name === 'X-User-Sha1' && /^[0-9a-f]{40}$/i.test(cookie.value))) {
      cookies.push({
        name: 'X-User-Sha1',
        value: '1111111111111111111111111111111111111111',
        domain: '.codeforces.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      });
    }
    const transport = new EdgeBridgeTransport(bridge);
    try {
      proxy.attachBrowserSession(cookies, result.userAgent || 'Microsoft Edge', transport);
      if (openedEdgeForLogin) {
        onStatus?.('登录状态已获取，正在最小化 Edge…');
        await bridge.run('minimizeCodeforcesWindow', {}, 8_000).catch(() => undefined);
      }
      onStatus?.('日常 Edge 会话已连接');
    } catch (error) {
      await transport.dispose();
      throw error;
    }
  })();
  activeLogins.set(bridge, login);
  return login.finally(() => { if (activeLogins.get(bridge) === login) activeLogins.delete(bridge); });
}

export function restoreEdgeBridgeSession(bridge: EdgeBridgeServer, proxy: CfProxy): Promise<boolean> {
  return loginWithEdgeBridge(bridge, proxy, undefined, false).then(() => true, () => false);
}

export async function revealEdgeExtension(context: vscode.ExtensionContext): Promise<void> {
  const source = vscode.Uri.joinPath(context.extensionUri, 'edge-extension');
  let folder: vscode.Uri | undefined;
  for (const workspace of vscode.workspace.workspaceFolders ?? []) {
    const candidate = vscode.Uri.joinPath(workspace.uri, 'edge-extension');
    try {
      await fs.access(vscode.Uri.joinPath(candidate, 'manifest.json').fsPath);
      folder = candidate;
      break;
    } catch { /* try the next workspace */ }
  }
  if (!folder) {
    const selected = await vscode.window.showOpenDialog({
      title: '选择保存配套 Edge 扩展的工作目录',
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: '保存到此目录',
    });
    if (!selected?.[0]) return;
    folder = vscode.Uri.joinPath(selected[0], 'codeforces-inline-edge-extension');
    await fs.mkdir(folder.fsPath, { recursive: true });
    await Promise.all(['manifest.json', 'service-worker.js', 'wake.js'].map((name) =>
      fs.copyFile(vscode.Uri.joinPath(source, name).fsPath, vscode.Uri.joinPath(folder!, name).fsPath)
    ));
  }
  await vscode.env.clipboard.writeText(folder.fsPath);
  await vscode.commands.executeCommand('revealFileInOS', folder);
  void vscode.window.showInformationMessage('已打开配套 Edge 扩展文件夹，并复制路径。请在 edge://extensions 中开启开发人员模式后选择“加载解压缩的扩展”。');
}
