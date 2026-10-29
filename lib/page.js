// 切换页：单文件、零依赖、手机优先。
// 为什么自己写而不走 DSH 的 React 客户端：这个页要能当独立「手机 App」用（加桌面、
// 直接打开），不依赖 DSH 的界面与路由，界面也只管一件事——选电脑、点开。
export const PAGE_PATH = '/dsh-pocket-switch/';
export const API_PATH = '/dsh-pocket-switch/api';

/**
 * 复制：Clipboard API 优先 → execCommand → 选中文本让用户按 Ctrl+C。
 * 依赖注入（document/navigator/toast）是为了能在 node 里单测三条路径。
 */
export function copyText(deps, text, okMessage, fallbackNode) {
  var api = deps || {};
  var doc = api.document || (typeof document !== 'undefined' ? document : null);
  var nav = api.navigator || (typeof navigator !== 'undefined' ? navigator : null);
  var say = typeof api.toast === 'function' ? api.toast : function () {};
  function selectFallback() {
    if (!fallbackNode || !doc) return false;
    try {
      var range = doc.createRange();
      range.selectNodeContents(fallbackNode);
      var selection = doc.getSelection ? doc.getSelection() : (doc.defaultView && doc.defaultView.getSelection ? doc.defaultView.getSelection() : null);
      if (!selection) return false;
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    } catch (error) {
      return false;
    }
  }
  function legacy() {
    if (doc && doc.body && doc.createElement && doc.execCommand) {
      var area = doc.createElement('textarea');
      area.value = String(text);
      doc.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = doc.execCommand('copy'); } catch (error) { ok = false; }
      doc.body.removeChild(area);
      if (ok) { say(okMessage); return true; }
    }
    if (selectFallback()) { say('浏览器不让自动复制：已选中内容，按 Ctrl+C 复制'); return false; }
    say('复制失败，请手动选择');
    return false;
  }
  if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
    return nav.clipboard.writeText(String(text)).then(function () { say(okMessage); return true; }, function () { return legacy(); });
  }
  return legacy();
}

function isLoopbackHost(host) {
  var value = String(host || '').toLowerCase();
  return value === 'localhost' || value === '::1' || value === '[::1]' || value === '127.0.0.1' || value.indexOf('127.') === 0;
}

/**
 * 「用当前页面地址」按钮的状态：origin 必须是 http(s) 且非 loopback。
 * 桌面 app 的 origin 是 dsh-app://，手机打不开 → 置灰并给出人话提示。
 */
export function originButtonState(origin) {
  var usable = false;
  try {
    var url = new URL(String(origin || ''));
    usable = (url.protocol === 'http:' || url.protocol === 'https:') && !isLoopbackHost(url.hostname);
  } catch (e) {
    usable = false;
  }
  return {
    disabled: !usable,
    title: usable ? '' : '当前是桌面外壳，读不到网页地址，请手动粘贴公网地址',
    noteHidden: usable,
  };
}

/** 默认地址：上次保存的 → 当前页面 origin（必须是网页地址）→ 局域网探活地址。 */
export function pickDefaultAddress(input) {
  var value = input || {};
  if (value.savedUrl) return value.savedUrl;
  var origin = String(value.origin || '');
  if (!originButtonState(origin).disabled) return origin;
  return String(value.lanUrl || '');
}

/** 剪贴板里常带换行、空格和包裹引号：取第一行、去首尾引号，返回干净地址（可能为空）。 */
export function sanitizePastedUrl(text) {
  var value = String(text == null ? '' : text).trim();
  if (!value) return '';
  var lines = value.split(/[\r\n]+/);
  var first = '';
  for (var i = 0; i < lines.length; i += 1) {
    var line = lines[i].trim();
    if (!line) continue;
    line = line.replace(/^[\s"'\`\u201c\u201d\u2018\u2019\u00ab\u00bb]+/, '').replace(/[\s"'\`\u201c\u201d\u2018\u2019\u00ab\u00bb]+$/, '');
    if (!line) continue;
    if (/^https?:\/\//i.test(line)) return line;
    if (!first) first = line;
  }
  return first;
}

export const PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#4f6ef7">
<meta name="color-scheme" content="light dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="换电脑">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="icon" type="image/png" href="icon-192.png">
<title>换电脑</title>
<style>
:root{--bg:#f4f5f8;--card:#fff;--text:#0f172a;--muted:#6b7280;--line:#e6e8ee;--brand:#4f6ef7;--brand-weak:#eef1ff;--danger:#dc2626;--shadow:0 1px 2px rgba(15,23,42,.05),0 10px 26px -14px rgba(15,23,42,.25);--radius:16px}
@media (prefers-color-scheme: dark){:root{--bg:#0e1015;--card:#171a21;--text:#e8eaef;--muted:#98a2b3;--line:#262b35;--brand:#6d86ff;--brand-weak:#1e2436;--danger:#ff6b6b;--shadow:0 1px 2px rgba(0,0,0,.45)}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased;padding-bottom:calc(28px + env(safe-area-inset-bottom))}
button{font:inherit;color:inherit}
.wrap{max-width:560px;margin:0 auto;padding:calc(16px + env(safe-area-inset-top)) 16px 0}
.top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px}
h1{font-size:24px;line-height:1.2;margin:0 0 4px}
.sub{margin:0;color:var(--muted);font-size:13px}
.round{flex:none;width:42px;height:42px;border-radius:50%;border:1px solid var(--line);background:var(--card);box-shadow:var(--shadow);font-size:24px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0 0 2px}
.round:active{transform:scale(.96)}
.list{display:flex;flex-direction:column;gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:14px}
.card-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.name{font-weight:600;font-size:17px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{flex:none;font-size:11px;font-weight:500;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:1px 8px}
.meta{margin-left:auto;flex:none;color:var(--muted);font-size:12px}
.open{display:flex;align-items:center;gap:10px;width:100%;min-height:56px;padding:9px 14px;border:none;border-radius:12px;background:var(--brand);color:#fff;text-align:left;cursor:pointer;box-shadow:0 6px 16px -8px rgba(79,110,247,.9)}
.open:active{opacity:.88}
.open-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.open-title{font-weight:600;font-size:16px}
.open-sub{font-size:12px;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chev{flex:none;font-size:18px;opacity:.9}
.alts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.alt{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--muted);font-size:12px;cursor:pointer;max-width:100%}
.alt:active{background:var(--brand-weak)}
.alt b{font-weight:600;color:var(--text)}
.tools{display:none;gap:8px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)}
.manage .tools{display:flex}
.tool{height:32px;padding:0 10px;border-radius:8px;border:1px solid var(--line);background:transparent;font-size:12px;color:var(--muted);cursor:pointer}
.tool.danger{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 40%,transparent)}
.empty{background:var(--card);border:1px dashed var(--line);border-radius:var(--radius);padding:28px 18px;text-align:center;color:var(--muted);font-size:14px;line-height:1.7}
.empty b{display:block;color:var(--text);font-size:16px;margin-bottom:6px}
.foot{display:flex;flex-wrap:wrap;align-items:center;gap:6px;justify-content:center;margin:22px 0 8px;font-size:13px}
.link{border:none;background:none;padding:4px;color:var(--muted);text-decoration:none;cursor:pointer;font-size:13px}
.link:active{color:var(--text)}
.dot-sep{color:var(--line)}
.tiny{text-align:center;color:var(--muted);font-size:11px;opacity:.8;margin:6px 0 0;line-height:1.6}
.pair{margin-bottom:14px}
.pair-hint{margin:2px 0 10px;color:var(--muted);font-size:12px;line-height:1.6}
.pair-row{display:flex;align-items:center;gap:8px;min-width:0;padding:6px 0;border-top:1px dashed var(--line)}
.pair-row:first-of-type{border-top:none}
.pair-k{flex:none;width:38px;color:var(--muted);font-size:12px}
.pair-v{flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mono{font-family:ui-monospace,Menlo,Consolas,monospace}
.pair-field{margin:2px 0 6px;display:flex;align-items:center;gap:6px;min-width:0}
.pair-tag{flex:none;white-space:nowrap;font-size:11px;line-height:18px;color:var(--brand);border:1px solid color-mix(in srgb,var(--brand) 35%,var(--line));background:var(--brand-weak);border-radius:999px;padding:0 8px}
.pair-btns{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 2px}
.pair-btns .btn{flex:1 1 96px;min-height:38px;font-size:13px;padding:0 8px}
.pair-origin-note{margin:6px 0 2px;font-size:12px;color:var(--muted);line-height:1.6}
.pair-help{margin:8px 0 2px;font-size:12px;color:var(--muted)}
.pair-help summary{cursor:pointer;color:var(--brand);font-size:12px;padding:2px 0}
.pair-help p{margin:6px 0 0;line-height:1.7;color:var(--text)}
.pair-warn{margin:8px 0 2px;padding:8px 10px;border-radius:10px;font-size:12px;line-height:1.6;color:color-mix(in srgb,#8a5a00 85%,var(--text));background:color-mix(in srgb,#f0b400 14%,var(--card));border:1px solid color-mix(in srgb,#f0b400 45%,var(--line))}
.pair-actions{display:flex;gap:8px;margin-top:10px}
.pair-actions .btn{flex:1;min-height:38px;font-size:13px;padding:0 10px}
.pair-code{margin-top:8px;padding:8px 10px;border-radius:10px;background:var(--bg);border:1px solid var(--line);font-size:11px;line-height:1.5;max-height:96px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-all}
.notice{margin-bottom:14px;border:1px solid color-mix(in srgb,var(--danger) 40%,var(--line));background:color-mix(in srgb,var(--danger) 8%,var(--card));color:var(--text);border-radius:12px;padding:12px 14px;font-size:13px;line-height:1.7}
.notice a{color:var(--brand)}
.backdrop{position:fixed;inset:0;z-index:50;background:rgba(9,12,20,.5);display:flex;align-items:flex-end;justify-content:center}
.sheet{width:100%;max-width:560px;background:var(--card);border-radius:20px 20px 0 0;max-height:90vh;display:flex;flex-direction:column;padding-bottom:env(safe-area-inset-bottom);box-shadow:0 -10px 40px rgba(0,0,0,.25)}
@media (min-width:720px){.backdrop{align-items:center}.sheet{border-radius:20px;max-height:82vh;margin-bottom:0}}
.sheet-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 18px 8px}
.sheet-title{font-weight:600;font-size:17px;margin:0}
.sheet-close{border:none;background:none;font-size:20px;color:var(--muted);cursor:pointer;padding:4px 6px}
.sheet-body{overflow:auto;padding:4px 18px 8px;-webkit-overflow-scrolling:touch}
.sheet-actions{display:flex;gap:10px;padding:12px 18px 18px}
.field{display:block;margin:12px 0}
.label{display:block;font-size:12px;color:var(--muted);margin-bottom:6px}
.input,.select,.textarea{width:100%;border:1px solid var(--line);background:var(--bg);color:var(--text);border-radius:10px;padding:11px 12px;font:inherit;font-size:15px;outline:none}
.input:focus,.select:focus,.textarea:focus{border-color:var(--brand);box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 18%,transparent)}
.textarea{min-height:120px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;resize:vertical}
.ep-edit{border:1px solid var(--line);border-radius:12px;padding:10px;margin:10px 0;background:var(--bg)}
.ep-edit-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.ep-edit-head .select{width:104px;padding:8px 10px;font-size:13px}
.ep-edit-head .grow{flex:1}
.ep-edit .input{margin-top:8px}
.ep-edit .input:first-of-type{margin-top:0}
.btn{flex:1;min-height:46px;border-radius:12px;border:1px solid var(--line);background:var(--card);cursor:pointer;font-weight:600;font-size:15px;padding:0 14px}
.btn.primary{background:var(--brand);border-color:var(--brand);color:#fff}
.btn.ghost{background:transparent}
.btn.danger{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 40%,var(--line))}
.btn.small{flex:none;min-height:38px;font-size:13px;padding:0 12px;font-weight:500}
.btn:disabled{opacity:.5;cursor:default}
.row-actions{display:flex;gap:10px;margin-top:16px}
.hint{font-size:12px;color:var(--muted);line-height:1.7;margin:8px 0 0}
.help{font-size:14px;line-height:1.85}
.help h3{font-size:14px;margin:16px 0 4px}
.help p,.help li{color:var(--text);margin:4px 0}
.help ul,.help ol{padding-left:20px;margin:4px 0}
.help .muted{color:var(--muted);font-size:12px}
.toast{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:80;max-width:84vw;background:rgba(17,24,39,.94);color:#fff;padding:11px 18px;border-radius:12px;font-size:14px;line-height:1.6;text-align:center;box-shadow:0 12px 34px rgba(0,0,0,.3)}
.spin{display:inline-block;width:14px;height:14px;border:2px solid color-mix(in srgb,currentColor 30%,transparent);border-top-color:currentColor;border-radius:50%;animation:spin .8s linear infinite;vertical-align:-2px;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div>
      <h1>换电脑</h1>
      <p id="sub" class="sub">正在读取…</p>
    </div>
    <button id="btn-add" class="round" type="button" aria-label="添加电脑">+</button>
  </header>
  <div id="notice" class="notice" hidden></div>
  <section id="pair-card" class="card pair" hidden>
    <div class="card-head"><span class="name">本机配对</span><span class="badge">手机用</span></div>
    <label class="pair-field" for="pair-url-input"><span class="pair-k">手机访问地址</span><span id="pair-source" class="pair-tag" hidden></span></label>
    <input id="pair-url-input" class="input mono" type="url" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://xxx.trycloudflare.com">
    <div id="pair-origin-note" class="pair-origin-note" hidden>当前是桌面外壳，读不到网页地址，请手动粘贴公网地址</div>
    <details id="pair-help" class="pair-help">
      <summary>公网地址在哪看？</summary>
      <p>公网地址在 设置 →『手机访问』→ 公网 一栏，形如 https://xxx.trycloudflare.com，点旁边的复制按钮即可。隧道每次重开可能变，变了回来改这里。</p>
    </details>
    <div class="pair-btns"><button id="pair-use-page" class="btn small ghost" type="button">用当前页面地址</button><button id="pair-paste" class="btn small ghost" type="button">粘贴并保存</button><button id="pair-save" class="btn small primary" type="button">保存</button></div>
    <div class="pair-btns"><button id="pair-detect" class="btn small ghost" type="button">重新检测公网地址</button><button id="pair-auto" class="btn small ghost" type="button" hidden>恢复自动</button></div>
    <div id="pair-warn" class="pair-warn" hidden>当前是局域网地址，手机可能需要同一 WiFi；出门请填 dsh-pocket 的公网地址</div>
    <div class="pair-row"><span class="pair-k">密码</span><span id="pair-pin" class="pair-v mono">••••</span><button id="pair-eye" class="tool" type="button">显示</button></div>
    <div class="pair-row"><span class="pair-k">当前</span><span id="pair-current" class="pair-v mono">—</span></div>
    <div id="pair-text" class="pair-code mono" style="display:none"></div>
    <div class="pair-actions"><button id="pair-copy" class="btn small primary" type="button">复制配对串</button><button id="pair-refresh" class="btn small ghost" type="button">刷新</button></div>
    <p id="pair-hint" class="pair-hint">手机 app 里粘贴这串即可自动填入地址和密码</p>
  </section>
  <section id="list" class="list"></section>
  <div class="foot">
    <button id="btn-manage" class="link" type="button">管理</button>
    <span class="dot-sep">·</span>
    <button id="btn-transfer" class="link" type="button">导入/导出</button>
    <span class="dot-sep">·</span>
    <button id="btn-help" class="link" type="button">使用说明</button>
    <span class="dot-sep">·</span>
    <a class="link" href="/">返回 DSH</a>
  </div>
  <p class="tiny">配置只存在这台电脑上 · 只有通过 dsh-pocket 登录手机访问后能看到</p>
</div>
<div id="sheet-root"></div>
<div id="toast" class="toast" hidden></div>
<script>
(function () {
  'use strict';
  var API = 'api';
  var state = { instances: [], local: null, manage: false, pair: null, pinShown: false, pairEditing: false };
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function toast(text) {
    var node = $('toast');
    node.textContent = text;
    node.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.hidden = true; }, 2400);
  }
  function api(action, payload) {
    var body = Object.assign({ action: action }, payload || {});
    return fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401 || res.status === 403) {
          var auth = new Error('AUTH');
          auth.code = 'AUTH';
          throw auth;
        }
        if (!res.ok || !data || data.error) {
          var err = new Error((data && data.error) || ('请求失败 HTTP ' + res.status));
          err.code = 'API';
          throw err;
        }
        return data;
      });
    });
  }
  function ago(iso) {
    if (!iso) return '';
    var time = Date.parse(iso);
    if (!time) return '';
    var diff = Date.now() - time;
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚用过';
    if (mins < 60) return mins + ' 分钟前';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + ' 小时前';
    var days = Math.floor(hours / 24);
    if (days < 60) return days + ' 天前';
    return '';
  }
  function kindName(kind) {
    if (kind === 'lan') return '局域网';
    if (kind === 'public') return '公网';
    return '地址';
  }
  function endpointOf(inst, id) {
    for (var i = 0; i < inst.endpoints.length; i += 1) {
      if (inst.endpoints[i].id === id) return inst.endpoints[i];
    }
    return inst.endpoints[0];
  }
  function displayUrl(url) {
    try {
      var u = new URL(url);
      return u.host + (u.pathname === '/' ? '' : u.pathname);
    } catch (e) {
      return url;
    }
  }
  function navigate(inst, ep) {
    if (!ep || !ep.url) { toast('这台电脑还没填地址'); return; }
    var target;
    try {
      target = new URL(ep.url);
    } catch (e) {
      toast('地址格式不对');
      return;
    }
    if (ep.token) target.searchParams.set('token', ep.token);
    // keepalive：马上要跳走，普通请求会被导航掐断，上次打开记录就丢了
    try {
      fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'record-open', id: inst.id, endpointId: ep.id }), keepalive: true }).catch(function () {});
    } catch (e) {}
    window.location.assign(target.toString());
  }

  function showAuthNotice() {
    var notice = $('notice');
    notice.hidden = false;
    notice.textContent = '';
    notice.appendChild(el('div', null, '登录状态过期了，先回 DSH 首页重新登录一次，再打开这个页面。'));
    var link = el('a', null, '去 DSH 首页');
    link.href = '/';
    notice.appendChild(link);
  }
  function hideNotice() { $('notice').hidden = true; }

  function renderHeader() {
    var sub = $('sub');
    var total = state.instances.length;
    var local = state.local;
    var parts = [];
    if (local && local.hostname) parts.push('这台电脑：' + local.hostname);
    parts.push(total === 0 ? '还没有添加电脑' : '共 ' + total + ' 台');
    sub.textContent = parts.join(' · ');
    $('btn-manage').textContent = state.manage ? '完成' : '管理';
  }

  function renderList() {
    var list = $('list');
    list.textContent = '';
    list.className = 'list' + (state.manage ? ' manage' : '');
    if (state.instances.length === 0) {
      var empty = el('div', 'empty');
      empty.appendChild(el('b', null, '还没有电脑'));
      empty.appendChild(el('div', null, '先把这台电脑加进来，再去另一台上复制配置。'));
      var quick = el('button', 'btn primary', '添加这台电脑');
      quick.type = 'button';
      quick.style.marginTop = '14px';
      quick.addEventListener('click', function () { openEditor(null, true); });
      empty.appendChild(quick);
      list.appendChild(empty);
      return;
    }
    state.instances.forEach(function (inst) {
      var card = el('article', 'card');
      var head = el('div', 'card-head');
      head.appendChild(el('span', 'name', inst.name));
      if (state.local && inst.name === state.local.hostname) head.appendChild(el('span', 'badge', '这台'));
      var meta = el('span', 'meta', ago(inst.lastOpenedAt));
      head.appendChild(meta);
      card.appendChild(head);

      var preferred = endpointOf(inst, inst.preferredEndpointId);
      var open = el('button', 'open');
      open.type = 'button';
      var main = el('span', 'open-main');
      main.appendChild(el('span', 'open-title', '打开 DSH'));
      main.appendChild(el('span', 'open-sub', kindName(preferred.kind) + ' · ' + displayUrl(preferred.url)));
      open.appendChild(main);
      open.appendChild(el('span', 'chev', '›'));
      open.addEventListener('click', function () { navigate(inst, preferred); });
      card.appendChild(open);

      var others = inst.endpoints.filter(function (ep) { return ep.id !== preferred.id; });
      if (others.length > 0) {
        var alts = el('div', 'alts');
        others.forEach(function (ep) {
          var btn = el('button', 'alt');
          btn.type = 'button';
          btn.appendChild(el('b', null, kindName(ep.kind)));
          btn.appendChild(el('span', null, displayUrl(ep.url)));
          btn.addEventListener('click', function () { navigate(inst, ep); });
          alts.appendChild(btn);
        });
        card.appendChild(alts);
      }

      var tools = el('div', 'tools');
      var edit = el('button', 'tool', '编辑');
      edit.type = 'button';
      edit.addEventListener('click', function () { openEditor(inst); });
      tools.appendChild(edit);
      var copy = el('button', 'tool', '复制配置');
      copy.type = 'button';
      copy.addEventListener('click', function () { copyTo(JSON.stringify({ name: inst.name, endpoints: inst.endpoints.map(function (ep) { return { kind: ep.kind, url: ep.url, token: ep.token }; }) }, null, 2), '配置已复制'); });
      tools.appendChild(copy);
      var up = el('button', 'tool', '上移');
      up.type = 'button';
      up.addEventListener('click', function () { move(inst.id, -1); });
      tools.appendChild(up);
      var down = el('button', 'tool', '下移');
      down.type = 'button';
      down.addEventListener('click', function () { move(inst.id, 1); });
      tools.appendChild(down);
      var del = el('button', 'tool danger', '删除');
      del.type = 'button';
      del.addEventListener('click', function () { removeInstance(inst); });
      tools.appendChild(del);
      card.appendChild(tools);
      list.appendChild(card);
    });
  }

  function render() { renderHeader(); renderList(); }

  var copyText = ${copyText};
  var sanitizePastedUrl = ${sanitizePastedUrl};
  var originButtonState = ${originButtonState};
  var pickDefaultAddress = ${pickDefaultAddress};
  function copyTo(text, okMessage, fallbackNode) {
    return copyText({ navigator: navigator, document: document, toast: toast }, text, okMessage, fallbackNode);
  }

  function closeSheet() {
    $('sheet-root').textContent = '';
  }
  function openSheet(title, buildBody, buildActions) {
    closeSheet();
    var backdrop = el('div', 'backdrop');
    var sheet = el('div', 'sheet');
    var head = el('div', 'sheet-head');
    head.appendChild(el('h2', 'sheet-title', title));
    var close = el('button', 'sheet-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', closeSheet);
    head.appendChild(close);
    sheet.appendChild(head);
    var body = el('div', 'sheet-body');
    buildBody(body);
    sheet.appendChild(body);
    var actions = el('div', 'sheet-actions');
    buildActions(actions);
    sheet.appendChild(actions);
    backdrop.appendChild(sheet);
    backdrop.addEventListener('click', function (event) { if (event.target === backdrop) closeSheet(); });
    $('sheet-root').appendChild(backdrop);
    return { close: closeSheet, body: body };
  }

  function move(id, delta) {
    var ids = state.instances.map(function (inst) { return inst.id; });
    var index = ids.indexOf(id);
    var next = index + delta;
    if (index < 0 || next < 0 || next >= ids.length) return;
    ids.splice(index, 1);
    ids.splice(next, 0, id);
    api('reorder', { ids: ids }).then(load).catch(function (err) { toast(err.message); });
  }

  function removeInstance(inst) {
    if (!window.confirm('删除「' + inst.name + '」？只删本机保存的配置，不影响那台电脑。')) return;
    api('remove', { id: inst.id }).then(load).catch(function (err) { toast(err.message); });
  }

  function newDraft() {
    return { name: '', endpoints: [{ kind: 'lan', url: '', token: '' }] };
  }

  function openEditor(inst, autoFillNow) {
    var draft = inst ? JSON.parse(JSON.stringify(inst)) : newDraft();
    openSheet(inst ? '编辑电脑' : '添加电脑', function (body) {
      var nameField = el('label', 'field');
      nameField.appendChild(el('span', 'label', '名字'));
      var nameInput = el('input', 'input');
      nameInput.placeholder = '例如：家里、公司';
      nameInput.value = draft.name || '';
      nameInput.addEventListener('input', function () { draft.name = nameInput.value; });
      nameField.appendChild(nameInput);
      body.appendChild(nameField);

      body.appendChild(el('span', 'label', '地址与密码（每台可填多个地址，比如局域网 + 公网）'));
      var epsBox = el('div');
      body.appendChild(epsBox);

      function redrawEndpoints() {
        epsBox.textContent = '';
        draft.endpoints.forEach(function (ep, index) {
          var box = el('div', 'ep-edit');
          var head = el('div', 'ep-edit-head');
          var select = el('select', 'select');
          [['lan', '局域网'], ['public', '公网'], ['custom', '其他']].forEach(function (item) {
            var option = el('option', null, item[1]);
            option.value = item[0];
            if (ep.kind === item[0]) option.selected = true;
            select.appendChild(option);
          });
          select.addEventListener('change', function () { ep.kind = select.value; });
          head.appendChild(select);
          head.appendChild(el('span', 'grow'));
          var del = el('button', 'btn small danger', '删除地址');
          del.type = 'button';
          del.disabled = draft.endpoints.length <= 1;
          del.addEventListener('click', function () {
            draft.endpoints.splice(index, 1);
            redrawEndpoints();
          });
          head.appendChild(del);
          box.appendChild(head);

          var urlInput = el('input', 'input');
          urlInput.placeholder = 'http://192.168.1.5:3081 或 https://xxx.trycloudflare.com';
          urlInput.inputMode = 'url';
          urlInput.autocapitalize = 'off';
          urlInput.spellcheck = false;
          urlInput.value = ep.url || '';
          urlInput.addEventListener('input', function () { ep.url = urlInput.value; });
          box.appendChild(urlInput);

          var tokenInput = el('input', 'input');
          tokenInput.placeholder = '访问密码（pocket 设置页里那个；没开密码可留空）';
          tokenInput.autocapitalize = 'off';
          tokenInput.spellcheck = false;
          tokenInput.value = ep.token || '';
          tokenInput.addEventListener('input', function () { ep.token = tokenInput.value; });
          box.appendChild(tokenInput);
          epsBox.appendChild(box);
        });
      }
      redrawEndpoints();

      var addEp = el('button', 'btn small ghost', '+ 再加一个地址');
      addEp.type = 'button';
      addEp.addEventListener('click', function () {
        draft.endpoints.push({ kind: 'custom', url: '', token: '' });
        redrawEndpoints();
      });
      body.appendChild(addEp);

      var fill = el('button', 'btn small ghost', '从这台电脑的 dsh-pocket 自动填入');
      fill.type = 'button';
      fill.style.marginLeft = '8px';
      fill.addEventListener('click', function () {
        fill.disabled = true;
        fill.textContent = '读取中…';
        autoFill(draft).then(function (filled) {
          if (!filled) toast('没读到本机 pocket 配置，请手动填');
          nameInput.value = draft.name || '';
          redrawEndpoints();
        }).catch(function (err) {
          toast(err.message || '读取失败');
        }).then(function () {
          fill.disabled = false;
          fill.textContent = '从这台电脑的 dsh-pocket 自动填入';
        });
      });
      body.appendChild(fill);

      if (autoFillNow) {
        fill.disabled = true;
        fill.textContent = '读取中…';
        autoFill(draft).then(function (filled) {
          if (!filled) toast('没读到本机 pocket 配置，请手动填');
          nameInput.value = draft.name || '';
          redrawEndpoints();
        }).catch(function (err) {
          toast(err.message || '读取失败');
        }).then(function () {
          fill.disabled = false;
          fill.textContent = '从这台电脑的 dsh-pocket 自动填入';
        });
      }

      body.appendChild(el('p', 'hint', '公网地址（快速隧道）每次重启 DSH 会变；变了你回到「编辑」里换一下地址就行。把两台电脑的 pocket 密码都设成自定义固定密码，就几乎不用再改。'));
    }, function (actions) {
      var cancel = el('button', 'btn ghost', '取消');
      cancel.type = 'button';
      cancel.addEventListener('click', closeSheet);
      actions.appendChild(cancel);
      var save = el('button', 'btn primary', '保存');
      save.type = 'button';
      save.addEventListener('click', function () {
        save.disabled = true;
        save.textContent = '保存中…';
        var payload = inst && inst.id ? Object.assign({ id: inst.id }, draft) : draft;
        api('save', { instance: payload }).then(function () {
          closeSheet();
          toast('已保存');
          load();
        }).catch(function (err) {
          toast(err.message);
          save.disabled = false;
          save.textContent = '保存';
        });
      });
      actions.appendChild(save);
    });
  }

  // 先问 pocket 的实时状态（能拿到公网地址 + 两个密码），拿不到再退回宿主读到的本机文件。
  function pocketStatus() {
    return fetch('/dsh-pocket/pocket.status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rpcId: 'dsh-pocket-switch', method: 'pocket.status', payload: {} })
    }).then(function (res) {
      if (!res.ok) throw new Error('pocket HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      if (!data || !data.result || data.result.ok !== true) throw new Error('pocket 未就绪');
      return data.result.value;
    });
  }
  function autoFill(draft) {
    return pocketStatus().then(function (status) {
      var endpoints = [];
      if (status.lanEnabled !== false && status.lanUrl) {
        endpoints.push({ kind: 'lan', url: status.lanUrl, token: status.lanAuthEnabled === false ? '' : (status.lanToken || '') });
      }
      var publicUrl = status.tunnelUrl || '';
      if (!publicUrl && status.tunnelConfig && status.tunnelConfig.mode === 'named' && status.tunnelConfig.hostname) {
        publicUrl = 'https://' + status.tunnelConfig.hostname;
      }
      if (publicUrl) endpoints.push({ kind: 'public', url: publicUrl, token: status.accessToken || '' });
      if (endpoints.length === 0) throw new Error('pocket 没开访问（局域网和公网都不可用）');
      draft.endpoints = endpoints;
      if (!draft.name && state.local && state.local.hostname) draft.name = state.local.hostname;
      return true;
    }).catch(function () {
      var local = state.local;
      if (!local || !local.pocket) return false;
      var endpoints = [];
      if (local.pocket.lanEnabled && local.pocket.lanAuthEnabled && local.lanCandidates.length > 0) {
        endpoints.push({ kind: 'lan', url: 'http://' + local.lanCandidates[0].address + ':' + local.pocket.proxyPort, token: local.pocket.lanToken || '' });
      }
      if (local.pocket.tunnelMode === 'named' && local.pocket.tunnelHostname) {
        endpoints.push({ kind: 'public', url: 'https://' + local.pocket.tunnelHostname, token: local.pocket.publicToken || '' });
      }
      if (endpoints.length === 0) return false;
      draft.endpoints = endpoints;
      if (!draft.name) draft.name = local.hostname || '';
      return true;
    });
  }

  function openTransfer() {
    openSheet('导入 / 导出', function (body) {
      body.appendChild(el('p', 'hint', '把这台的配置复制到另一台（或备份）：下面是完整 JSON，可以直接复制；也可以把别处复制的 JSON 粘进来点「导入」。'));
      var area = el('textarea', 'textarea');
      body.appendChild(area);
      api('state').then(function (data) {
        area.value = JSON.stringify(data.export, null, 2);
      }).catch(function () {});
    }, function (actions) {
      var copy = el('button', 'btn ghost', '复制');
      copy.type = 'button';
      copy.addEventListener('click', function () {
        var area = document.querySelector('#sheet-root .textarea');
        copyTo(area.value, '已复制', area);
      });
      actions.appendChild(copy);
      var doImport = el('button', 'btn primary', '导入');
      doImport.type = 'button';
      doImport.addEventListener('click', function () {
        var area = document.querySelector('#sheet-root .textarea');
        doImport.disabled = true;
        api('import', { text: area.value }).then(function (result) {
          closeSheet();
          toast('已导入 ' + result.imported + (result.skipped ? '，跳过 ' + result.skipped : ''));
          load();
        }).catch(function (err) {
          toast(err.message);
          doImport.disabled = false;
        });
      });
      actions.appendChild(doImport);
    });
  }

  function openHelp() {
    openSheet('使用说明', function (body) {
      var box = el('div', 'help');
      box.innerHTML = '<h3>这是什么</h3><p>把多台电脑的「手机访问」（dsh-pocket）地址和密码存在一起，点一下直接进那台电脑的 DSH，不用再分别记网址、输密码。</p>'
        + '<h3>怎么添加</h3><ol><li>在装了 dsh-pocket 的电脑上点「从这台电脑自动填入」，名字、地址、密码一次到位。</li>'
        + '<li>另一台电脑：在它上面也装这个插件，同样自动填入，然后「导入/导出」里复制粘贴过来；或者手动填那台的局域网地址 + 密码。</li></ol>'
        + '<h3>关于密码</h3><p>密码就是 dsh-pocket 设置页里的「访问密码」（局域网和公网可能是两个不同的）。建议都点「自定义」设成固定的 8 位以上密码——这样重启后密码不变，这里也就一直能用。</p>'
        + '<h3>关于地址</h3><p>局域网地址要在同一个 WiFi 下才有用；公网地址人在外面用。快速隧道的公网地址每次重启 DSH 会变，变了回「编辑」改一下地址即可（配了固定域名就不会变）。</p>'
        + '<h3>加到手机桌面</h3><p>iPhone：用 Safari 打开本页 → 分享 → 添加到主屏幕。<br>安卓：Chrome 打开 → 右上角三个点 → 添加到主屏幕。</p>'
        + '<h3>安全</h3><p>密码只写在这台电脑的 DSH 数据目录里，只有已经通过 dsh-pocket 登录的人能打开本页看到。别把本页截图或「复制配置」的内容发给别人。</p>'
        + '<p class="muted">插件：dsh-pocket-switch</p>';
      body.appendChild(box);
    }, function (actions) {
      var ok = el('button', 'btn primary', '知道了');
      ok.type = 'button';
      ok.addEventListener('click', closeSheet);
      actions.appendChild(ok);
    });
  }

  function isLoopbackOrigin(value) {
    try {
      var host = new URL(value).hostname.toLowerCase();
      return host === 'localhost' || host === '::1' || host === '[::1]' || host === '127.0.0.1' || host.indexOf('127.') === 0;
    } catch (e) {
      return true;
    }
  }

  function isPrivateHost(value) {
    try {
      var host = new URL(value).hostname;
      return /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    } catch (e) {
      return false;
    }
  }

  // Electron 桌面外壳的 origin 是 dsh-app://，不是网页地址，不能拿来配对
  function isWebOrigin(value) {
    try {
      var url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      return !isLoopbackOrigin(value);
    } catch (e) {
      return false;
    }
  }

  function isWebUrl(value) {
    try {
      var url = new URL(String(value || '').trim());
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  function pageOrigin() {
    try { return window.location.origin || ''; } catch (e) { return ''; }
  }

  // 默认值：上次记住的地址 → 当前页面 origin（必须是 http/https 且非 loopback）→ pocket 代理的局域网地址
  function suggestedUrl() {
    var info = state.pair || {};
    return pickDefaultAddress({ savedUrl: info.savedUrl, origin: pageOrigin(), lanUrl: info.lanUrl });
  }

  function updateOriginButton() {
    var view = originButtonState(pageOrigin());
    var button = $('pair-use-page');
    button.disabled = view.disabled;
    button.title = view.title;
    $('pair-origin-note').hidden = view.noteHidden;
  }

  function renderPair() {
    var card = $('pair-card');
    var info = state.pair;
    if (!info) { card.hidden = true; return; }
    card.hidden = false;
    var pin = info.pin || '';
    var input = $('pair-url-input');
    if (!state.pairEditing) input.value = info.url || suggestedUrl();
    var url = input.value.trim();
    $('pair-warn').hidden = !isPrivateHost(url);
    $('pair-current').textContent = info.url || '—';
    var tag = $('pair-source');
    var tagText = '';
    if (info.source === 'tunnel') tagText = '已自动检测到公网地址';
    else if (info.source === 'saved') tagText = info.pinned ? '你手动设置的（已固定）' : '你手动设置的';
    else if (info.source === 'origin') tagText = '当前页面地址';
    else if (info.source === 'lan') tagText = '局域网地址';
    tag.textContent = tagText;
    tag.hidden = tagText === '';
    $('pair-auto').hidden = info.pinned !== true;
    updateOriginButton();
    $('pair-pin').textContent = pin === '' ? '未设置' : (state.pinShown ? pin : '••••••');
    $('pair-eye').textContent = state.pinShown ? '隐藏' : '显示';
    $('pair-eye').hidden = pin === '';
    var code = $('pair-text');
    code.textContent = info.pair || '';
    code.style.display = info.pair ? 'block' : 'none';
    var hint = '手机 app 里粘贴这串即可自动填入地址和密码';
    if (pin === '') hint = '没读到 dsh-pocket 的密码（$DSH_HOME/dsh-pocket/token）：先在 dsh-pocket 里设好访问密码，配对串才能生成。';
    else if (!info.url) hint = '还不知道手机怎么访问这台电脑：手机通过 dsh-pocket 打开本页一次就会自动记住；也可以手动填上面的地址再保存。';
    $('pair-hint').textContent = hint;
  }

  function loadPair(forceRefresh) {
    return api('pair', { origin: pageOrigin(), refresh: forceRefresh === true }).then(function (data) {
      state.pair = data || null;
      renderPair();
    }).catch(function () {
      state.pair = null;
      renderPair();
    });
  }

  function saveLocalUrl(url, pinned) {
    return api('save-local-url', { url: url, pinned: pinned !== false }).then(function () {
      state.pairEditing = false;
      return loadPair(true);
    });
  }

  // 手机通过隧道打开本页时，把当前 origin 记住（核心：打开一次地址就对了）
  function captureOrigin() {
    var origin = pageOrigin();
    if (!origin || isLoopbackOrigin(origin)) return Promise.resolve(false);
    if (state.pair && state.pair.savedUrl === origin) return Promise.resolve(false);
    return saveLocalUrl(origin, false).then(function () { toast('已记住当前地址'); return true; }).catch(function () { return false; });
  }

  function copyPair() {
    var info = state.pair;
    if (!info || !info.pair) { toast('配对串还没生成：需要地址和密码都不为空'); return; }
    copyTo(info.pair, '已复制配对串', $('pair-text'));
  }

  function saveValue(value) {
    var button = $('pair-save');
    button.disabled = true;
    return saveLocalUrl(value).then(function () {
      toast('已保存');
    }).catch(function (err) {
      toast(err.message || '保存失败');
    }).then(function () {
      button.disabled = false;
    });
  }

  function readClipboardUrl() {
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
      toast('浏览器不让读剪贴板，请手动粘贴到上面的地址栏再点保存');
      return;
    }
    navigator.clipboard.readText().then(function (text) {
      var value = sanitizePastedUrl(text);
      if (!value) {
        toast('剪贴板里没有可用的地址，请手动粘贴');
        return;
      }
      $('pair-url-input').value = value;
      state.pairEditing = true;
      $('pair-warn').hidden = !isPrivateHost(value);
      if (!isWebUrl(value)) {
        toast('地址必须以 http:// 或 https:// 开头；桌面外壳的 dsh-app:// 不能用');
        return;
      }
      saveValue(value);
    }).catch(function () {
      toast('读不到剪贴板，请手动粘贴到上面的地址栏再点保存');
    });
  }

  function load() {
    return api('state').then(function (data) {
      state.instances = data.instances || [];
      state.local = data.local || null;
      hideNotice();
      render();
      captureOrigin().then(function (captured) {
        if (!captured) loadPair();
      });
    }).catch(function (err) {
      if (err.code === 'AUTH') {
        showAuthNotice();
        $('sub').textContent = '需要重新登录';
        return;
      }
      $('sub').textContent = '读取失败';
      toast(err.message || '读取失败');
    });
  }

  $('pair-url-input').addEventListener('focus', function () { state.pairEditing = true; });
  $('pair-url-input').addEventListener('input', function () {
    state.pairEditing = true;
    $('pair-warn').hidden = !isPrivateHost($('pair-url-input').value.trim());
  });
  $('pair-use-page').addEventListener('click', function () {
    if (!isWebOrigin(pageOrigin())) {
      toast('当前是桌面外壳，读不到网页地址，请手动粘贴公网地址');
      return;
    }
    var origin = pageOrigin();
    $('pair-url-input').value = origin;
    state.pairEditing = true;
    $('pair-warn').hidden = !isPrivateHost(origin);
  });
  $('pair-paste').addEventListener('click', readClipboardUrl);
  $('pair-detect').addEventListener('click', function () {
    var button = $('pair-detect');
    button.disabled = true;
    state.pairEditing = false;
    loadPair(true).then(function () { toast('已重新检测'); }).catch(function () {}).then(function () { button.disabled = false; });
  });
  $('pair-auto').addEventListener('click', function () {
    api('auto-local-url').then(function () {
      state.pairEditing = false;
      return loadPair(true);
    }).then(function () { toast('已恢复自动检测'); }).catch(function (err) { toast(err.message || '操作失败'); });
  });
  $('pair-save').addEventListener('click', function () {
    var value = sanitizePastedUrl($('pair-url-input').value) || $('pair-url-input').value.trim();
    if (!value) { toast('先填手机访问地址'); return; }
    if (!isWebUrl(value)) { toast('地址必须以 http:// 或 https:// 开头；桌面外壳的 dsh-app:// 不能用'); return; }
    saveValue(value);
  });
  updateOriginButton();
  $('pair-eye').addEventListener('click', function () { state.pinShown = !state.pinShown; renderPair(); });
  $('pair-copy').addEventListener('click', copyPair);
  $('pair-refresh').addEventListener('click', function () { loadPair().then(function () { toast('已刷新'); }); });
  $('btn-add').addEventListener('click', function () { openEditor(null); });
  $('btn-manage').addEventListener('click', function () {
    state.manage = !state.manage;
    render();
  });
  $('btn-transfer').addEventListener('click', openTransfer);
  $('btn-help').addEventListener('click', openHelp);
  load();
})();
</script>
</body>
</html>`;
