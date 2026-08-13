import * as vscode from 'vscode';
import { EdgeBridgeServer, loginWithEdgeBridge, revealEdgeExtension } from './edge-bridge';
import { openInIntegratedBrowser, prefersIntegratedBrowser } from './integrated-browser';
import { CfProxy } from './proxy';

const PANEL_TYPE = 'cfInline.panel';

export class CfPanel {
  private static current: CfPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly proxy: CfProxy;
  private readonly context: vscode.ExtensionContext;
  private readonly bridge: EdgeBridgeServer;

  static createOrShow(context: vscode.ExtensionContext, proxy: CfProxy, bridge: EdgeBridgeServer): CfPanel {
    if (CfPanel.current) {
      CfPanel.current.panel.reveal();
      return CfPanel.current;
    }
    CfPanel.current = new CfPanel(context, proxy, bridge);
    return CfPanel.current;
  }

  private constructor(context: vscode.ExtensionContext, proxy: CfProxy, bridge: EdgeBridgeServer) {
    this.context = context;
    this.proxy = proxy;
    this.bridge = bridge;
    this.panel = vscode.window.createWebviewPanel(
      PANEL_TYPE,
      'Codeforces Inline',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      }
    );
    this.panel.webview.html = this.buildHtml();
    this.panel.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message);
    });
    this.panel.onDidDispose(() => {
      CfPanel.current = undefined;
    });
  }

  private async handleMessage(message: unknown): Promise<void> {
    const type = (message as { type?: string }).type;
    if (type === 'openLogin') {
      try {
        await loginWithEdgeBridge(this.bridge, this.proxy, (text) => {
          this.post({ type: 'loginProgress', text });
        });
        this.post({ type: 'loginProgress', text: '验证完成，正在加载 Codeforces 页面…' });
        this.post({ type: 'toast', text: 'Codeforces 已连接' });
        if (prefersIntegratedBrowser()) {
          try {
            this.post({ type: 'loginProgress', text: '正在打开 VS Code 集成浏览器…' });
            await openInIntegratedBrowser(this.proxy);
            this.post({ type: 'loginProgress', text: 'VS Code 集成浏览器已打开。' });
            this.panel.dispose();
          } catch (err) {
            this.post({ type: 'sessionImported' });
            void vscode.window.showWarningMessage(
              `Edge 会话已经连接，但无法打开 VS Code 集成浏览器：${err instanceof Error ? err.message : String(err)}`
            );
          }
        } else {
          this.post({ type: 'sessionImported' });
        }
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        this.post({ type: 'loginFailed', text });
        this.post({ type: 'toast', text });
        void vscode.window.showErrorMessage(text);
      }
      return;
    }
    if (type === 'installEdgeExtension') {
      await revealEdgeExtension(this.context);
      return;
    }
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private buildHtml(): string {
    const origin = this.proxy.origin;
    const defaultPath = JSON.stringify(this.proxy.currentUrlPath);
    const originJson = JSON.stringify(origin);
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-src ${origin}; connect-src ${origin}; img-src data:;">
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { display: flex; flex-direction: column; background: #1e1e1e; color: #d4d4d4; font-family: -apple-system, "Segoe UI", sans-serif; font-size: 13px; }
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid #333; background: #252526; }
  button { height: 28px; min-width: 32px; padding: 0 10px; border: 1px solid #3c3c3c; border-radius: 4px; background: #333; color: #d4d4d4; cursor: pointer; white-space: nowrap; }
  button:hover { background: #3e3e3e; }
  button:disabled { opacity: .45; cursor: default; }
  button.primary { background: #0e639c; border-color: #1177bb; }
  button.primary:hover { background: #1177bb; }
  .seg { display: flex; gap: 2px; }
  .seg button.active { background: #0e639c; border-color: #1177bb; }
  #url { flex: 1 1 220px; min-width: 160px; height: 28px; padding: 0 8px; border: 1px solid #3c3c3c; border-radius: 4px; background: #1e1e1e; color: #d4d4d4; }
  .status { display: flex; align-items: center; gap: 6px; padding: 0 4px; white-space: nowrap; }
  #statusText { max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #6b6b6b; }
  .dot.on { background: #4ec9b0; }
  .dot.off { background: #f14c4c; }
  .content { position: relative; flex: 1; min-height: 0; background: #fff; }
  #frame { width: 100%; height: 100%; border: 0; background: #fff; }
  #bridge { display: none; }
  .load-progress { position: absolute; top: 0; left: 0; height: 3px; width: 0; opacity: 0; background: #3794ff; box-shadow: 0 0 8px rgba(55,148,255,.8); z-index: 3; transition: width .2s ease, opacity .2s ease; }
  .load-progress.visible { opacity: 1; }
  .loading { position: absolute; inset: 3px 0 0; display: flex; align-items: center; justify-content: center; background: rgba(30,30,30,.82); z-index: 2; }
  .loading.hidden { display: none; }
  .loading-inner { min-width: 280px; max-width: min(520px, 90%); padding: 18px 22px; border: 1px solid #454545; border-radius: 7px; background: #252526; text-align: center; box-shadow: 0 6px 24px rgba(0,0,0,.3); }
  .spinner { width: 24px; height: 24px; margin: 0 auto 12px; border: 3px solid #555; border-top-color: #3794ff; border-radius: 50%; animation: spin .85s linear infinite; }
  #loadingText { margin: 0; color: #ddd; line-height: 1.5; }
  #loadingRetry { margin-top: 14px; }
  #loadingRetry.hidden { display: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .gate { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; background: #1e1e1e; z-index: 4; }
  .gate.hidden { display: none; }
  .gate-inner { width: min(520px, 100%); text-align: center; }
  .gate h2 { margin: 0 0 10px; font-size: 18px; font-weight: 600; }
  .gate p { margin: 0 0 16px; color: #b8b8b8; line-height: 1.6; }
  .edge-warning { margin: -4px 0 16px; padding: 10px 12px; border: 1px solid #b88320; border-radius: 5px; background: #3b3118; color: #f2d48a; line-height: 1.55; text-align: left; }
  .login-progress { margin: 0 auto 16px; padding: 13px 14px; border: 1px solid #3f3f46; border-radius: 6px; background: #252526; text-align: left; }
  .login-progress.hidden { display: none; }
  .login-progress.error { border-color: #a1260d; }
  .login-progress-row { display: flex; align-items: center; gap: 10px; min-height: 22px; }
  .login-spinner { flex: 0 0 auto; width: 18px; height: 18px; border: 2px solid #555; border-top-color: #3794ff; border-radius: 50%; animation: spin .85s linear infinite; }
  .login-progress.error .login-spinner { border-color: #f14c4c; animation: none; }
  #loginStage { min-width: 0; color: #ddd; line-height: 1.45; overflow-wrap: anywhere; }
  .login-progress-track { height: 4px; margin-top: 11px; overflow: hidden; border-radius: 2px; background: #3c3c3c; }
  #loginProgressBar { width: 0; height: 100%; border-radius: inherit; background: #3794ff; transition: width .35s ease; }
  .login-progress.error #loginProgressBar { background: #f14c4c; }
  .toast { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); max-width: 80%; padding: 8px 14px; border-radius: 4px; background: #333; color: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.35); z-index: 10; }
  .toast.hidden { display: none; }
</style>
</head>
<body>
  <div class="toolbar">
    <button id="back" title="后退">←</button>
    <button id="forward" title="前进">→</button>
    <button id="reload" title="刷新">⟳</button>
    <div class="seg">
      <button class="nav" data-path="/groups/my">我的群组</button>
      <button class="nav" data-path="/contests">比赛</button>
      <button class="nav" data-path="/gyms">训练营</button>
      <button class="nav" data-path="/problemset">题库</button>
    </div>
    <input id="url" type="text" readonly spellcheck="false" title="当前页面路径，由插件自动更新">
    <button id="login" title="连接 Edge 中的 Codeforces 登录状态">连接 Edge 会话</button>
    <div class="status"><span id="dot" class="dot off"></span><span id="statusText">未连接</span></div>
  </div>
  <div class="content">
    <iframe id="bridge" src="${origin}/__cf_inline/bridge"></iframe>
    <iframe id="frame" name="cfInlineMain"></iframe>
    <div id="loadProgress" class="load-progress"></div>
    <div id="loading" class="loading hidden">
      <div class="loading-inner">
        <div class="spinner"></div>
        <p id="loadingText">正在加载 Codeforces…</p>
        <button id="loadingRetry" class="hidden">重新加载</button>
      </div>
    </div>
    <div id="gate" class="gate">
      <div class="gate-inner">
        <h2 id="gateTitle">尚未连接 Codeforces Edge 会话</h2>
        <p>点击下方按钮连接 Edge 中的 Codeforces 登录状态。若尚未安装配套扩展，可先点击“首次安装配套扩展”。</p>
        <div class="edge-warning"><strong>注意：</strong>配套扩展只用于保持 Edge 登录会话，VS Code 中的 Codeforces 浏览界面和功能保持不变。</div>
        <div id="loginProgress" class="login-progress hidden" role="status" aria-live="polite">
          <div class="login-progress-row">
            <div class="login-spinner"></div>
            <div id="loginStage">正在连接 Edge…</div>
          </div>
          <div class="login-progress-track"><div id="loginProgressBar"></div></div>
        </div>
        <button id="gateInstall">首次安装配套扩展</button>
        <button id="gateLogin" class="primary">连接 Edge 会话</button>
      </div>
    </div>
  </div>
  <div id="toast" class="toast hidden"></div>
  <script>
    (function () {
      const vscodeApi = acquireVsCodeApi();
      const origin = ${originJson};
      const defaultPath = ${defaultPath};
      const bridge = document.getElementById('bridge');
      const frame = document.getElementById('frame');
      const urlInput = document.getElementById('url');
      const dot = document.getElementById('dot');
      const statusText = document.getElementById('statusText');
      const toast = document.getElementById('toast');
      const reloadBtn = document.getElementById('reload');
      const backBtn = document.getElementById('back');
      const forwardBtn = document.getElementById('forward');
      const loginBtn = document.getElementById('login');
      const gate = document.getElementById('gate');
      const gateTitle = document.getElementById('gateTitle');
      const gateLoginBtn = document.getElementById('gateLogin');
      const loginProgress = document.getElementById('loginProgress');
      const loginStage = document.getElementById('loginStage');
      const loginProgressBar = document.getElementById('loginProgressBar');
      const loading = document.getElementById('loading');
      const loadingText = document.getElementById('loadingText');
      const loadingRetry = document.getElementById('loadingRetry');
      const loadProgress = document.getElementById('loadProgress');
      let sessionReady = false;
      let frameLoaded = false;
      let hasReceivedState = false;
      let loginPending = false;
      let currentLoginStage = '正在连接 Edge…';
      let loginProgressValue = 0;
      let toastTimer;
      let progressTimer;
      let slowTimer;
      let stuckTimer;
      let progressValue = 0;

      function clearLoadingTimers() {
        clearInterval(progressTimer);
        clearTimeout(slowTimer);
        clearTimeout(stuckTimer);
      }

      function startLoading() {
        clearLoadingTimers();
        progressValue = 8;
        loadProgress.style.width = progressValue + '%';
        loadProgress.classList.add('visible');
        loading.classList.remove('hidden');
        loadingRetry.classList.add('hidden');
        loadingText.textContent = '正在加载 Codeforces…';
        progressTimer = setInterval(function () {
          progressValue = Math.min(88, progressValue + Math.max(0.5, (88 - progressValue) * 0.08));
          loadProgress.style.width = progressValue + '%';
        }, 350);
        slowTimer = setTimeout(function () {
          loadingText.textContent = '加载时间较长，仍在等待 Edge 返回页面…';
        }, 20000);
        stuckTimer = setTimeout(function () {
          clearInterval(progressTimer);
          loadingText.textContent = '页面可能已卡住，可以重新加载；Edge 会话不会因此退出。';
          loadingRetry.classList.remove('hidden');
        }, 60000);
      }

      function finishLoading() {
        clearLoadingTimers();
        loadProgress.style.width = '100%';
        loading.classList.add('hidden');
        setTimeout(function () {
          loadProgress.classList.remove('visible');
          loadProgress.style.width = '0';
        }, 250);
      }

      function cancelLoading() {
        clearLoadingTimers();
        loading.classList.add('hidden');
        loadingRetry.classList.add('hidden');
        loadProgress.classList.remove('visible');
        loadProgress.style.width = '0';
      }

      function failLoading(text) {
        clearLoadingTimers();
        loadProgress.classList.remove('visible');
        loading.classList.remove('hidden');
        loadingText.textContent = text;
        loadingRetry.classList.remove('hidden');
      }

      function navigate(path) {
        if (!sessionReady) {
          gate.classList.remove('hidden');
          showToast('请先在浏览器中完成验证');
          return;
        }
        startLoading();
        frame.src = origin + (path || defaultPath);
        frameLoaded = true;
      }

      function loginStageProgress(text) {
        if (text.includes('正在连接日常 Edge') || text.includes('正在读取日常 Edge')) return 10;
        if (text.includes('打开 Codeforces 官方登录页') || text.includes('请在日常 Edge')) return 20;
        if (text.includes('已检测到账号')) return 34;
        if (text.includes('正在限流预检')) return 40;
        if (text.includes('预处理进度 1/4')) return 51;
        if (text.includes('预处理进度 2/4')) return 63;
        if (text.includes('预处理进度 3/4')) return 75;
        if (text.includes('预处理进度 4/4')) return 86;
        if (text.includes('常用页面预处理完成')) return 89;
        if (text.includes('正在验证 我的群组')) return 48;
        if (text.includes('正在验证 比赛')) return 60;
        if (text.includes('正在验证 训练营')) return 72;
        if (text.includes('正在验证 题库')) return 84;
        if (text.includes('已确认日常 Edge') || text.includes('日常 Edge 会话已连接')) return 92;
        if (text.includes('会话已连接') || text.includes('验证完成，正在加载')) return 96;
        if (text.includes('正在打开 VS Code 集成浏览器')) return 98;
        if (text.includes('集成浏览器已打开') || text.includes('已经连接并验证通过')) return 100;
        return Math.min(90, loginProgressValue + 2);
      }

      function updateLoginProgress(text) {
        currentLoginStage = text || '正在连接 Codeforces…';
        loginPending = true;
        loginProgress.classList.remove('hidden', 'error');
        gateTitle.textContent = '正在连接 Codeforces';
        loginStage.textContent = currentLoginStage;
        loginProgressValue = Math.max(loginProgressValue, loginStageProgress(currentLoginStage));
        loginProgressBar.style.width = loginProgressValue + '%';
        statusText.textContent = currentLoginStage;
        statusText.title = currentLoginStage;
        loginBtn.disabled = true;
        loginBtn.textContent = '登录处理中…';
        gateLoginBtn.disabled = true;
        gateLoginBtn.textContent = '登录处理中…';
      }

      function showLoginFailure(text) {
        loginPending = false;
        currentLoginStage = '登录失败：' + (text || '未知错误');
        loginProgress.classList.remove('hidden');
        loginProgress.classList.add('error');
        gateTitle.textContent = 'Codeforces 登录未完成';
        loginStage.textContent = currentLoginStage;
        loginProgressValue = 100;
        loginProgressBar.style.width = '100%';
        statusText.textContent = '登录失败';
        statusText.title = currentLoginStage;
        loginBtn.disabled = false;
        loginBtn.textContent = '重新连接 Edge 会话';
        gateLoginBtn.disabled = false;
        gateLoginBtn.textContent = '重新打开 Edge 登录';
      }

      function openLogin() {
        if (loginPending || sessionReady) return;
        loginProgressValue = 0;
        updateLoginProgress('正在连接 Edge；登录或验证完成前请勿关闭相关标签页…');
        vscodeApi.postMessage({ type: 'openLogin' });
      }

      function showToast(text) {
        toast.textContent = text;
        toast.classList.remove('hidden');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toast.classList.add('hidden'); }, 4000);
      }

      function refresh() {
        if (bridge.contentWindow) {
          bridge.contentWindow.postMessage({ __cfInlineBridgeCommand: true, type: 'refresh' }, '*');
        }
      }

      function applyState(state) {
        const connected = !!state.sessionReady && !!state.loggedIn;
        if (hasReceivedState && sessionReady && !connected) {
          showToast('Edge 会话已断开，请重新连接');
        }
        hasReceivedState = true;
        dot.className = 'dot ' + (connected ? 'on' : 'off');
        if (connected) {
          loginPending = false;
          loginProgressValue = 100;
          loginProgressBar.style.width = '100%';
          statusText.textContent = '已登录 · Edge 已连接';
          statusText.title = '已登录 · Edge 已连接';
        } else {
          statusText.textContent = loginPending ? currentLoginStage : '未连接';
          statusText.title = loginPending ? currentLoginStage : '未连接';
        }
        sessionReady = connected;
        loginBtn.textContent = connected ? 'Edge 已连接' : (loginPending ? '登录处理中…' : '连接 Edge 会话');
        loginBtn.disabled = connected || loginPending;
        gateLoginBtn.disabled = loginPending;
        gate.classList.toggle('hidden', sessionReady);
        if (sessionReady && !frameLoaded) {
          navigate(state.currentPath || defaultPath);
        }
        if (!sessionReady) {
          cancelLoading();
          if (frameLoaded) {
            frame.src = 'about:blank';
          }
          frameLoaded = false;
        }
        reloadBtn.disabled = !connected;
        backBtn.disabled = !state.canGoBack;
        forwardBtn.disabled = !state.canGoForward;
        if (document.activeElement !== urlInput) {
          urlInput.value = state.currentPath;
        }
      }

      function go(direction) {
        if (bridge.contentWindow) {
          bridge.contentWindow.postMessage({
            __cfInlineBridgeCommand: true,
            type: 'go',
            dir: direction
          }, '*');
        }
      }

      backBtn.addEventListener('click', function () { go(-1); });
      forwardBtn.addEventListener('click', function () { go(1); });
      reloadBtn.addEventListener('click', function () {
        startLoading();
        const current = new URL(frame.src);
        current.searchParams.set('__reload', String(Date.now()));
        frame.src = current.toString();
      });
      document.querySelectorAll('.nav').forEach(function (btn) {
        btn.addEventListener('click', function () {
          document.querySelectorAll('.nav').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          navigate(btn.dataset.path);
        });
      });
      document.getElementById('login').addEventListener('click', openLogin);
      document.getElementById('gateLogin').addEventListener('click', openLogin);
      document.getElementById('gateInstall').addEventListener('click', function(){ vscodeApi.postMessage({ type: 'installEdgeExtension' }); });
      loadingRetry.addEventListener('click', function () {
        navigate(urlInput.value || defaultPath);
      });

      window.addEventListener('message', function (event) {
        const data = event.data || {};
        if (event.source === bridge.contentWindow && data.__cfInlineBridge) {
          if (data.type === 'state' && data.state) {
            applyState(data.state);
          } else if (data.type === 'navigate') {
            navigate(data.path);
          }
          return;
        }
        if (data.type === 'navigate') {
          navigate(data.url);
        } else if (data.type === 'loginProgress') {
          updateLoginProgress(String(data.text || '正在连接 Codeforces…'));
        } else if (data.type === 'sessionImported') {
          updateLoginProgress('验证完成，正在加载 Codeforces 页面…');
          frameLoaded = false;
          refresh();
        } else if (data.type === 'loginFailed') {
          showLoginFailure(String(data.text || '未知错误'));
        } else if (data.type === 'toast') {
          showToast(data.text);
        } else if (event.source === frame.contentWindow && data.__cfInlinePageLoading) {
          startLoading();
        } else if (event.source === frame.contentWindow && data.__cfInlinePageError) {
          failLoading('Edge 请求失败：' + String(data.message || '未知错误'));
        } else if (event.source === frame.contentWindow && data.__cfInlinePageReady) {
          if (Number(data.status) >= 400) {
            failLoading('Codeforces 页面返回错误，可以重新加载。');
          } else {
            finishLoading();
          }
        } else if (event.source === frame.contentWindow && data.__cfInlineUrl) {
          const shown = String(data.__cfInlineUrl);
          urlInput.value = shown.indexOf(origin) === 0 ? (shown.slice(origin.length) || '/') : shown;
        }
      });

      frame.addEventListener('error', function () {
        failLoading('页面载入失败，请检查 Edge 会话后重新加载。');
      });

      setInterval(refresh, 1200);
      refresh();
    })();
  </script>
</body>
</html>`;
  }
}
