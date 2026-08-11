export interface LocalizationOptions {
  localizeInterface: boolean;
  autoTranslateStatements: boolean;
}

export const CONTROLLED_CODEFORCES_DESKTOP_CSS =
  'html{min-width:0!important;width:auto!important;max-width:100%!important;overflow-x:hidden!important;overflow-y:auto!important}' +
  'body{min-width:0!important;width:auto!important;max-width:100%!important;overflow-x:clip!important;overflow-y:visible!important}' +
  '#body{box-sizing:border-box;width:calc(100% - var(--cf-inline-page-gap,40px))!important;min-width:0!important;max-width:var(--cf-inline-body-max-width,2000px)!important;margin-left:auto!important;margin-right:auto!important}' +
  'html[data-cf-inline-effective-compact="true"] #sidebar{display:none!important}' +
  'html[data-cf-inline-effective-compact="true"] #pageContent,html[data-cf-inline-effective-compact="true"] #pageContent>.content{box-sizing:border-box;min-width:0!important;max-width:100%!important;width:auto!important}' +
  'html[data-cf-inline-effective-compact="true"] .content-with-sidebar{margin-right:0!important}' +
  'html[data-cf-inline-effective-compact="true"] .problem-statement,html[data-cf-inline-effective-compact="true"] .cf-inline-translated-statement{overflow-wrap:anywhere}' +
  '.mobile-menu,.mobile-menu-toggle,.mobile-header,[class*="mobile-menu"],[class*="mobile-navigation"],[class*="mobile-nav"]{display:none!important}' +
  '.menu-box{display:block!important;height:auto!important;overflow:visible!important}' +
  '.menu-list{display:block!important;position:static!important;height:auto!important;overflow:visible!important;flex-wrap:nowrap!important}' +
  '.menu-list li{display:inline-block!important;float:none!important}' +
  'html[data-cf-inline-effective-narrow="true"] .menu-list,html[data-cf-inline-effective-narrow="true"] .second-level-menu-list{box-sizing:border-box;display:flex!important;flex-wrap:wrap!important;height:auto!important;min-height:0!important;overflow:visible!important;position:static!important}' +
  'html[data-cf-inline-effective-narrow="true"] .menu-list li,html[data-cf-inline-effective-narrow="true"] .second-level-menu-list li{box-sizing:border-box;display:inline-block!important;float:none!important;white-space:nowrap}' +
  'html[data-cf-inline-effective-narrow="true"] .second-level-menu{box-sizing:border-box;position:static!important;left:auto!important;top:auto!important;clear:both!important;height:auto!important;margin:0 0 .65em!important;overflow:visible!important}' +
  'html[data-cf-inline-effective-narrow="true"] .action-link{box-sizing:border-box;clear:both!important;height:auto!important;min-height:2.2em!important;margin:.25em 0 .55em!important}' +
  'html[data-cf-inline-effective-narrow="true"] .action-link>div{position:static!important;right:auto!important;top:auto!important;line-height:2em!important;text-align:right!important;white-space:normal!important}' +
  'html[data-cf-inline-effective-narrow="true"] .cf-inline-translate-bar,html[data-cf-inline-effective-narrow="true"] .cf-inline-submit-row{align-items:stretch;flex-direction:column}' +
  'html[data-cf-inline-effective-narrow="true"] .cf-inline-submit-row select{min-width:0;width:100%}' +
  'html[data-cf-inline-effective-narrow="true"] .cf-inline-submit-tools button{margin-left:0}';

export const UI_TRANSLATIONS: Record<string, string> = {
  Home: '主页',
  Top: '热门',
  Catalog: '目录',
  Contests: '比赛',
  Contest: '比赛',
  Gym: '训练营',
  Problemset: '题库',
  Problems: '题目',
  Problem: '题目',
  Groups: '群组',
  'My Groups': '我的群组',
  Rating: '排行榜',
  Edu: '教程',
  Calendar: '日历',
  Help: '帮助',
  Enter: '登录',
  Login: '登录',
  Register: '注册',
  Logout: '退出登录',
  Settings: '设置',
  Blog: '博客',
  Teams: '队伍',
  Submissions: '提交记录',
  'My Submissions': '我的提交',
  Favourites: '收藏',
  Talks: '私信',
  Submit: '提交',
  Status: '状态',
  Standings: '排行榜',
  Hacks: '攻击',
  Room: '房间',
  Friends: '好友',
  'Custom Invocation': '自定义测试',
  'Add to favourites': '添加收藏',
  When: '提交时间',
  Who: '提交者',
  Lang: '语言',
  Language: '语言',
  Verdict: '评测结果',
  Time: '时间',
  Memory: '内存',
  Author: '作者',
  Sent: '提交时间',
  Judged: '评测时间',
  Name: '名称',
  Writers: '出题人',
  Start: '开始时间',
  Length: '持续时间',
  Difficulty: '难度',
  Tags: '标签',
  Solved: '通过人数',
  Input: '输入',
  Output: '输出',
  Examples: '样例',
  Example: '样例',
  Note: '说明',
  Notes: '说明',
  Tutorial: '题解',
  Announcement: '公告',
  Announcements: '公告',
  Questions: '问题',
  Filter: '筛选',
  Apply: '应用',
  Reset: '重置',
  Search: '搜索',
  Save: '保存',
  Cancel: '取消',
  Edit: '编辑',
  Delete: '删除',
  Add: '添加',
  Create: '创建',
  Join: '加入',
  Leave: '退出',
  Members: '成员',
  'Create a new group': '创建新群组',
  'Virtual participation': '虚拟参赛',
  'Current standings': '当前榜单',
  'Final standings': '最终榜单',
  'Current or upcoming contests': '当前或即将开始的比赛',
  'Past contests': '往期比赛',
  'Registration completed': '已完成报名',
  'Registration closed': '报名已结束',
  Accepted: '通过',
  'Wrong answer': '答案错误',
  'Time limit exceeded': '超过时间限制',
  'Memory limit exceeded': '超过内存限制',
  'Runtime error': '运行错误',
  'Compilation error': '编译错误',
  Skipped: '已跳过',
  Testing: '评测中',
  'In queue': '队列中',
  Hacked: '被攻击',
  'as individual participant': '以个人身份参赛',
  'as a team member': '以队伍成员身份参赛',
  'standard input': '标准输入',
  'standard output': '标准输出',
  'time limit per test': '每个测试点的时间限制',
  'memory limit per test': '每个测试点的内存限制',
};

const translationCache = new Map<string, string>();

export interface TranslationHttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Buffer;
  timeoutMs?: number;
}

export interface TranslationHttpResponse {
  statusCode: number;
  body: Buffer;
}

export type TranslationRequester = (
  request: TranslationHttpRequest
) => Promise<TranslationHttpResponse>;

export function parseGoogleTranslationResponse(raw: string): string {
  const data = JSON.parse(raw) as unknown;
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error('翻译服务返回了无法识别的数据');
  }
  const translated = data[0]
    .map((segment: unknown) =>
      Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : ''
    )
    .join('');
  if (!translated) {
    throw new Error('翻译服务没有返回译文');
  }
  return translated;
}

export function parseBingTranslationResponse(raw: string): string {
  const data = JSON.parse(raw) as unknown;
  if (!Array.isArray(data) || !data[0] || typeof data[0] !== 'object') {
    throw new Error('Bing 翻译服务返回了无法识别的数据');
  }
  const translations = (data[0] as { translations?: unknown }).translations;
  if (!Array.isArray(translations) || !translations[0] || typeof translations[0] !== 'object') {
    throw new Error('Bing 翻译服务没有返回译文');
  }
  const translated = (translations[0] as { text?: unknown }).text;
  if (typeof translated !== 'string' || !translated) {
    throw new Error('Bing 翻译服务没有返回译文');
  }
  return translated;
}

interface BingTranslationSession {
  ig: string;
  iid: string;
  key: string;
  token: string;
  expiresAt: number;
}

let bingSession: BingTranslationSession | undefined;
let bingSessionPromise: Promise<BingTranslationSession> | undefined;
let googleUnavailableUntil = 0;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTransientTranslationError(error: unknown): boolean {
  return /timed?\s*out|timeout|aborted|socket|econn|enet|eai_again|network|fetch/i.test(
    errorMessage(error)
  );
}

function shortDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestBingSession(
  requester: TranslationRequester,
  forceRefresh = false
): Promise<BingTranslationSession> {
  if (!forceRefresh && bingSession && bingSession.expiresAt > Date.now()) {
    return bingSession;
  }
  if (!forceRefresh && bingSessionPromise) {
    return bingSessionPromise;
  }
  const pending = (async () => {
    const response = await requester({
      url: 'https://cn.bing.com/translator',
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0',
      },
      body: Buffer.alloc(0),
      timeoutMs: 15_000,
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Bing 翻译页面返回 HTTP ${response.statusCode}`);
    }
    const page = response.body.toString('utf8');
    const ig = /IG:"([^"]+)"/.exec(page)?.[1] ?? '';
    const iid = /data-iid="([^"]+)"/.exec(page)?.[1] ?? '';
    const abuse = /params_AbusePreventionHelper\s*=\s*\[\s*(\d+)\s*,\s*"([^"]+)"\s*,\s*(\d+)/.exec(page);
    if (!ig || !iid || !abuse) {
      throw new Error('Bing 翻译页面缺少必要的会话参数');
    }
    const lifetime = Math.max(60_000, Number(abuse[3]) - 60_000);
    bingSession = {
      ig,
      iid,
      key: abuse[1],
      token: abuse[2],
      expiresAt: Date.now() + lifetime,
    };
    return bingSession;
  })();
  bingSessionPromise = pending;
  try {
    return await pending;
  } finally {
    if (bingSessionPromise === pending) {
      bingSessionPromise = undefined;
    }
  }
}

async function requestGoogleTranslation(
  html: string,
  requester: TranslationRequester
): Promise<string> {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
    tl: 'zh-CN',
    dt: 't',
    q: html,
  });
  const response = await requester({
    url: 'https://translate.googleapis.com/translate_a/single',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
    },
    body: Buffer.from(params.toString(), 'utf8'),
    timeoutMs: 5_000,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Google 翻译返回 HTTP ${response.statusCode}`);
  }
  return parseGoogleTranslationResponse(response.body.toString('utf8'));
}

async function requestBingTranslation(
  html: string,
  requester: TranslationRequester
): Promise<string> {
  const send = async (forceSession: boolean): Promise<TranslationHttpResponse> => {
    const session = await requestBingSession(requester, forceSession);
    const query = new URLSearchParams({
      isVertical: '1',
      IG: session.ig,
      IID: session.iid,
      SFX: '1',
    });
    const body = new URLSearchParams({
      fromLang: 'auto-detect',
      to: 'zh-Hans',
      text: html,
      token: session.token,
      key: session.key,
    });
    return requester({
      url: `https://cn.bing.com/ttranslatev3?${query.toString()}`,
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Origin: 'https://cn.bing.com',
        Referer: 'https://cn.bing.com/translator',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0',
      },
      body: Buffer.from(body.toString(), 'utf8'),
      timeoutMs: 20_000,
    });
  };
  let response: TranslationHttpResponse;
  try {
    response = await send(false);
  } catch (error) {
    if (!isTransientTranslationError(error)) {
      throw error;
    }
    // The first Bing request establishes a session and is the request most
    // likely to hit a temporary DNS/socket stall. Refresh it once rather than
    // failing an entire problem translation immediately.
    bingSession = undefined;
    await shortDelay(250);
    response = await send(true);
  }
  if (response.statusCode === 401 || response.statusCode === 403 || response.body.length === 0) {
    bingSession = undefined;
    response = await send(true);
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Bing 翻译返回 HTTP ${response.statusCode}`);
  }
  return parseBingTranslationResponse(response.body.toString('utf8'));
}

async function translateOne(html: string, requester: TranslationRequester): Promise<string> {
  const cached = translationCache.get(html);
  if (cached !== undefined) {
    return cached;
  }
  let translated: string | undefined;
  let bingError: unknown;
  try {
    // Bing is normally directly reachable in mainland China, while Google is
    // often unavailable without a VPN. Trying Bing first avoids a guaranteed
    // Google timeout on every fresh VS Code session.
    translated = await requestBingTranslation(html, requester);
  } catch (error) {
    bingError = error;
  }
  let googleError: unknown = new Error('本次会话已检测到 Google 不可达，暂时跳过');
  if (translated === undefined && Date.now() >= googleUnavailableUntil) {
    try {
      translated = await requestGoogleTranslation(html, requester);
      googleUnavailableUntil = 0;
    } catch (error) {
      googleError = error;
      googleUnavailableUntil = Date.now() + 10 * 60 * 1000;
    }
  }
  if (translated === undefined) {
    throw new Error(
      `在线翻译不可用；Bing：${errorMessage(bingError)}；Google：${errorMessage(googleError)}`
    );
  }
  if (translationCache.size >= 500) {
    translationCache.delete(translationCache.keys().next().value as string);
  }
  translationCache.set(html, translated);
  return translated;
}

export async function translateHtmlItems(
  items: string[],
  requester: TranslationRequester
): Promise<string[]> {
  if (!Array.isArray(items) || items.length === 0 || items.length > 32) {
    throw new Error('翻译请求必须包含 1 到 32 个内容块');
  }
  const total = items.reduce((sum, item) => sum + Buffer.byteLength(item, 'utf8'), 0);
  if (items.some((item) => typeof item !== 'string' || item.length > 50000) || total > 250000) {
    throw new Error('待翻译内容过长');
  }
  const output = new Array<string>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      output[index] = await translateOne(items[index], requester);
    }
  }
  await Promise.all([worker(), worker()]);
  return output;
}

export function buildPageZoomClientScript(): string {
  return `(function(){
    if(document.documentElement.dataset.cfInlinePageZoom)return;
    document.documentElement.dataset.cfInlinePageZoom='1';
    var storageKey='cf-inline-page-zoom';
    var scale=1,wheelDelta=0,hideTimer=0;
    try{var saved=Number(localStorage.getItem(storageKey));if(Number.isFinite(saved)&&saved>=0.6&&saved<=2)scale=saved;}catch(error){}
    function apply(showIndicator){
      scale=Math.max(0.6,Math.min(2,Math.round(scale*10)/10));
      var root=document.documentElement,inverse=1/scale,effectiveWidth=window.innerWidth*inverse;
      var visualGap=effectiveWidth<=520?10:effectiveWidth<=1200?24:40;
      root.style.setProperty('--cf-inline-page-min-width','0px');
      root.style.setProperty('--cf-inline-body-min-width','0px');
      root.style.setProperty('--cf-inline-body-max-width',(2000*inverse)+'px');
      root.style.setProperty('--cf-inline-page-gap',(visualGap*inverse)+'px');
      root.style.removeProperty('width');root.style.zoom=String(scale);
      root.dataset.cfInlineZoomedIn=scale>1?'true':'false';
      root.dataset.cfInlineEffectiveCompact=effectiveWidth<=1200?'true':'false';
      root.dataset.cfInlineEffectiveNarrow=effectiveWidth<=760?'true':'false';
      try{localStorage.setItem(storageKey,String(scale));}catch(error){}
      if(!showIndicator)return;
      var indicator=document.getElementById('cf-inline-page-zoom-indicator');
      if(!indicator){
        indicator=document.createElement('div');indicator.id='cf-inline-page-zoom-indicator';
        indicator.style.cssText='position:fixed;right:18px;top:18px;z-index:2147483647;padding:7px 12px;border-radius:5px;background:rgba(20,24,30,.88);color:#fff;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3);pointer-events:none;transition:opacity .18s';
        (document.body||document.documentElement).appendChild(indicator);
      }
      indicator.textContent='页面缩放：'+Math.round(scale*100)+'%';indicator.style.opacity='1';
      clearTimeout(hideTimer);hideTimer=setTimeout(function(){indicator.style.opacity='0';},900);
    }
    function adjust(direction){scale+=direction>0?0.1:-0.1;wheelDelta=0;apply(true);}
    function reset(){scale=1;wheelDelta=0;apply(true);}
    try{window.__cfInlinePageZoomControl={adjust:adjust,reset:reset};}catch(error){}
    window.addEventListener('wheel',function(event){
      if(!event.ctrlKey)return;
      event.preventDefault();event.stopPropagation();wheelDelta+=event.deltaY;
      if(Math.abs(wheelDelta)<40)return;
      adjust(wheelDelta<0?1:-1);
    },{capture:true,passive:false});
    window.addEventListener('keydown',function(event){
      if(!event.ctrlKey||event.altKey||event.metaKey||event.key!=='0')return;
      event.preventDefault();event.stopPropagation();reset();
    },true);
    window.addEventListener('resize',function(){apply(false);});
    apply(false);
  })()`;
}

export function buildLocalizationClientScript(options: LocalizationOptions): string {
  const dictionary = JSON.stringify(UI_TRANSLATIONS).replace(/</g, '\\u003c');
  const enabled = JSON.stringify(options.localizeInterface);
  const auto = JSON.stringify(options.autoTranslateStatements);
  const pageZoom = buildPageZoomClientScript();
  const controlledDesktopStyle = JSON.stringify(CONTROLLED_CODEFORCES_DESKTOP_CSS);
  return `<script>(function(){
    ${pageZoom};
    var dictionary=${dictionary};
    var localizationEnabled=${enabled};
    var autoTranslateStatements=${auto};
    var skipSelector='script,style,noscript,pre,code,textarea,[contenteditable="true"],.MathJax,.MathJax_Preview,.tex-span,.ttypography';
    function isProblemLabel(node){
      var p=node.parentElement;
      if(!p) return false;
      var statement=p.closest('.problem-statement');
      if(!statement) return true;
      return statement.classList.contains('cf-inline-translated-statement')&&!!p.closest('.header,.section-title');
    }
    function localizeTextNode(node){
      var p=node.parentElement;
      if(!p||p.closest(skipSelector)||!isProblemLabel(node)) return;
      var raw=node.nodeValue||'';
      var key=raw.trim();
      if(!key) return;
      var replacement=dictionary[key]||dictionary[key.replace(/[»:]$/,'').trim()];
      if(!replacement) return;
      if(/[»:]$/.test(key)) replacement+=key.slice(-1);
      node.nodeValue=raw.replace(key,replacement);
    }
    function localize(root){
      if(!localizationEnabled||!root) return;
      if(root.nodeType===Node.TEXT_NODE){localizeTextNode(root);return;}
      if(root.nodeType!==Node.ELEMENT_NODE&&root.nodeType!==Node.DOCUMENT_NODE) return;
      var walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      var nodes=[]; while(walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(localizeTextNode);
      if(root.querySelectorAll){
        root.querySelectorAll('input[value],input[placeholder],button[title]').forEach(function(el){
          ['value','placeholder','title'].forEach(function(attr){
            var value=el.getAttribute(attr); if(value&&dictionary[value.trim()]) el.setAttribute(attr,dictionary[value.trim()]);
          });
        });
      }
    }
    function prepareStatementBlock(block,index){
      var clone=block.cloneNode(true);
      Array.from(clone.querySelectorAll('.cf-inline-paragraph-toolbar,.cf-inline-paragraph-control,.cf-inline-paragraph-translation')).forEach(function(node){node.remove();});
      clone.setAttribute('data-cfi-block',String(index));
      var protectedNodes=[];
      function protectNode(node){
        if(!clone.contains(node)) return;
        var protectedIndex=protectedNodes.length;
        protectedNodes.push(node.cloneNode(true));
        var placeholder=document.createElement('span');
        placeholder.setAttribute('data-cfi-protected',String(protectedIndex));
        placeholder.setAttribute('translate','no');
        placeholder.className='notranslate';
        placeholder.textContent='CFIPROTECTEDB'+index+'I'+protectedIndex+'END';
        node.replaceWith(placeholder);
      }
      Array.from(clone.querySelectorAll('.MathJax,mjx-container')).forEach(function(node){
        if(!clone.contains(node)) return;
        var preview=node.previousElementSibling;
        var source=node.nextElementSibling;
        protectNode(node);
        if(preview&&preview.classList.contains('MathJax_Preview')) preview.remove();
        if(source&&source.tagName==='SCRIPT'&&/^math\\/tex/i.test(source.getAttribute('type')||'')) source.remove();
      });
      Array.from(clone.querySelectorAll('pre,code,script,style,.MathJax,.MathJax_Preview,mjx-container,.tex-span,[class*="tex-font-style"],img')).forEach(function(node){
        protectNode(node);
      });
      return {html:clone.outerHTML,protectedNodes:protectedNodes};
    }
    function restoreStatementBlock(html,index,protectedNodes){
      var template=document.createElement('template'); template.innerHTML=html;
      var block=template.content.querySelector('[data-cfi-block="'+index+'"]')||template.content.firstElementChild;
      if(!block) throw new Error('译文内容块结构无效');
      protectedNodes.forEach(function(original,protectedIndex){
        var marker='CFIPROTECTEDB'+index+'I'+protectedIndex+'END';
        var placeholder=block.querySelector('[data-cfi-protected="'+protectedIndex+'"]');
        if(placeholder){
          placeholder.replaceWith(original.cloneNode(true));
          return;
        }
        var walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);
        var textNode=null,markerOffset=-1;
        while(walker.nextNode()){
          markerOffset=(walker.currentNode.nodeValue||'').indexOf(marker);
          if(markerOffset!==-1){textNode=walker.currentNode;break;}
        }
        if(!textNode) throw new Error('译文中的公式或代码占位符不完整');
        var after=textNode.splitText(markerOffset);
        after.nodeValue=(after.nodeValue||'').slice(marker.length);
        after.parentNode.insertBefore(original.cloneNode(true),after);
        if(!textNode.nodeValue) textNode.remove();
        if(!after.nodeValue) after.remove();
      });
      Array.from(block.querySelectorAll('[data-cfi-protected]')).forEach(function(node){node.remove();});
      var cleanupWalker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);
      var cleanupNodes=[]; while(cleanupWalker.nextNode()) cleanupNodes.push(cleanupWalker.currentNode);
      cleanupNodes.forEach(function(node){node.nodeValue=(node.nodeValue||'').replace(/CFIPROTECTEDB\\d+I\\d+END/g,'');});
      block.removeAttribute('data-cfi-block');
      return block;
    }
    function parseProblemRoute(){
      var parts=location.pathname.split('/').filter(Boolean);
      if(parts[0]==='group'&&parts[2]==='contest'&&parts[4]==='problem'&&parts[1]&&parts[3]&&parts[5]){
        return {kind:'group',groupId:parts[1],contestId:parts[3],index:parts[5],submitPath:'/group/'+parts[1]+'/contest/'+parts[3]+'/submit',submissionsPath:'/group/'+parts[1]+'/contest/'+parts[3]+'/my'};
      }
      if(parts[0]==='contest'&&parts[2]==='problem'&&parts[1]&&parts[3]){
        return {kind:'contest',contestId:parts[1],index:parts[3],submitPath:'/contest/'+parts[1]+'/submit',submissionsPath:'/contest/'+parts[1]+'/my'};
      }
      if(parts[0]==='gym'&&parts[2]==='problem'&&parts[1]&&parts[3]){
        return {kind:'gym',contestId:parts[1],index:parts[3],submitPath:'/gym/'+parts[1]+'/submit',submissionsPath:'/gym/'+parts[1]+'/my'};
      }
      if(parts[0]==='problemset'&&parts[1]==='problem'&&parts[2]&&parts[3]){
        return {kind:'problemset',contestId:parts[2],index:parts[3],submitPath:'/problemset/submit',submissionsPath:'/problemset/status?my=on'};
      }
      return null;
    }
    function ensureHiddenField(form,name,value){
      var input=form.querySelector('input[name="'+name+'"]');
      if(!input){input=document.createElement('input');input.type='hidden';input.name=name;form.appendChild(input);}
      if(value!==undefined&&value!==null&&String(value)!=='') input.value=String(value);
      return input;
    }
    function secureSubmitAction(form,csrfToken,parameterName,parameterPrefix,baseHref){
      var target;
      try{target=new URL(form.getAttribute('action')||baseHref||location.href,baseHref||location.href);}catch(error){target=new URL(baseHref||location.href);}
      if(csrfToken&&!target.searchParams.has('csrf_token')) target.searchParams.set('csrf_token',csrfToken);
      var name=parameterName||'adcd1e';
      if(!target.searchParams.has(name)) target.searchParams.set(name,(parameterPrefix||'caf4f')+Math.random().toString(36).slice(2,11));
      form.setAttribute('action',target.pathname+target.search+target.hash);
      return target.pathname+target.search+target.hash;
    }
    function installSubmitFormRepair(){
      if(document.documentElement.dataset.cfInlineSubmitRepair) return;
      document.documentElement.dataset.cfInlineSubmitRepair='1';
      document.addEventListener('submit',function(event){
        var form=event.target;
        if(!form||!form.matches||!form.matches('form.submit-form')) return;
        var csrfInput=form.querySelector('input[name="csrf_token"]');
        var csrfMeta=document.querySelector('meta[name="X-Csrf-Token" i]');
        var csrf=(csrfInput&&csrfInput.value)||(csrfMeta&&csrfMeta.getAttribute('content'))||'';
        ensureHiddenField(form,'csrf_token',csrf);
        ensureHiddenField(form,'ftaa',window._ftaa||'');
        ensureHiddenField(form,'bfaa',window._bfaa||'');
        var source=form.querySelector('textarea[name="source"]');
        if(source) ensureHiddenField(form,'sourceSize',String(new TextEncoder().encode(source.value||'').length));
        secureSubmitAction(form,csrf,'adcd1e','caf4f');
      },true);
    }
    function readSampleText(pre){
      var lines=Array.from(pre.querySelectorAll('.test-example-line'));
      var text=lines.length?lines.map(function(line){return line.textContent||'';}).join('\\n'):pre.innerText;
      return String(text||'').replace(/\\u00a0/g,' ').replace(/\\r\\n?/g,'\\n').replace(/\\n+$/,'');
    }
    async function copySampleText(text){
      if(navigator.clipboard&&typeof navigator.clipboard.writeText==='function'){
        try{await navigator.clipboard.writeText(text);return;}catch(error){}
      }
      var holder=document.createElement('textarea');holder.value=text;holder.readOnly=true;
      holder.style.cssText='position:fixed;left:-9999px;top:0;opacity:0';document.body.appendChild(holder);
      holder.focus();holder.select();holder.setSelectionRange(0,holder.value.length);
      var copied=false;try{copied=document.execCommand('copy');}finally{holder.remove();}
      if(!copied)throw new Error('浏览器拒绝访问剪贴板');
    }
    function installSampleCopyButtons(root){
      if(!root)return;
      var sections=[];
      if(root.nodeType===Node.ELEMENT_NODE&&root.matches&&root.matches('.sample-tests .input,.sample-tests .output'))sections.push(root);
      if(root.nodeType===Node.ELEMENT_NODE&&root.closest){var parentSection=root.closest('.sample-tests .input,.sample-tests .output');if(parentSection)sections.push(parentSection);}
      if((root.nodeType===Node.ELEMENT_NODE||root.nodeType===Node.DOCUMENT_NODE)&&root.querySelectorAll){
        root.querySelectorAll('.sample-tests .input,.sample-tests .output').forEach(function(section){sections.push(section);});
      }
      Array.from(new Set(sections)).forEach(function(section){
        if(section.dataset.cfInlineSampleCopy)return;
        var title=section.querySelector('.title'),pre=section.querySelector('pre');if(!title||!pre)return;
        section.dataset.cfInlineSampleCopy='1';
        var button=document.createElement('button');button.type='button';button.className='cf-inline-sample-copy';button.textContent='复制';button.title='复制这个样例';
        button.addEventListener('click',async function(event){
          event.preventDefault();event.stopPropagation();if(button.disabled)return;
          button.disabled=true;button.classList.remove('is-error');
          try{await copySampleText(readSampleText(pre));button.textContent='已复制';}
          catch(error){button.textContent='复制失败';button.classList.add('is-error');button.title=String(error&&error.message||error);}
          finally{setTimeout(function(){button.disabled=false;button.textContent='复制';button.classList.remove('is-error');button.title='复制这个样例';},1200);}
        });
        title.appendChild(button);
      });
    }
    function extractWindowValue(html,name){
      var marker='window._'+name;
      var start=html.indexOf(marker);
      while(start!==-1){
        var equals=html.indexOf('=',start+marker.length);
        if(equals===-1) return '';
        var quoteIndex=equals+1;
        while(quoteIndex<html.length&&html.charAt(quoteIndex)!=='"'&&html.charAt(quoteIndex)!=="'") quoteIndex++;
        if(quoteIndex<html.length){
          var quote=html.charAt(quoteIndex);
          var end=html.indexOf(quote,quoteIndex+1);
          if(end!==-1) return html.slice(quoteIndex+1,end);
        }
        start=html.indexOf(marker,start+marker.length);
      }
      return '';
    }
    function cleanSubmitMessage(value){
      return String(value||'').replace(/\\s+/g,' ').trim();
    }
    function isSubmitSuccessMessage(value){
      value=String(value||'');
      return /\\bSolution\\s+(?:(?:to|for)\\s+)?(?:the\\s+)?problem\\s+[A-Za-z0-9]+\\s+has\\s+been\\s+submitted\\s+successfully\\b/i.test(value)||/Решение\\s+задачи\\s+[A-Za-zА-Яа-яЁё0-9]+\\s+успешно\\s+отправлено\\s+на\\s+проверку/i.test(value);
    }
    function readSubmitError(html,statusCode){
      var parsed=new DOMParser().parseFromString(html,'text/html');
      if(Number(statusCode)>=400){
        var codeNode=parsed.querySelector('code');
        var transportDetail=cleanSubmitMessage(codeNode&&codeNode.textContent);
        if(!transportDetail){var errorPage=parsed.querySelector('main,.card,body');transportDetail=cleanSubmitMessage(errorPage&&errorPage.textContent);}
        return '请求失败（HTTP '+statusCode+'）'+(transportDetail?'：'+transportDetail:'');
      }
      if(parsed.querySelector('#enterForm')) return '登录状态已失效，请重新连接 Edge 会话后再试。';
      var selectors='form.submit-form .genericError,form.submit-form .error,form.submit-form [class*="error"],.genericError,.error,[class*="submit-error"],[data-error]';
      var errors=Array.from(parsed.querySelectorAll(selectors));
      var successMessage='';
      for(var errorIndex=0;errorIndex<errors.length;errorIndex++){
        var text=cleanSubmitMessage(errors[errorIndex].getAttribute('data-error')||errors[errorIndex].textContent);
        if(text&&text.length<=1500){if(isSubmitSuccessMessage(text)){successMessage=text;continue;}return text;}
      }
      var scriptMessage=html.match(/(?:Codeforces\\.)?(showMessage|showError)\\s*\\(\\s*(["'])([\\s\\S]*?)\\2\\s*\\)/i);
      if(scriptMessage){
        var decoded=scriptMessage[3].replace(/\\\\n/g,' ').replace(/\\\\([\\\\"'])/g,'$1');
        decoded=cleanSubmitMessage(new DOMParser().parseFromString('<body>'+decoded,'text/html').body.textContent);
        if(decoded){if(scriptMessage[1].toLowerCase()==='showmessage'&&isSubmitSuccessMessage(decoded)) successMessage=decoded;else return decoded;}
      }
      parsed.querySelectorAll('script,style,noscript,template').forEach(function(node){node.remove();});
      var pageText=cleanSubmitMessage(parsed.body&&parsed.body.textContent);
      var knownError=pageText.match(/(?:Source should differ from previously submitted|You have submitted (?:exactly )?the same code before|Duplicate submission|Source should be non-empty|You have no rights to submit|Contest is over|Registration is closed)[^.!?\\n]*(?:[.!?]|$)/i);
      if(knownError) return cleanSubmitMessage(knownError[0]);
      if(successMessage||isSubmitSuccessMessage(pageText)) return '';
      if(parsed.querySelector('form.submit-form')) return 'Codeforces 返回了提交页面，但没有确认提交成功。请检查题号、语言和代码内容。';
      return '';
    }
    function submissionMatchesRoute(href,route){
      if(!href)return false;
      var path;try{path=new URL(href,location.origin).pathname;}catch(error){return false;}
      var contest=String(route.contestId).replace(/[^0-9]/g,'');
      var index=String(route.index).replace(/[^A-Za-z0-9]/g,'');
      return new RegExp('(?:/contest/'+contest+'/problem/'+index+'|/gym/'+contest+'/problem/'+index+'|/problemset/problem/'+contest+'/'+index+')(?:/|$)','i').test(path)
        ||new RegExp('/group/[^/]+/contest/'+contest+'/problem/'+index+'(?:/|$)','i').test(path);
    }
    function verdictDisplay(code,text){
      code=String(code||'').toUpperCase();text=cleanSubmitMessage(text);
      var labels={OK:'通过',ACCEPTED:'通过',WRONG_ANSWER:'答案错误',TIME_LIMIT_EXCEEDED:'超过时间限制',MEMORY_LIMIT_EXCEEDED:'超过内存限制',RUNTIME_ERROR:'运行错误',COMPILATION_ERROR:'编译错误',IDLENESS_LIMIT_EXCEEDED:'超过空闲时间限制',SECURITY_VIOLATED:'安全检查失败',CRASHED:'评测崩溃',INPUT_PREPARATION_CRASHED:'测试数据准备失败',CHALLENGED:'被攻击',SKIPPED:'已跳过',REJECTED:'已拒绝',FAILED:'评测失败',PARTIAL:'部分通过',TESTING:'评测中',RUNNING:'评测中',PENDING:'等待评测',IN_QUEUE:'等待评测'};
      var label=labels[code]||'';
      if(!label){
        if(/accepted|принято/i.test(text))label='通过';
        else if(/wrong answer|неправильный ответ/i.test(text))label='答案错误';
        else if(/time limit|превышено ограничение времени/i.test(text))label='超过时间限制';
        else if(/memory limit|превышено ограничение памяти/i.test(text))label='超过内存限制';
        else if(/runtime error|ошибка исполнения/i.test(text))label='运行错误';
        else if(/compilation error|ошибка компиляции/i.test(text))label='编译错误';
        else if(/queue|running|testing|judg|очеред|тестир|провер/i.test(text))label='评测中';
        else label=text||'等待评测';
      }
      var testNumber=text.match(/(?:test|тест)\\s*#?\\s*(\\d+)/i);
      if(testNumber&&label!=='通过')label+='（第 '+testNumber[1]+' 个测试点）';
      var pending=/^(?:TESTING|RUNNING|PENDING|IN_QUEUE)$/.test(code)||/等待评测|评测中/.test(label);
      var accepted=code==='OK'||code==='ACCEPTED'||label==='通过';
      return {label:label,pending:pending,accepted:accepted};
    }
    function parseSubmissionRows(html,route){
      var parsed=new DOMParser().parseFromString(html,'text/html'),output=[];
      Array.from(parsed.querySelectorAll('tr')).forEach(function(row){
        var sourceLink=row.querySelector('a[href*="/submission/"]');
        var problemLink=Array.from(row.querySelectorAll('a[href*="/problem/"]')).find(function(link){return submissionMatchesRoute(link.getAttribute('href')||'',route);});
        if(!sourceLink||!problemLink)return;
        var idMatch=(sourceLink.getAttribute('href')||'').match(/\\/submission\\/(\\d+)/i);
        var id=row.getAttribute('data-submission-id')||(idMatch&&idMatch[1])||cleanSubmitMessage(sourceLink.textContent);
        if(!/^\\d+$/.test(id))return;
        var verdictElement=row.querySelector('[submissionverdict],.status-verdict-cell');
        var nestedVerdict=verdictElement&&verdictElement.querySelector('[submissionverdict]');
        var verdictCode=(verdictElement&&verdictElement.getAttribute('submissionverdict'))||(nestedVerdict&&nestedVerdict.getAttribute('submissionverdict'))||'';
        var display=verdictDisplay(verdictCode,cleanSubmitMessage(verdictElement&&verdictElement.textContent));
        var timeCell=row.querySelector('.time-consumed-cell'),memoryCell=row.querySelector('.memory-consumed-cell');
        output.push({id:id,href:sourceLink.getAttribute('href')||route.submissionsPath,label:display.label,pending:display.pending,accepted:display.accepted,time:cleanSubmitMessage(timeCell&&timeCell.textContent),memory:cleanSubmitMessage(memoryCell&&memoryCell.textContent)});
      });
      output.sort(function(a,b){return Number(b.id)-Number(a.id);});
      return output;
    }
    async function readLatestSubmission(route){
      var separator=route.submissionsPath.indexOf('?')===-1?'?':'&';
      var response=await fetch(route.submissionsPath+separator+'cf_inline_poll='+Date.now(),{credentials:'same-origin',cache:'no-store'});
      var html=await response.text();
      if(!response.ok)throw new Error(readSubmitError(html,response.status)||('HTTP '+response.status));
      if(new DOMParser().parseFromString(html,'text/html').querySelector('#enterForm'))throw new Error('登录状态已失效');
      return parseSubmissionRows(html,route)[0]||null;
    }
    function renderSubmissionResult(status,record,message){
      status.textContent=message||('提交 #'+record.id+'：'+record.label+(record.time?' · '+record.time:'')+(record.memory?' · '+record.memory:''));
      status.className='cf-inline-submit-status '+(record.pending?'is-loading':record.accepted?'is-success':'is-error');
    }
    function pollSubmissionResult(route,previousId,status,sequence,isActive){
      var deadline=Date.now()+3*60*1000,lastRecord=null;
      function schedule(delay){
        if(isActive(sequence)&&Date.now()<deadline)setTimeout(check,delay);
        else if(isActive(sequence)&&lastRecord&&lastRecord.pending)renderSubmissionResult(status,lastRecord,'提交 #'+lastRecord.id+'：仍在评测中；自动刷新已停止。');
      }
      async function check(){
        if(!isActive(sequence))return;
        try{
          var record=await readLatestSubmission(route);
          if(record&&record.id!==previousId){lastRecord=record;renderSubmissionResult(status,record);if(!record.pending)return;}
          else{status.className='cf-inline-submit-status is-loading';status.textContent='Codeforces 已接收代码，正在等待提交记录和评测结果…';}
          schedule(2000);
        }catch(error){status.className='cf-inline-submit-status is-loading';status.textContent='代码已提交，暂时无法刷新评测结果，插件将自动重试。';schedule(3500);}
      }
      schedule(900);
    }
    function installInlineSubmitter(){
      var route=parseProblemRoute();
      var statement=document.querySelector('.problem-statement:not(.cf-inline-translated-statement)');
      if(!route||!statement||statement.dataset.cfInlineSubmitter) return;
      statement.dataset.cfInlineSubmitter='1';
      var wrap=document.createElement('section');wrap.className='cf-inline-submit-wrap';
      var heading=document.createElement('div');heading.className='cf-inline-submit-heading';heading.textContent='提交代码';
      var content=document.createElement('div');content.className='cf-inline-submit-content';
      var loading=document.createElement('div');loading.className='cf-inline-submit-loading';loading.textContent='正在加载 Codeforces 提交表单和语言列表…';
      content.appendChild(loading);wrap.appendChild(heading);wrap.appendChild(content);
      statement.parentNode.insertBefore(wrap,statement.nextSibling);
      fetch(route.submitPath,{method:'GET',credentials:'same-origin',cache:'no-store'}).then(function(response){
        return response.text().then(function(html){return {ok:response.ok,status:response.status,html:html};});
      }).then(function(result){
        if(!result.ok) throw new Error(readSubmitError(result.html,result.status)||('加载提交页面失败（HTTP '+result.status+'）'));
        var sourceDoc=new DOMParser().parseFromString(result.html,'text/html');
        var sourceForm=sourceDoc.querySelector('form.submit-form');
        if(!sourceForm) throw new Error(sourceDoc.querySelector('#enterForm')?'登录状态已失效，请重新连接 Edge 会话。':'未找到 Codeforces 提交表单，当前比赛可能不允许提交。');
        var sourceLanguage=sourceForm.querySelector('select[name="programTypeId"]');
        if(!sourceLanguage||!sourceLanguage.options.length) throw new Error('未能读取 Codeforces 的提交语言列表。');
        var csrfInput=sourceForm.querySelector('input[name="csrf_token"]');
        var csrfMeta=sourceDoc.querySelector('meta[name="X-Csrf-Token" i]');
        var csrf=(csrfInput&&csrfInput.value)||(csrfMeta&&csrfMeta.getAttribute('content'))||'';
        if(!csrf) throw new Error('未能读取 CSRF 校验信息，请刷新题目页面后重试。');
        var ftaa=extractWindowValue(result.html,'ftaa');
        var bfaa=extractWindowValue(result.html,'bfaa');
        if(!ftaa||!bfaa) throw new Error('未能读取 Codeforces 浏览器校验字段，请刷新后重试。');
        var actionHolder=document.createElement('form');
        actionHolder.setAttribute('action',sourceForm.getAttribute('action')||route.submitPath);
        var submitAction=secureSubmitAction(actionHolder,csrf,'adcd1e','caf4f',new URL(route.submitPath,location.origin).href);
        var form=document.createElement('form');form.className='cf-inline-submit-form';form.noValidate=true;
        var languageRow=document.createElement('label');languageRow.className='cf-inline-submit-row';
        var languageLabel=document.createElement('span');languageLabel.textContent='语言';
        var language=document.createElement('select');language.name='programTypeId';
        Array.from(sourceLanguage.options).forEach(function(option){language.appendChild(option.cloneNode(true));});
        language.value=sourceLanguage.value||language.options[0].value;
        languageRow.appendChild(languageLabel);languageRow.appendChild(language);
        var sourceLabel=document.createElement('label');sourceLabel.className='cf-inline-submit-source-label';sourceLabel.textContent='源代码';
        var textarea=document.createElement('textarea');textarea.name='source';textarea.spellcheck=false;textarea.placeholder='在这里粘贴代码，或使用下方按钮选择本地代码文件';
        var tools=document.createElement('div');tools.className='cf-inline-submit-tools';
        var fileLabel=document.createElement('label');fileLabel.className='cf-inline-file-button';fileLabel.textContent='选择代码文件';
        var file=document.createElement('input');file.type='file';file.accept='.cpp,.cc,.cxx,.c,.py,.java,.kt,.go,.rs,.js,.ts,.txt';fileLabel.appendChild(file);
        var fileName=document.createElement('span');fileName.className='cf-inline-file-name';fileName.textContent='未选择文件';
        var submit=document.createElement('button');submit.type='submit';submit.textContent='提交到 Codeforces';
        tools.appendChild(fileLabel);tools.appendChild(fileName);tools.appendChild(submit);
        var status=document.createElement('div');status.className='cf-inline-submit-status';status.setAttribute('role','status');status.textContent='填写代码后即可提交；英文原题和中文译文不会被改动。';
        var activeSubmissionSequence=0;
        form.appendChild(languageRow);form.appendChild(sourceLabel);form.appendChild(textarea);form.appendChild(tools);form.appendChild(status);
        content.replaceChildren(form);
        file.addEventListener('change',function(){
          var selected=file.files&&file.files[0];
          if(!selected){fileName.textContent='未选择文件';return;}
          fileName.textContent=selected.name+'（正在读取…）';
          selected.text().then(function(text){textarea.value=text;fileName.textContent=selected.name;status.className='cf-inline-submit-status';status.textContent='已读取 '+selected.name+'，请确认语言后提交。';}).catch(function(error){fileName.textContent=selected.name;status.className='cf-inline-submit-status is-error';status.textContent='读取文件失败：'+String(error&&error.message||error);});
        });
        form.addEventListener('submit',function(event){
          event.preventDefault();
          var source=textarea.value||'';
          if(!source.trim()){status.className='cf-inline-submit-status is-error';status.textContent='请先粘贴代码或选择代码文件。';textarea.focus();return;}
          submit.disabled=true;language.disabled=true;file.disabled=true;status.className='cf-inline-submit-status is-loading';status.textContent='正在提交到 Codeforces，请稍候…';
          var data=new FormData();
          Array.from(sourceForm.querySelectorAll('input[type="hidden"][name]')).forEach(function(input){data.append(input.name,input.value||'');});
          data.set('csrf_token',csrf);data.set('ftaa',ftaa);data.set('bfaa',bfaa);
          data.set('action','submitSolutionFormSubmitted');data.set('contestId',route.contestId);
          data.set('submittedProblemIndex',route.index);data.set('submittedProblemCode',route.contestId+route.index);
          data.set('programTypeId',language.value);data.set('source',source);data.set('sourceFile','');
          data.set('sourceSize',String(new TextEncoder().encode(source).length));data.set('tabSize','4');
          var sequence=++activeSubmissionSequence;
          readLatestSubmission(route).catch(function(){return null;}).then(function(previous){
            return fetch(submitAction,{method:'POST',body:data,credentials:'same-origin',redirect:'follow'}).then(function(response){
              return response.text().then(function(html){return {response:{ok:response.ok,status:response.status,url:response.url,html:html},previousId:previous&&previous.id||''};});
            });
          }).then(function(result){
            var response=result.response;
            var message=readSubmitError(response.html,response.status);if(message) throw new Error(message);
            status.className='cf-inline-submit-status is-loading';status.textContent='Codeforces 已接收代码，正在等待评测结果…';
            pollSubmissionResult(route,result.previousId,status,sequence,function(value){return value===activeSubmissionSequence;});
          }).catch(function(error){status.className='cf-inline-submit-status is-error';status.textContent='提交失败：'+String(error&&error.message||error);}).finally(function(){submit.disabled=false;language.disabled=false;file.disabled=false;});
        });
      }).catch(function(error){loading.className='cf-inline-submit-status is-error';loading.textContent='提交框加载失败：'+String(error&&error.message||error)+' 请刷新页面重试。';});
    }
    var paragraphTranslationSequence=100000;
    function isEligibleEnglishParagraph(block){
      if(!block||block.dataset.cfInlineParagraphTranslator) return false;
      if(block.closest('.problem-statement,.cf-inline-translated-wrap,.cf-inline-submit-wrap,.cf-inline-paragraph-translation,.cf-inline-too-narrow,#header,#footer,#sidebar,.menu-box,.second-level-menu,.datatable,form')) return false;
      var groupedParent=block.parentElement&&block.parentElement.closest('.ttypography[data-cf-inline-paragraph-translator="1"]');
      if(groupedParent) return false;
      if((block.matches('ul,ol'))&&block.parentElement&&block.parentElement.closest('ul[data-cf-inline-paragraph-translator="1"],ol[data-cf-inline-paragraph-translator="1"]')) return false;
      var text=(block.textContent||'').replace(/\\s+/g,' ').trim();
      if(text.length<8||text.length>12000) return false;
      var englishLetters=(text.match(/[A-Za-z]/g)||[]).length;
      return englishLetters>=6;
    }
    function installGlobalParagraphTranslators(root){
      var page=document.querySelector('#pageContent')||document.body;
      if(!page||!root) return;
      var candidates=[];
      if(root.nodeType===Node.ELEMENT_NODE&&root.matches&&root.matches('.ttypography,p,blockquote,ul,ol')) candidates.push(root);
      if((root.nodeType===Node.ELEMENT_NODE||root.nodeType===Node.DOCUMENT_NODE)&&root.querySelectorAll){
        root.querySelectorAll('.ttypography,p,blockquote,ul,ol').forEach(function(block){candidates.push(block);});
      }
      candidates.forEach(function(block){
        if(!page.contains(block)||!isEligibleEnglishParagraph(block)) return;
        var placement=block.closest('a[href]')||block;
        if(placement!==block&&placement.dataset.cfInlineParagraphTranslatorPlacement) return;
        block.dataset.cfInlineParagraphTranslator='1';
        if(placement!==block) placement.dataset.cfInlineParagraphTranslatorPlacement='1';
        var toolbar=document.createElement('div');toolbar.className='cf-inline-paragraph-toolbar';
        var control=document.createElement('button');
        control.type='button';control.className='cf-inline-paragraph-control';control.textContent='翻译整段';control.title='合并翻译这组连续内容，英文原文保持不变';
        toolbar.appendChild(control);
        var translation=document.createElement('div');
        translation.className='cf-inline-paragraph-translation';translation.hidden=true;
        placement.parentNode.insertBefore(toolbar,placement);
        placement.parentNode.insertBefore(translation,placement.nextSibling);
        var busy=false,translated=false;
        control.addEventListener('click',async function(event){
          event.preventDefault();event.stopPropagation();
          if(busy) return;
          if(translated){
            translation.hidden=!translation.hidden;
            control.textContent=translation.hidden?'显示译文':'隐藏译文';
            return;
          }
          busy=true;control.disabled=true;control.textContent='翻译中…';
          try{
            translation.classList.remove('is-error');
            var index=paragraphTranslationSequence++;
            var prepared=prepareStatementBlock(block,index);
            var response=await fetch('/__cf_inline/translate',{method:'POST',headers:{'Content-Type':'application/json','X-CF-Inline':'translate'},body:JSON.stringify({items:[prepared.html]})});
            var result=await response.json();
            if(!response.ok||!Array.isArray(result.items)||!result.items[0]) throw new Error(result.error||('HTTP '+response.status));
            var translatedBlock=restoreStatementBlock(result.items[0],index,prepared.protectedNodes);
            translatedBlock.removeAttribute('id');
            translatedBlock.querySelectorAll('[id]').forEach(function(node){node.removeAttribute('id');});
            Array.from(translatedBlock.querySelectorAll('.cf-inline-paragraph-toolbar,.cf-inline-paragraph-control,.cf-inline-paragraph-translation')).forEach(function(node){node.remove();});
            translation.replaceChildren(translatedBlock);
            translation.hidden=false;translated=true;control.textContent='隐藏译文';
            localize(translation);
          }catch(error){
            translation.textContent='翻译失败：'+String(error&&error.message||error);
            translation.classList.add('is-error');translation.hidden=false;control.textContent='重试翻译';
          }finally{busy=false;control.disabled=false;}
        });
      });
    }
    function installViewportGuard(){
      if(document.querySelector('.cf-inline-too-narrow')) return;
      var notice=document.createElement('div');notice.className='cf-inline-too-narrow';
      var title=document.createElement('strong');title.textContent='当前显示区域过窄';
      var detail=document.createElement('span');detail.textContent='至少需要 380 像素宽度。请向右拖宽 Codeforces 页面区域后继续使用。';
      notice.appendChild(title);notice.appendChild(detail);document.body.appendChild(notice);
    }
    function installStatementTranslator(){
      var statement=document.querySelector('.problem-statement');
      if(!statement||statement.dataset.cfInlineTranslator) return;
      statement.dataset.cfInlineTranslator='1';
      var blocks=Array.from(statement.children).filter(function(block){return block.tagName!=='SCRIPT'&&!block.classList.contains('cf-inline-translate-bar');});
      var bar=document.createElement('div'); bar.className='cf-inline-translate-bar';
      var button=document.createElement('button'); button.type='button'; button.textContent='翻译题面';
      var status=document.createElement('span'); status.textContent=autoTranslateStatements?'准备在原题下方生成中文译文…':'可在英文原题下方生成中文译文';
      bar.appendChild(button); bar.appendChild(status); statement.insertBefore(bar,statement.firstChild);
      var translatedWrap=null,busy=false;
      async function run(){
        if(busy) return;
        if(translatedWrap){
          var hidden=translatedWrap.hidden;
          translatedWrap.hidden=!hidden;
          button.textContent=hidden?'隐藏中文译文':'显示中文译文';
          status.textContent=hidden?'中文译文显示在英文原题下方':'中文译文已隐藏，英文原题保持不变';
          return;
        }
        busy=true; button.disabled=true; status.textContent='正在生成独立中文译文，请稍候…';
        try{
          var prepared=[],requestBlocks=[];
          blocks.forEach(function(block,index){
            if(block.classList.contains('sample-tests')) return;
            var item=prepareStatementBlock(block,index);
            if(/[A-Za-z]{2}/.test(item.html)){prepared.push({index:index,item:item});requestBlocks.push(item.html);}
          });
          if(!requestBlocks.length) throw new Error('当前题面不需要翻译');
          var response=await fetch('/__cf_inline/translate',{method:'POST',headers:{'Content-Type':'application/json','X-CF-Inline':'translate'},body:JSON.stringify({items:requestBlocks})});
          var result=await response.json();
          if(!response.ok||!Array.isArray(result.items)) throw new Error(result.error||('HTTP '+response.status));
          var translatedByIndex=new Map();
          prepared.forEach(function(entry,resultIndex){translatedByIndex.set(entry.index,restoreStatementBlock(result.items[resultIndex],entry.index,entry.item.protectedNodes));});
          translatedWrap=document.createElement('section'); translatedWrap.className='cf-inline-translated-wrap';
          var heading=document.createElement('div'); heading.className='cf-inline-translated-heading'; heading.textContent='中文翻译';
          var translatedStatement=document.createElement('div'); translatedStatement.className='problem-statement cf-inline-translated-statement';
          blocks.forEach(function(block,index){translatedStatement.appendChild(translatedByIndex.get(index)||block.cloneNode(true));});
          translatedWrap.appendChild(heading); translatedWrap.appendChild(translatedStatement);
          statement.parentNode.insertBefore(translatedWrap,statement.nextSibling);
          localize(translatedStatement);
          button.textContent='隐藏中文译文'; status.textContent='中文译文显示在英文原题下方；英文原题保持不变';
        }catch(error){status.textContent='翻译失败：'+String(error&&error.message||error);}
        finally{busy=false;button.disabled=false;}
      }
      button.addEventListener('click',run);
      if(autoTranslateStatements) setTimeout(run,500);
    }
    function start(){
      if(localizationEnabled){document.documentElement.lang='zh-CN';localize(document);}
      installStatementTranslator();
      installGlobalParagraphTranslators(document);
      installSubmitFormRepair();
      installInlineSubmitter();
      installSampleCopyButtons(document);
      installViewportGuard();
      new MutationObserver(function(mutations){mutations.forEach(function(m){m.addedNodes.forEach(function(node){localize(node);installStatementTranslator();installGlobalParagraphTranslators(node);installSubmitFormRepair();installInlineSubmitter();installSampleCopyButtons(node);});});}).observe(document.documentElement,{childList:true,subtree:true});
    }
    var paragraphStyle=document.createElement('style');paragraphStyle.textContent='.cf-inline-paragraph-toolbar{box-sizing:border-box;display:flex;justify-content:flex-end;align-items:center;min-height:28px;margin:10px 0 4px;padding:0;border-bottom:1px solid #d7e0e8}.cf-inline-paragraph-control{margin:0 0 4px;padding:3px 9px;border:1px solid #9aa8b5;border-radius:3px;background:#f4f8fc;color:#245d8f;font:12px Arial,sans-serif;cursor:pointer}.cf-inline-paragraph-control:disabled{opacity:.6;cursor:wait}.cf-inline-paragraph-translation{box-sizing:border-box;display:block;margin:7px 0 14px;padding:10px 12px;border-left:3px solid #4a90e2;background:#eef6ff;color:#183b59;font:13px/1.65 Arial,sans-serif}.cf-inline-paragraph-translation>*:first-child{margin-top:0}.cf-inline-paragraph-translation>*:last-child{margin-bottom:0}.cf-inline-paragraph-translation[hidden]{display:none}.cf-inline-paragraph-translation.is-error{border-left-color:#c43b3b;background:#fff1f1;color:#8b2222}@media (max-width:520px){.cf-inline-paragraph-toolbar{justify-content:stretch}.cf-inline-paragraph-control{width:100%}}';document.head.appendChild(paragraphStyle);
    var sampleCopyStyle=document.createElement('style');sampleCopyStyle.textContent='.cf-inline-sample-copy{box-sizing:border-box;float:right;margin:-2px 0 0 10px;padding:2px 9px;border:1px solid #8fa5b8;border-radius:3px;background:#f5f8fb;color:#245d8f;font:12px/1.45 Arial,sans-serif;cursor:pointer}.cf-inline-sample-copy:hover{background:#e8f2fc}.cf-inline-sample-copy:disabled{opacity:.75;cursor:default}.cf-inline-sample-copy.is-error{border-color:#c26464;background:#fff1f1;color:#9c2525}';document.head.appendChild(sampleCopyStyle);
    var style=document.createElement('style'); style.textContent='.cf-inline-translate-bar{display:flex;align-items:center;gap:10px;margin:0 0 1em;padding:8px 10px;border:1px solid #b9b9b9;border-radius:4px;background:#f5f5f5;font-family:Arial,sans-serif;font-size:13px}.cf-inline-translate-bar button{padding:4px 12px;cursor:pointer}.cf-inline-translate-bar span{color:#555}.cf-inline-translated-wrap{margin:1.2em 0;padding:0;border:2px solid #4a90e2;border-radius:6px;background:#fff}.cf-inline-translated-heading{padding:9px 14px;background:#eaf3ff;border-bottom:1px solid #b8d6f4;color:#174f86;font:bold 15px Arial,sans-serif}.cf-inline-translated-statement{margin:0!important;padding:1.2em!important}.cf-inline-translated-wrap[hidden]{display:none}.cf-inline-submit-wrap{margin:1.2em 0 2em;border:2px solid #4e9b68;border-radius:6px;background:#fff;font:14px Arial,sans-serif;color:#222}.cf-inline-submit-heading{padding:10px 14px;background:#eaf7ee;border-bottom:1px solid #b8dcc4;color:#24633a;font:bold 16px Arial,sans-serif}.cf-inline-submit-content{padding:14px}.cf-inline-submit-loading{padding:12px;color:#555}.cf-inline-submit-form{display:flex;flex-direction:column;gap:9px}.cf-inline-submit-row{display:flex;align-items:center;gap:12px}.cf-inline-submit-row>span,.cf-inline-submit-source-label{font-weight:bold}.cf-inline-submit-row select{min-width:320px;max-width:100%;padding:5px}.cf-inline-submit-form textarea{box-sizing:border-box;width:100%;min-height:360px;resize:vertical;padding:10px;border:1px solid #aaa;border-radius:3px;font:13px/1.5 Consolas,"Courier New",monospace;tab-size:4}.cf-inline-submit-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.cf-inline-file-button,.cf-inline-submit-tools button{display:inline-block;padding:7px 13px;border:1px solid #888;border-radius:3px;background:#f4f4f4;cursor:pointer}.cf-inline-file-button input{display:none}.cf-inline-submit-tools button{margin-left:auto;border-color:#347a4c;background:#3f925b;color:#fff;font-weight:bold}.cf-inline-submit-tools button:disabled{opacity:.6;cursor:wait}.cf-inline-file-name{color:#666}.cf-inline-submit-status{min-height:20px;padding:6px 8px;border-radius:3px;background:#f5f5f5;color:#555}.cf-inline-submit-status.is-loading{background:#fff8df;color:#765a00}.cf-inline-submit-status.is-success{background:#eaf7ee;color:#24633a}.cf-inline-submit-status.is-error{background:#fff0f0;color:#a32626}.cf-inline-submit-status a{margin-left:8px;font-weight:bold}.cf-inline-too-narrow{display:none}html,body{max-width:100%}.problem-statement,.cf-inline-translated-wrap,.cf-inline-submit-wrap{box-sizing:border-box;max-width:100%}.problem-statement img,.problem-statement table{max-width:100%}.problem-statement .sample-tests,.problem-statement .input,.problem-statement .output{min-width:0;max-width:100%}.problem-statement pre,.datatable{max-width:100%;overflow-x:auto}.MathJax_Display,mjx-container[display="true"]{max-width:100%;overflow-x:auto;overflow-y:hidden}@media (max-width:1200px){html,body{min-width:0!important;overflow-x:hidden}#body{box-sizing:border-box;width:auto!important;min-width:0!important;max-width:100%!important;margin-left:12px!important;margin-right:12px!important}#pageContent,#pageContent>.content{box-sizing:border-box;min-width:0!important;max-width:100%!important;width:auto!important}.content-with-sidebar{margin-right:0!important}#sidebar{display:none!important}.problem-statement,.cf-inline-translated-statement{overflow-wrap:anywhere}.problem-statement table{display:block;overflow-x:auto}.roundbox{max-width:100%;box-sizing:border-box}}@media (max-width:760px){#body{margin-left:7px!important;margin-right:7px!important}.menu-box,.menu-list,.second-level-menu,.second-level-menu-list{height:auto!important;min-height:0!important;overflow:visible!important}.menu-list,.second-level-menu-list{box-sizing:border-box;display:flex!important;flex-wrap:wrap!important;position:static!important}.menu-list{margin:.15em 0!important;padding-left:.7em!important}.second-level-menu{box-sizing:border-box;position:static!important;left:auto!important;top:auto!important;clear:both!important;margin:0 0 .65em!important}.second-level-menu-list{width:100%!important;margin:0!important;padding:0!important}.menu-list li,.second-level-menu-list li{box-sizing:border-box;float:none!important;margin-right:.65em!important;white-space:nowrap}.menu-list li.backLava,.second-level-menu-list li.backLava{display:none!important}.action-link{box-sizing:border-box;clear:both!important;height:auto!important;min-height:2.2em!important;margin:.25em 0 .55em!important}.action-link>div{position:static!important;right:auto!important;top:auto!important;line-height:2em!important;text-align:right!important;white-space:normal!important}#pageContent{clear:both!important}.cf-inline-translate-bar,.cf-inline-submit-row{align-items:stretch;flex-direction:column}.cf-inline-submit-row select{min-width:0;width:100%}.cf-inline-submit-tools button{margin-left:0}.problem-statement{font-size:1em!important}.problem-statement .header .title{font-size:1.35em!important}}@media (max-width:520px){#body{margin-left:5px!important;margin-right:5px!important}#header{box-sizing:border-box;max-width:100%!important;height:auto!important;min-height:0!important}#header img{max-width:100%!important;height:auto}.menu-box{line-height:1.9em!important;padding-top:.4em!important}.menu-list,.second-level-menu-list{gap:2px 0}.menu-list li,.second-level-menu-list li{margin-right:.55em!important}.menu-list li a,.second-level-menu-list li a{font-size:14px!important}.action-link>div{text-align:left!important}.cf-inline-translate-bar{gap:7px;padding:7px}.cf-inline-translate-bar button{width:100%}.cf-inline-translated-statement{padding:.8em!important}.cf-inline-submit-content{padding:10px}.problem-statement .header .title{font-size:1.2em!important}}@media (max-width:380px){body>.cf-inline-too-narrow{box-sizing:border-box;display:flex!important;position:fixed;inset:12px;z-index:2147483647;align-items:center;justify-content:center;flex-direction:column;gap:10px;padding:22px;border:2px solid #b88320;border-radius:8px;background:#fff8df;color:#5f470c;text-align:center;font:15px/1.6 -apple-system,"Segoe UI",sans-serif}body>:not(.cf-inline-too-narrow){display:none!important}}'; document.head.appendChild(style);
    var controlledDesktop=document.createElement('style');controlledDesktop.id='cf-inline-controlled-desktop-style';controlledDesktop.textContent=${controlledDesktopStyle};document.head.appendChild(controlledDesktop);
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start); else start();
  })();</script>`;
}
