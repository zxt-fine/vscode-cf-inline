const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

async function main() {
  const executable = await findEdge();
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-inline-edge-smoke-'));
  const port = await freePort();
  const child = spawn(executable, [
    '--headless=new',
    '--disable-gpu',
    '--disable-sync',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    'https://codeforces.com/groups/my',
  ], { stdio: 'ignore', windowsHide: true });

  try {
    const target = await waitForTarget(port);
    const cdp = await connect(target.webSocketDebuggerUrl);
    try {
      await waitForDocument(cdp);
      const identity = await cdp.send('Runtime.evaluate', {
        expression: '({url: location.href, title: document.title, origin: location.origin})',
        returnByValue: true,
      });
      const fetchResult = await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          try {
            const response = await fetch('/groups/my', { credentials: 'include', cache: 'no-store' });
            const buffer = new Uint8Array(await response.arrayBuffer());
            let binary = '';
            for (let offset = 0; offset < buffer.length; offset += 32768) {
              binary += String.fromCharCode(...buffer.subarray(offset, offset + 32768));
            }
            return {
              status: response.status,
              headers: Object.fromEntries(response.headers.entries()),
              finalUrl: response.url,
              bodyBase64: btoa(binary)
            };
          } catch (error) {
            return { error: error instanceof Error ? error.message : String(error) };
          }
        })()`,
        awaitPromise: true,
        returnByValue: true,
      }, 60000);
      const value = fetchResult?.result?.value;
      const decoded = value?.bodyBase64 ? Buffer.from(value.bodyBase64, 'base64').toString('utf8') : '';
      await delay(2000);
      const pageTargets = (await json(`http://127.0.0.1:${port}/json/list`))
        .filter((item) => item.type === 'page')
        .map((item) => ({ title: item.title, url: item.url }));
      process.stdout.write(`${JSON.stringify({
        pageTargets,
        identity,
        fetchResult: {
          exceptionDetails: fetchResult?.exceptionDetails,
          type: fetchResult?.result?.type,
          status: value?.status,
          finalUrl: value?.finalUrl,
          contentType: value?.headers?.['content-type'],
          bodyBytes: value?.bodyBase64 ? Buffer.from(value.bodyBase64, 'base64').length : 0,
          html: /<html\b|<!doctype\s+html/i.test(decoded),
          challenge: /Just a moment|cdn-cgi\/challenge-platform|cf-chl-/i.test(decoded),
          error: value?.error,
        },
      }, null, 2)}\n`);
    } finally {
      cdp.close();
    }
  } finally {
    child.kill();
    await onceExit(child, 5000);
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

async function waitForDocument(cdp) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: 'location.href',
      returnByValue: true,
    });
    if (/^https:\/\/codeforces\.com\//.test(result?.result?.value || '')) return;
    await delay(250);
  }
  throw new Error('Codeforces document did not finish navigation');
}

class Client {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params, timeout = 10000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out: ${method}`));
      }, timeout);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { this.socket.close(); }
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(new Client(socket)));
    socket.once('error', reject);
  });
}

async function waitForTarget(port) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const targets = await json(`http://127.0.0.1:${port}/json/list`);
      const target = targets.find((item) => item.type === 'page' && /^https:\/\/codeforces\.com\//.test(item.url));
      if (target?.webSocketDebuggerUrl) return target;
    } catch {}
    await delay(250);
  }
  throw new Error('Edge did not expose the Codeforces page target');
}

function json(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (error) { reject(error); }
      });
    });
    request.setTimeout(2000, () => request.destroy(new Error('timeout')));
    request.on('error', reject);
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function findEdge() {
  const candidates = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { await fs.access(candidate); return candidate; } catch {}
  }
  throw new Error('Microsoft Edge was not found');
}

function onceExit(child, timeout) {
  if (child.exitCode !== null) return Promise.resolve();
  return Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(timeout),
  ]);
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
