const PORTS = Array.from({ length: 10 }, (_, index) => 27121 + index);
const BRIDGE_PATH = '/cf-inline-edge-bridge';
const BRIDGE_PROTOCOL = 3;
const EXECUTION_TAB_URL = 'https://codeforces.com/#__cf_inline_bridge';
const CODEFORCES_TAB_PATTERNS = [
  'https://codeforces.com/*',
  'https://m1.codeforces.com/*',
  'https://m2.codeforces.com/*',
  'https://m3.codeforces.com/*'
];
let socket;
let heartbeat;
let executionTabId;
let executionTabOwned = false;
let sessionPublishTimer;

function sendBridgeMessage(channel, message) {
  if (!channel || channel.readyState !== WebSocket.OPEN) return false;
  try {
    channel.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function isAuthorizedCodeforcesUrl(value) {
  try {
    const host = new URL(String(value || '')).hostname.toLowerCase();
    return host === 'codeforces.com' || /^m[1-3]\.codeforces\.com$/.test(host);
  } catch {
    return false;
  }
}

function isLoginUrl(value) {
  try { return /^\/enter(?:\/|$)/i.test(new URL(String(value || '')).pathname); }
  catch { return false; }
}

function isDedicatedExecutionUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return isAuthorizedCodeforcesUrl(parsed.href) && parsed.hash === '#__cf_inline_bridge';
  } catch {
    return false;
  }
}

function isScriptAccessError(error) {
  return /cannot access contents|must request permission|cannot access a chrome:\/\/ url|extensions gallery cannot be scripted/i
    .test(error instanceof Error ? error.message : String(error));
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  tryPort(0);
}

function tryPort(index) {
  if (index >= PORTS.length) {
    setTimeout(connect, 1500);
    return;
  }
  const candidate = new WebSocket(`ws://127.0.0.1:${PORTS[index]}${BRIDGE_PATH}`);
  // Record CONNECTING sockets as well as OPEN sockets. Extension startup,
  // alarms and content-script wakeups can otherwise start several parallel
  // port scans before the first WebSocket reaches onopen. Those connections
  // then replace one another and interrupt an active login or page request.
  socket = candidate;
  let opened = false;
  candidate.onopen = () => {
    opened = true;
    clearInterval(heartbeat);
    heartbeat = setInterval(() => {
      sendBridgeMessage(candidate, { type: 'heartbeat' });
    }, 20000);
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#16883f' });
    // Confirm the bridge protocol immediately. Reading cookies and inspecting
    // a Codeforces tab can be slow, so publish that state separately instead
    // of making the protocol handshake wait for page inspection.
    sendBridgeMessage(candidate, {
      type: 'ready',
      protocol: BRIDGE_PROTOCOL,
      extensionVersion: chrome.runtime.getManifest().version,
      userAgent: navigator.userAgent,
      valid: false
    });
    publishSession(candidate, 'sessionState');
  };
  candidate.onmessage = (event) => handleMessage(candidate, event.data);
  candidate.onerror = () => undefined;
  candidate.onclose = () => {
    if (socket !== candidate) return;
    socket = undefined;
    clearInterval(heartbeat);
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#b3261e' });
    if (opened) setTimeout(connect, 1000);
    else tryPort(index + 1);
  };
}

async function publishSession(channel = socket, type = 'sessionState') {
  if (!channel || channel.readyState !== WebSocket.OPEN) return;
  try {
    const cookies = await codeforcesCookies();
    const cookieValid = cookies.some((cookie) => cookie.name === 'X-User-Sha1' && /^[0-9a-f]{40}$/i.test(cookie.value) && !/^0+$/.test(cookie.value));
    const pageValid = !!(await findAuthenticatedTab());
    sendBridgeMessage(channel, {
      type,
      protocol: BRIDGE_PROTOCOL,
      cookies: exportedCookies(cookies),
      userAgent: navigator.userAgent,
      valid: cookieValid || pageValid
    });
  } catch (error) {
    sendBridgeMessage(channel, { type, protocol: BRIDGE_PROTOCOL, valid: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function scheduleSessionPublish(delayMs = 250) {
  clearTimeout(sessionPublishTimer);
  sessionPublishTimer = setTimeout(() => publishSession(), delayMs);
}

async function handleMessage(channel, raw) {
  let message;
  try { message = JSON.parse(raw); } catch { return; }
  if (message.type !== 'task' || typeof message.id !== 'number') return;
  const progress = (text) => sendBridgeMessage(channel, { type: 'progress', id: message.id, message: text });
  try {
    const value = await runTask(message.action, message.payload || {}, progress);
    sendBridgeMessage(channel, { type: 'result', id: message.id, ok: true, value });
  } catch (error) {
    sendBridgeMessage(channel, { type: 'result', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

async function runTask(action, payload, progress) {
  if (action === 'loginState') return { valid: await hasAuthenticatedSession() };
  if (action === 'authenticate') return authenticate(!!payload.interactive, progress);
  if (action === 'minimizeCodeforcesWindow') return minimizeCodeforcesWindow();
  if (action === 'resetExecutionTab') {
    await discardExecutionTab(executionTabId);
    return { reset: true };
  }
  if (action === 'request') return browserRequest(payload);
  if (action === 'submit') return submitSolution(payload, progress);
  throw new Error(`不支持的桥接任务：${action}`);
}

async function minimizeCodeforcesWindow() {
  const activeTabs = await chrome.tabs.query({ active: true, url: CODEFORCES_TAB_PATTERNS });
  let tab = activeTabs.find((candidate) => typeof candidate.windowId === 'number');
  if (!tab) {
    const tabs = await chrome.tabs.query({ url: CODEFORCES_TAB_PATTERNS });
    tab = tabs
      .filter((candidate) => typeof candidate.windowId === 'number')
      .sort((left, right) => Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0))[0];
  }
  if (!tab || typeof tab.windowId !== 'number') return { minimized: false };
  await chrome.windows.update(tab.windowId, { state: 'minimized' });
  return { minimized: true };
}

async function codeforcesCookies() {
  return chrome.cookies.getAll({ domain: 'codeforces.com' });
}

async function hasLoginCookie() {
  const cookies = await codeforcesCookies();
  return cookies.some((cookie) => cookie.name === 'X-User-Sha1' && /^[0-9a-f]{40}$/i.test(cookie.value) && !/^0+$/.test(cookie.value));
}

async function hasAuthenticatedSession() {
  return (await hasLoginCookie()) || !!(await findAuthenticatedTab());
}

function exportedCookies(cookies) {
  return cookies.map((cookie) => ({
    name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path,
    expires: cookie.expirationDate, httpOnly: cookie.httpOnly, secure: cookie.secure,
    sameSite: cookie.sameSite === 'strict' ? 'Strict' : cookie.sameSite === 'no_restriction' ? 'None' : 'Lax'
  }));
}

async function findAuthenticatedTab() {
  const tabs = await chrome.tabs.query({ url: CODEFORCES_TAB_PATTERNS });
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          anonymous: /^\/enter(?:\/|$)/i.test(location.pathname) || !!document.querySelector('#enterForm'),
          authenticated: (() => {
            const login = document.querySelector('a[href*="/enter"], #enterForm');
            const logout = document.querySelector('a[href*="/logout"], form[action*="/logout"]');
            const profile = document.querySelector('a[href*="/profile/"]');
            // Codeforces occasionally renders logout as a form or omits it
            // while rebuilding the top navigation after login. A profile link
            // with no login control is still positive rendered-page evidence;
            // an anonymous visitor on somebody else's profile keeps /enter.
            return !!profile && (!!logout || !login);
          })(),
          challenged: /Just a moment|Checking your browser|请稍候/i.test(document.title) || !!document.querySelector('[id*="challenge"],script[src*="challenge-platform"]')
        })
      });
      if (result?.authenticated) return tab;
    } catch { /* a navigating tab is retried below */ }
  }
  return undefined;
}

async function authenticate(interactive, progress) {
  const started = Date.now();
  while (Date.now() - started < (interactive ? 10 * 60_000 : 20_000)) {
    const cookies = await codeforcesCookies();
    const cookieValid = cookies.some((cookie) => cookie.name === 'X-User-Sha1' && /^[0-9a-f]{40}$/i.test(cookie.value) && !/^0+$/.test(cookie.value));
    const pageValid = !!(await findAuthenticatedTab());
    if (cookieValid || pageValid) {
      progress('已读取日常 Edge 中的 Codeforces 登录状态');
      return { cookies: exportedCookies(cookies), userAgent: navigator.userAgent, valid: true };
    }
    if (!interactive) {
      throw new Error('日常 Edge 中没有可自动恢复的 Codeforces 登录');
    }
    progress('正在等待日常 Edge 完成 Codeforces 账号登录');
    await delay(1000);
  }
  throw new Error('等待日常 Edge 登录超时');
}

async function restoreExecutionTab() {
  if (executionTabId) return executionTabId;
  try {
    const saved = await chrome.storage.session.get('executionTab');
    const value = saved?.executionTab;
    if (Number.isInteger(value?.id)) {
      executionTabId = value.id;
      executionTabOwned = value.owned === true;
    }
  } catch { /* session storage can be unavailable during browser shutdown */ }
  return executionTabId;
}

async function rememberExecutionTab(tabId, owned) {
  executionTabId = tabId;
  executionTabOwned = owned;
  await chrome.storage.session.set({ executionTab: { id: tabId, owned } }).catch(() => undefined);
}

async function clearExecutionTab() {
  executionTabId = undefined;
  executionTabOwned = false;
  await chrome.storage.session.remove('executionTab').catch(() => undefined);
}

async function ensureExecutionTab(active = false, forceNew = false) {
  const savedTabId = await restoreExecutionTab();
  if (savedTabId && !forceNew) {
    try {
      const cached = await chrome.tabs.get(savedTabId);
      if (cached.id && isAuthorizedCodeforcesUrl(cached.url) && !isLoginUrl(cached.url)) {
        return cached;
      }
    } catch { /* the cached tab was closed */ }
    await clearExecutionTab();
  }
  if (!forceNew) {
    const tabs = await chrome.tabs.query({ url: CODEFORCES_TAB_PATTERNS });
    const usable = tabs
      .filter((tab) => tab.id && isAuthorizedCodeforcesUrl(tab.url) && !isLoginUrl(tab.url))
      .sort((left, right) => Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0))[0];
    if (usable) {
      await rememberExecutionTab(usable.id, false);
      return usable;
    }
  }
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  let tab;
  if (windows.length) {
    tab = await chrome.tabs.create({ windowId: windows[0].id, url: EXECUTION_TAB_URL, active });
  } else {
    const created = await chrome.windows.create({ url: EXECUTION_TAB_URL, focused: active, type: 'normal' });
    tab = created.tabs?.[0];
  }
  if (!tab?.id) throw new Error('无法创建 Codeforces 后台标签页');
  await rememberExecutionTab(tab.id, true);
  await waitForTab(tab.id, 20000);
  return tab;
}

async function discardExecutionTab(tabId) {
  const owned = executionTabOwned;
  await clearExecutionTab();
  if (!tabId) return;
  try {
    // Never close a normal tab selected from the user's daily Edge. Only the
    // background fallback tab created by this bridge may be removed.
    if (owned) await chrome.tabs.remove(tabId);
  } catch { /* already closed */ }
}

async function browserRequest(request) {
  const timeoutMs = Math.max(10000, Number(request.timeoutMs) || 30000);
  const retryable = /^(?:GET|HEAD)$/i.test(String(request.method || 'GET'));
  try {
    return await executeBrowserRequest(request, timeoutMs);
  } catch (error) {
    if (!retryable || !isScriptAccessError(error)) throw error;
    // A cached tab may have navigated to an internal/unapproved page between
    // selection and script injection. Discard it and retry one read-only
    // request in a newly selected authorized Codeforces tab.
    await discardExecutionTab(executionTabId);
    return executeBrowserRequest(request, timeoutMs, true);
  }
}

async function executeBrowserRequest(request, timeoutMs, forceNew = false) {
  const tab = await ensureExecutionTab(false, forceNew);
  const fresh = await chrome.tabs.get(tab.id);
  if (!isAuthorizedCodeforcesUrl(fresh.url) || isLoginUrl(fresh.url)) {
    await clearExecutionTab();
    throw new Error('Codeforces 执行标签页已跳转到未授权页面，请重新连接 Edge');
  }
  let injection;
  try {
    injection = await withTimeout(chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: async (input) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs || 30000);
      try {
        const bytes = input.bodyBase64 ? Uint8Array.from(atob(input.bodyBase64), (char) => char.charCodeAt(0)) : undefined;
        const method = String(input.method || 'GET').toUpperCase();
        const response = await fetch(input.url, {
          method: input.method, headers: input.headers, body: bytes && bytes.length ? bytes : undefined,
          credentials: 'include', redirect: 'follow', cache: method === 'GET' ? 'default' : 'no-store', signal: controller.signal
        });
        const buffer = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < buffer.length; offset += 32768) binary += String.fromCharCode(...buffer.subarray(offset, offset + 32768));
        return { statusCode: response.status, headers: Object.fromEntries(response.headers.entries()), bodyBase64: btoa(binary), finalUrl: response.url };
      } finally { clearTimeout(timer); }
      },
      args: [request]
    }), timeoutMs + 2000, 'Edge 页面脚本执行超时');
  } catch (error) {
    const current = await chrome.tabs.get(tab.id).catch(() => undefined);
    const targetUrl = String(current?.url || fresh.url || '未知网址');
    throw new Error(`${error instanceof Error ? error.message : String(error)}（执行标签页：${targetUrl}）`);
  }
  const [{ result }] = injection;
  if (!result) throw new Error('日常 Edge 页面没有返回请求结果');
  return result;
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

async function submitSolution(request, progress) {
  progress('正在日常 Edge 中打开 Codeforces 官方提交页面…');
  const tab = await chrome.tabs.create({ url: request.url, active: true });
  await waitForTab(tab.id, 60000);
  const originalUrl = tab.url || request.url;
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id }, world: 'MAIN',
    func: (input) => {
      const form = document.querySelector('form.submit-form');
      const text = String(document.body?.innerText || '');
      if (!form) {
        if (/complete the anti-bot verification|Just a moment|Checking your browser/i.test(text + document.title))
          throw new Error('请在当前 Edge 标签页完成反机器人验证后重新提交');
        if (/^\/enter(?:\/|$)/i.test(location.pathname)) throw new Error('Codeforces 登录状态已失效，请重新登录');
        throw new Error('Codeforces 官方提交页面未找到提交表单');
      }
      const source = input.source;
      const set = (name, value) => {
        let control = form.querySelector(`[name="${name}"]`);
        if (!control) { control = document.createElement('input'); control.type = 'hidden'; control.name = name; form.appendChild(control); }
        control.value = String(value);
      };
      const csrf = form.querySelector('input[name="csrf_token"]')?.value || document.querySelector('meta[name="X-Csrf-Token" i]')?.content || '';
      const ftaa = String(window._ftaa || ''); const bfaa = String(window._bfaa || '');
      if (!csrf || !ftaa || !bfaa) throw new Error('Codeforces 官方校验信息尚未就绪，请等待页面加载完成后重新提交');
      set('csrf_token', csrf); set('ftaa', ftaa); set('bfaa', bfaa); set('action', 'submitSolutionFormSubmitted');
      set('contestId', input.contestId); set('submittedProblemIndex', input.index); set('submittedProblemCode', input.contestId + input.index);
      set('programTypeId', input.programTypeId); set('source', source); set('sourceSize', String(new TextEncoder().encode(source).length)); set('tabSize', '4');
      // Codeforces normally targets a hidden iframe (submitFrameForm). A
      // sub-frame completion is not reported through chrome.tabs.onUpdated,
      // which made the bridge wait until its 90-second timeout even though the
      // official form had already answered. Submit the same official form in
      // the top-level tab so its real success/error response can be observed.
      form.removeAttribute('target');
      form.classList.remove('submitFrameForm');
      setTimeout(() => HTMLFormElement.prototype.submit.call(form), 500);
      return { scheduled: true };
    }, args: [request]
  });
  if (!result?.scheduled) throw new Error('Codeforces 官方表单未能发起提交');
  await waitForNavigation(tab.id, originalUrl, 90000);
  const [{ result: page }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({ html: document.documentElement?.outerHTML || '', url: location.href })
  });
  if (!page?.html) throw new Error('Codeforces 官方提交页面没有返回结果');
  const bytes = new TextEncoder().encode(page.html); let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  progress('代码已通过日常 Edge 提交，正在读取 Codeforces 结果…');
  return { statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, bodyBase64: btoa(binary), finalUrl: page.url };
}

function waitForNavigation(tabId, originalUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    let started = false;
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error('等待 Codeforces 官方提交结果超时')); }, timeoutMs);
    function listener(id, info, tab) {
      if (id !== tabId) return;
      if (info.status === 'loading' || (info.url && info.url !== originalUrl)) started = true;
      if (started && info.status === 'complete') { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(tab); }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function waitForTab(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error('Edge 页面加载超时')); }, timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(); }
    }
    chrome.tabs.get(tabId).then((tab) => { if (tab.status === 'complete') { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(); } }).catch(() => undefined);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
chrome.runtime.onInstalled.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
chrome.alarms.create('cfInlineReconnect', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'cfInlineReconnect') connect(); });
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'cfInlineWake') {
    connect();
    if (isAuthorizedCodeforcesUrl(sender?.tab?.url || sender?.url || '')) scheduleSessionPublish(350);
  }
});
chrome.cookies.onChanged.addListener((change) => {
  if (/codeforces\.com$/i.test(String(change.cookie?.domain || '').replace(/^\./, ''))) scheduleSessionPublish();
});
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  // A successful login may only change the rendered account controls while
  // the long-lived cookie remains unchanged. Re-check the page after every
  // completed Codeforces navigation so VS Code is notified immediately.
  const targetUrl = String(changeInfo.url || tab?.url || '');
  if (isAuthorizedCodeforcesUrl(targetUrl) && (changeInfo.status === 'complete' || !!changeInfo.url)) {
    scheduleSessionPublish(changeInfo.status === 'complete' ? 100 : 500);
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === executionTabId) void clearExecutionTab();
});
connect();
