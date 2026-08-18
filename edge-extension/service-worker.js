const PORTS = Array.from({ length: 10 }, (_, index) => 27121 + index);
const BRIDGE_PATH = '/cf-inline-edge-bridge';
const BRIDGE_PROTOCOL = 5;
const EXECUTION_TAB_URL = 'https://codeforces.com/#__cf_inline_bridge';
const MAX_CONCURRENT_BROWSER_REQUESTS = 8;
const CODEFORCES_TAB_PATTERNS = [
  'https://codeforces.com/*',
  'https://m1.codeforces.com/*',
  'https://m2.codeforces.com/*',
  'https://m3.codeforces.com/*'
];
// Keep one WebSocket per possible VS Code bridge port. VS Code extensions run
// once per window, so another window (or a host that is still shutting down)
// may already own the first port. Connecting only to the first live port leaves
// every other window waiting forever even though the Edge extension is active.
const sockets = new Map();
const heartbeats = new Map();
const reconnectTimers = new Map();
let executionTabId;
let executionTabOwned = false;
let executionTabPromise;
let sessionPublishTimer;
let activeBrowserRequests = 0;
let submissionPending = false;
let submissionTail = Promise.resolve();
const browserRequestQueue = [];
const requestIdleWaiters = [];

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
  PORTS.forEach((port) => connectPort(port));
}

function connectPort(port) {
  const current = sockets.get(port);
  if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) return;
  clearTimeout(reconnectTimers.get(port));
  reconnectTimers.delete(port);
  const candidate = new WebSocket(`ws://127.0.0.1:${port}${BRIDGE_PATH}`);
  // Record CONNECTING sockets before onopen. Startup alarms and content-script
  // wakeups can otherwise create parallel reconnect chains for the same port.
  sockets.set(port, candidate);
  let opened = false;
  candidate.onopen = () => {
    opened = true;
    clearInterval(heartbeats.get(port));
    heartbeats.set(port, setInterval(() => {
      sendBridgeMessage(candidate, { type: 'heartbeat' });
    }, 20000));
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
    if (sockets.get(port) !== candidate) return;
    sockets.delete(port);
    clearInterval(heartbeats.get(port));
    heartbeats.delete(port);
    if (![...sockets.values()].some((channel) => channel.readyState === WebSocket.OPEN)) {
      chrome.action.setBadgeText({ text: 'OFF' });
      chrome.action.setBadgeBackgroundColor({ color: '#b3261e' });
    }
    const timer = setTimeout(() => {
      reconnectTimers.delete(port);
      connectPort(port);
    }, opened ? 1000 : 5000);
    reconnectTimers.set(port, timer);
  };
}

async function publishSession(channel, type = 'sessionState') {
  const channels = channel
    ? [channel]
    : [...sockets.values()].filter((item) => item.readyState === WebSocket.OPEN);
  if (channels.length === 0) return;
  try {
    const cookies = await codeforcesCookies();
    const cookieValid = cookies.some((cookie) => cookie.name === 'X-User-Sha1' && /^[0-9a-f]{40}$/i.test(cookie.value) && !/^0+$/.test(cookie.value));
    const pageValid = cookieValid ? false : !!(await findAuthenticatedTab());
    const message = {
      type,
      protocol: BRIDGE_PROTOCOL,
      cookies: exportedCookies(cookies),
      userAgent: navigator.userAgent,
      valid: cookieValid || pageValid
    };
    channels.forEach((item) => sendBridgeMessage(item, message));
  } catch (error) {
    const message = { type, protocol: BRIDGE_PROTOCOL, valid: false, error: error instanceof Error ? error.message : String(error) };
    channels.forEach((item) => sendBridgeMessage(item, message));
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
  if (action === 'request') return scheduleBrowserRequest(payload);
  if (action === 'submit') return scheduleSubmission(payload, progress);
  throw new Error(`不支持的桥接任务：${action}`);
}

function scheduleBrowserRequest(payload) {
  return new Promise((resolve, reject) => {
    browserRequestQueue.push({ payload, priority: Number(payload?.priority) || 0, resolve, reject });
    browserRequestQueue.sort((left, right) => right.priority - left.priority);
    pumpBrowserRequests();
  });
}

function pumpBrowserRequests() {
  if (submissionPending) return;
  while (activeBrowserRequests < MAX_CONCURRENT_BROWSER_REQUESTS && browserRequestQueue.length) {
    const item = browserRequestQueue.shift();
    activeBrowserRequests += 1;
    browserRequest(item.payload).then(item.resolve, item.reject).finally(() => {
      activeBrowserRequests -= 1;
      if (activeBrowserRequests === 0) {
        while (requestIdleWaiters.length) requestIdleWaiters.shift()();
      }
      pumpBrowserRequests();
    });
  }
}

function waitForBrowserRequestsToFinish() {
  if (activeBrowserRequests === 0) return Promise.resolve();
  return new Promise((resolve) => requestIdleWaiters.push(resolve));
}

function scheduleSubmission(payload, progress) {
  const scheduled = submissionTail.catch(() => undefined).then(async () => {
    submissionPending = true;
    await waitForBrowserRequestsToFinish();
    try {
      return await performSubmission(payload, progress);
    } finally {
      submissionPending = false;
      pumpBrowserRequests();
    }
  });
  submissionTail = scheduled.catch(() => undefined);
  return scheduled;
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
    const pageValid = cookieValid ? false : !!(await findAuthenticatedTab());
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
  if (executionTabPromise) return executionTabPromise;
  const pending = (async () => {
    const savedTabId = await restoreExecutionTab();
    if (forceNew && savedTabId) await discardExecutionTab(savedTabId);
    else if (savedTabId) {
      try {
        const cached = await chrome.tabs.get(savedTabId);
        // Only reuse a tab created and owned by this extension. Daily tabs are
        // used for login detection only and are never navigated or scripted as
        // the request/submission workspace.
        if (executionTabOwned && cached.id && isAuthorizedCodeforcesUrl(cached.url) && !isLoginUrl(cached.url)) {
          return cached;
        }
      } catch { /* the cached tab was closed */ }
      await clearExecutionTab();
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
  })();
  executionTabPromise = pending;
  try {
    return await pending;
  } finally {
    if (executionTabPromise === pending) executionTabPromise = undefined;
  }
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

async function releaseExecutionTabForUser(tabId) {
  if (tabId !== executionTabId) return;
  await clearExecutionTab();
}

async function browserRequest(request) {
  const timeoutMs = Math.max(10000, Number(request.timeoutMs) || 30000);
  const retryable = /^(?:GET|HEAD)$/i.test(String(request.method || 'GET'));
  try {
    return await executeBrowserRequest(request, timeoutMs);
  } catch (error) {
    if (!retryable || !isScriptAccessError(error)) throw error;
    // Several resource requests may observe the same failed tab together.
    // Only the first one may discard it; later retries reuse the replacement
    // instead of repeatedly closing each other's freshly created workspace.
    const failedTabId = Number(error?.executionTabId) || 0;
    if (failedTabId && executionTabId === failedTabId) await discardExecutionTab(failedTabId);
    return executeBrowserRequest(request, timeoutMs);
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
      world: 'ISOLATED',
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
    const wrapped = new Error(`${error instanceof Error ? error.message : String(error)}（执行标签页：${targetUrl}）`);
    wrapped.executionTabId = tab.id;
    throw wrapped;
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

async function performSubmission(request, progress) {
  progress('正在后台复用 Edge 官方提交页面…');
  const tab = await ensureExecutionTab(false);
  const startedAt = Date.now();
  let handedToUser = false;
  try {
    await chrome.tabs.update(tab.id, { url: request.url, active: false });
    await waitForTab(tab.id, 60000);
    const submitTab = await chrome.tabs.get(tab.id);
    const originalUrl = submitTab.url || request.url;
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
        form.removeAttribute('target');
        form.classList.remove('submitFrameForm');
        setTimeout(() => HTMLFormElement.prototype.submit.call(form), 120);
        return { scheduled: true };
      }, args: [request]
    });
    if (!result?.scheduled) throw new Error('Codeforces 官方表单未能发起提交');
    await waitForNavigation(tab.id, originalUrl, 90000);
    const [{ result: page }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (input) => {
        const direct = location.pathname.match(/\/submission\/(\d+)/i);
        let submissionId = direct?.[1] || '';
        const routePattern = new RegExp(
          `(?:/(?:contest|gym)/${input.contestId}/problem/${input.index}|/problemset/problem/${input.contestId}/${input.index}|/group/[^/]+/contest/${input.contestId}/problem/${input.index})(?:/|$)`,
          'i'
        );
        if (!submissionId) {
          for (const row of document.querySelectorAll('tr')) {
            const problemMatches = Array.from(row.querySelectorAll('a[href]')).some((link) => {
              try { return routePattern.test(new URL(link.href, location.href).pathname); } catch { return false; }
            });
            if (!problemMatches) continue;
            const link = row.querySelector('a[href*="/submission/"]');
            const match = link?.getAttribute('href')?.match(/\/submission\/(\d+)/i);
            const candidate = row.getAttribute('data-submission-id') || match?.[1] || '';
            if (/^\d+$/.test(candidate)) { submissionId = candidate; break; }
          }
        }
        if (!submissionId) {
          const profile = document.querySelector('a[href*="/profile/"]')?.getAttribute('href')?.match(/\/profile\/([^/?#]+)/i);
          if (profile?.[1]) {
            try {
              const response = await fetch(`/api/user.status?handle=${encodeURIComponent(profile[1])}&from=1&count=20`, { cache: 'no-store' });
              const data = await response.json();
              const previous = /^\d+$/.test(String(input.previousSubmissionId || '')) ? Number(input.previousSubmissionId) : 0;
              const candidate = Array.isArray(data?.result) ? data.result.find((entry) =>
                Number(entry?.id) > previous &&
                String(entry?.problem?.contestId || '') === String(input.contestId) &&
                String(entry?.problem?.index || '').toUpperCase() === String(input.index).toUpperCase() &&
                Number(entry?.creationTimeSeconds) * 1000 >= Number(input.startedAt) - 90000
              ) : undefined;
              if (candidate && /^\d+$/.test(String(candidate.id))) submissionId = String(candidate.id);
            } catch { /* the VS Code poller can still resolve the id */ }
          }
        }
        return { html: document.documentElement?.outerHTML || '', url: location.href, submissionId };
      }, args: [{ ...request, startedAt }]
    });
    if (!page?.html) throw new Error('Codeforces 官方提交页面没有返回结果');
    const bytes = new TextEncoder().encode(page.html); let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    progress('代码已通过日常 Edge 提交，正在读取 Codeforces 结果…');
    const headers = { 'content-type': 'text/html; charset=utf-8' };
    if (/^\d+$/.test(String(page.submissionId || ''))) headers['x-cf-inline-submission-id'] = String(page.submissionId);
    return { statusCode: 200, headers, bodyBase64: btoa(binary), finalUrl: page.url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/反机器人验证|登录状态已失效|未找到提交表单/i.test(message)) {
      handedToUser = true;
      await releaseExecutionTabForUser(tab.id);
      await chrome.tabs.update(tab.id, { active: true }).catch(() => undefined);
    }
    throw error;
  } finally {
    if (!handedToUser && executionTabId === tab.id) {
      await chrome.tabs.update(tab.id, { url: EXECUTION_TAB_URL, active: false }).catch(() => undefined);
      await waitForTab(tab.id, 20000).catch(() => undefined);
    }
  }
}

function waitForNavigation(tabId, originalUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    let started = false;
    const cleanup = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(removed);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('等待 Codeforces 官方提交结果超时')); }, timeoutMs);
    function listener(id, info, tab) {
      if (id !== tabId) return;
      if (info.status === 'loading' || (info.url && info.url !== originalUrl)) started = true;
      if (started && info.status === 'complete') { cleanup(); resolve(tab); }
    }
    function removed(id) { if (id === tabId) { cleanup(); reject(new Error('Edge 后台执行页已被关闭')); } }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.onRemoved.addListener(removed);
  });
}

function waitForTab(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(removed);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => finish(new Error('Edge 页面加载超时')), timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') finish();
    }
    function removed(id) { if (id === tabId) finish(new Error('Edge 后台执行页已被关闭')); }
    chrome.tabs.get(tabId).then((tab) => { if (tab.status === 'complete') finish(); }).catch((error) => finish(error instanceof Error ? error : new Error(String(error))));
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.onRemoved.addListener(removed);
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
