/*
 * 我的电脑 · 手机端页面。
 *
 * 零依赖、无打包、纯 DOM。上半部分是纯逻辑（配对串解析 / 机器列表增删改排序 /
 * 探测结果归类），不碰 DOM，底部通过 CommonJS 导出给 node 单测直接 require；
 * 下半部分才是页面渲染和事件绑定，只在浏览器里执行。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    root.DSHPS = api;
    if (root.document && typeof root.document.addEventListener === "function") {
      if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", api.boot);
      else api.boot();
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // 工厂函数是在全局作用域里创建的，拿不到 UMD 外层的 root 参数，这里自己再取一次
  var root = typeof globalThis !== "undefined" ? globalThis : this;

  var STORE_KEY = "dsh-phone-status.machines.v1";
  var PAIR_PREFIX = "DSHPAIR1.";
  var PROBE_INTERVAL_MS = 30000;
  var PROBE_TIMEOUT_MS = 5000;
  var B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  /* ================= 纯逻辑 ================= */

  function pairFail(code, message) {
    return { ok: false, code: code, message: message };
  }

  function base64Bytes(text) {
    var s = String(text == null ? "" : text)
      .replace(/\s+/g, "")
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .replace(/=+$/, "");
    var bytes = [];
    var buf = 0;
    var bits = 0;
    for (var i = 0; i < s.length; i += 1) {
      var value = B64_ALPHABET.indexOf(s.charAt(i));
      if (value < 0) throw new Error("bad-base64");
      buf = (buf << 6) | value;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buf >> bits) & 255);
      }
    }
    return bytes;
  }

  function utf8Text(bytes) {
    var out = "";
    var i = 0;
    while (i < bytes.length) {
      var b = bytes[i];
      i += 1;
      if (b < 0x80) {
        out += String.fromCharCode(b);
        continue;
      }
      var need;
      var code;
      if ((b & 0xe0) === 0xc0) { need = 1; code = b & 0x1f; }
      else if ((b & 0xf0) === 0xe0) { need = 2; code = b & 0x0f; }
      else if ((b & 0xf8) === 0xf0) { need = 3; code = b & 0x07; }
      else throw new Error("bad-utf8");
      if (i + need > bytes.length) throw new Error("bad-utf8");
      for (var k = 0; k < need; k += 1) {
        var next = bytes[i];
        i += 1;
        if ((next & 0xc0) !== 0x80) throw new Error("bad-utf8");
        code = (code << 6) | (next & 0x3f);
      }
      out += String.fromCodePoint(code);
    }
    return out;
  }

  function normalizeHost(input) {
    var s = String(input == null ? "" : input).trim();
    if (!s) return "";
    s = s.replace(/[\s\u0000-\u001f]/g, "");
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^\/\//, "");
    s = s.replace(/^[^/@]*@/, "");
    s = s.split(/[/?#]/)[0];
    s = s.replace(/\.+$/, "");
    return s.slice(0, 255);
  }

  function validHost(host) {
    return typeof host === "string" && host.length > 0 && /^[A-Za-z0-9._~:\-\[\]%]+$/.test(host) && /[A-Za-z0-9]/.test(host);
  }

  /**
   * 解析配对串 DSHPAIR1.<base64url JSON {v,name,url,pin}>。
   * 宽容处理：前面带说明文字、后面带多余内容、base64/base64url 混用、data: 前缀。
   */
  function parsePair(raw) {
    var text = String(raw == null ? "" : raw);
    var at = text.toUpperCase().indexOf(PAIR_PREFIX);
    if (at < 0) return pairFail("no-prefix", "没找到配对串前缀 DSHPAIR1.");
    var rest = text.slice(at + PAIR_PREFIX.length).replace(/^[\s"':：,]+/, "");
    rest = rest.replace(/^data:[^,]*;base64,/i, "").replace(/^base64,/i, "");
    var match = /^[A-Za-z0-9\-_+/=]+/.exec(rest);
    if (!match) return pairFail("empty", "配对串后面没有内容。");
    var payload;
    try {
      payload = utf8Text(base64Bytes(match[0]));
    } catch (decodeError) {
      return pairFail("bad-base64", "配对串内容不是有效的 base64。");
    }
    var start = payload.indexOf("{");
    var end = payload.lastIndexOf("}");
    if (start < 0 || end <= start) return pairFail("bad-json", "配对串里没有识别到 JSON。");
    var data;
    try {
      data = JSON.parse(payload.slice(start, end + 1));
    } catch (jsonError) {
      return pairFail("bad-json", "配对串里的 JSON 解析失败。");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return pairFail("bad-json", "配对串内容不是对象。");

    // url 兼容 host/address：电脑端写 url，手写粘贴可能只给主机名
    var host = normalizeHost(data.url || data.host || data.address);
    var pin = String(data.pin == null ? "" : data.pin).trim();
    var name = String(data.name == null ? "" : data.name).trim().slice(0, 40);
    var missing = [];
    if (!validHost(host)) missing.push("地址");
    if (!pin) missing.push("密码");
    if (missing.length) return pairFail("incomplete", "配对串缺少" + missing.join("和") + "。");
    var version = Number(data.v);
    return {
      ok: true,
      code: "ok",
      value: { v: Number.isFinite(version) && version > 0 ? version : 1, name: name, host: host, pin: pin }
    };
  }

  var idSeed = 0;
  function uid() {
    idSeed += 1;
    return "m" + Date.now().toString(36) + idSeed.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function makeMachine(input) {
    var src = input && typeof input === "object" ? input : {};
    var host = normalizeHost(src.host || src.url);
    var pin = String(src.pin == null ? "" : src.pin).trim();
    var name = String(src.name == null ? "" : src.name).trim().slice(0, 40);
    return {
      id: typeof src.id === "string" && src.id ? src.id : uid(),
      name: name || host,
      host: host,
      pin: pin,
      addedAt: Number(src.addedAt) > 0 ? Number(src.addedAt) : Date.now()
    };
  }

  function indexById(list, id) {
    for (var i = 0; i < (list || []).length; i += 1) {
      if (list[i] && list[i].id === id) return i;
    }
    return -1;
  }

  function findMachine(list, id) {
    var at = indexById(list, id);
    return at < 0 ? null : list[at];
  }

  /** 同 host 视为同一台电脑：覆盖名字/密码，保留位置和 id。 */
  function addMachine(list, input) {
    var items = (list || []).slice();
    var m = makeMachine(input);
    if (!validHost(m.host) || !m.pin) return { ok: false, code: "incomplete", list: items };
    var hostKey = m.host.toLowerCase();
    for (var i = 0; i < items.length; i += 1) {
      if (items[i] && String(items[i].host).toLowerCase() === hostKey) {
        items[i] = { id: items[i].id, name: m.name, host: m.host, pin: m.pin, addedAt: items[i].addedAt };
        return { ok: true, replaced: true, index: i, list: items };
      }
    }
    items.push(m);
    return { ok: true, replaced: false, index: items.length - 1, list: items };
  }

  function removeMachine(list, id) {
    var items = (list || []).slice();
    var at = indexById(items, id);
    if (at < 0) return { list: items, removed: false };
    items.splice(at, 1);
    return { list: items, removed: true };
  }

  function renameMachine(list, id, name) {
    var items = (list || []).slice();
    var at = indexById(items, id);
    var next = String(name == null ? "" : name).trim().slice(0, 40);
    if (at < 0 || !next) return { list: items, ok: false };
    items[at] = { id: items[at].id, name: next, host: items[at].host, pin: items[at].pin, addedAt: items[at].addedAt };
    return { list: items, ok: true };
  }

  function moveMachine(list, id, delta) {
    var items = (list || []).slice();
    var at = indexById(items, id);
    var to = at + (delta < 0 ? -1 : 1);
    if (at < 0 || to < 0 || to >= items.length) return { list: items, moved: false };
    var tmp = items[at];
    items[at] = items[to];
    items[to] = tmp;
    return { list: items, moved: true };
  }

  function cleanMachine(m, keepPin) {
    var out = { id: m.id, name: m.name, host: m.host, addedAt: m.addedAt };
    if (keepPin && typeof m.pin === "string" && m.pin) out.pin = m.pin;
    return out;
  }

  /** 去掉密码的机器列表（「记住密码」关着时落盘用）。 */
  function stripPins(items) {
    return (items || []).map(function (m) { return cleanMachine(m, false); });
  }

  /** 把内存里的密码合回机器列表（开「记住密码」时用）。 */
  function withPins(items, pins) {
    return (items || []).map(function (m) {
      var out = cleanMachine(m, false);
      var pin = pinOf(m, pins);
      if (pin) out.pin = pin;
      return out;
    });
  }

  /** 这台机器的密码：机器记录里有就用它，否则看内存表（默认模式只走内存）。 */
  function pinOf(machine, pins) {
    if (!machine) return "";
    if (typeof machine.pin === "string" && machine.pin) return machine.pin;
    var map = pins && typeof pins === "object" ? pins : {};
    return typeof map[machine.id] === "string" ? map[machine.id] : "";
  }

  /**
   * localStorage 里存 {v:1, rememberPins, items:[], currentId}。
   * 默认不存密码：rememberPins 不是 true 时，读到的 pin 一律丢掉（老版本存过的明文也会被清掉）。
   * 坏数据一律当空列表，不让页面白屏。
   */
  function parseStore(raw) {
    var empty = { v: 1, items: [], currentId: null, rememberPins: false };
    if (!raw) return empty;
    var data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      return empty;
    }
    if (!data || typeof data !== "object") return empty;
    var legacyArray = Array.isArray(data);
    var remember = !legacyArray && data.rememberPins === true;
    var source = legacyArray ? data : data.items;
    var items = [];
    (Array.isArray(source) ? source : []).forEach(function (record) {
      if (!record || typeof record !== "object") return;
      var m = makeMachine(record);
      if (!validHost(m.host)) return;
      if (indexById(items, m.id) >= 0) return;
      items.push(m);
    });
    if (!remember) items = stripPins(items);
    var currentId = !legacyArray && typeof data.currentId === "string" ? data.currentId : null;
    if (currentId && indexById(items, currentId) < 0) currentId = null;
    if (!currentId && items.length) currentId = items[0].id;
    return { v: 1, items: items, currentId: currentId, rememberPins: remember };
  }

  function serializeStore(state) {
    var source = state && typeof state === "object" ? state : {};
    var remember = source.rememberPins === true;
    var items = Array.isArray(source.items) ? source.items : [];
    return JSON.stringify({
      v: 1,
      rememberPins: remember,
      items: remember ? withPins(items, source.pins) : stripPins(items),
      currentId: typeof source.currentId === "string" ? source.currentId : null
    });
  }

  /**
   * 探测归类：fetch 成功（no-cors 下是 opaque 响应）算在线；
   * 5 秒超时（AbortError）和网络错误都算离线，只是原因分开存，方便文案区分。
   * 注意：这只说明地址连得上，不是安全判断。
   */
  function classifyProbe(result) {
    if (result && result.ok === true) return { state: "online", reason: "ok" };
    var name = result && result.name ? String(result.name) : "";
    if (name === "AbortError" || (result && result.timeout === true)) return { state: "offline", reason: "timeout" };
    return { state: "offline", reason: "network" };
  }

  /* ================= 页面逻辑 ================= */

  var app = { items: [], currentId: null, rememberPins: false };
  var memoryPins = {}; // 只在内存里的密码（默认模式刷新即失效）
  var probeState = {};
  var revealed = true;
  var fallbackFor = null;
  var probingRound = false;
  var booted = false;
  var toastTimer = null;
  var modalState = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function currentMachine() {
    return findMachine(app.items, app.currentId);
  }

  function isMobile() {
    return !!(root.matchMedia && root.matchMedia("(max-width:780px)").matches);
  }

  function toast(text) {
    var el = byId("toast");
    if (!el) return;
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 1600);
  }

  function readStore() {
    try {
      return parseStore(root.localStorage.getItem(STORE_KEY));
    } catch (error) {
      return parseStore(null);
    }
  }

  function writeStore() {
    try {
      root.localStorage.setItem(STORE_KEY, serializeStore({
        items: app.items,
        currentId: app.currentId,
        rememberPins: app.rememberPins,
        pins: memoryPins
      }));
    } catch (error) {
      /* 隐私模式/配额满：内存里照常用，不弹错 */
    }
  }

  function machinePin(machine) {
    return pinOf(machine, memoryPins);
  }

  function setMachinePin(id, pin) {
    var value = String(pin == null ? "" : pin).trim();
    if (!value) return;
    memoryPins[id] = value;
    app.items = app.items.map(function (m) {
      return m.id === id ? Object.assign({}, m, { pin: value }) : m;
    });
    writeStore();
    renderAll();
  }

  function focusPinInput() {
    setTimeout(function () {
      var input = byId("pinInput");
      if (input && typeof input.focus === "function") input.focus();
    }, 60);
  }

  function copyText(text) {
    var value = String(text == null ? "" : text);
    var clip = root.navigator && root.navigator.clipboard;
    if (clip && typeof clip.writeText === "function") {
      return clip.writeText(value).then(function () { return true; }, function () { return legacyCopy(value); });
    }
    return Promise.resolve(legacyCopy(value));
  }

  // 非 https / 老浏览器没有 clipboard API 时兜底
  function legacyCopy(value) {
    try {
      var area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "-1000px";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, area.value.length);
      var ok = !!(document.execCommand && document.execCommand("copy"));
      document.body.removeChild(area);
      return ok;
    } catch (error) {
      return false;
    }
  }

  function formatSeen(at) {
    var diff = Date.now() - at;
    if (diff < 45000) return "刚刚";
    if (diff < 3600000) return Math.max(1, Math.round(diff / 60000)) + " 分钟前";
    var d = new Date(at);
    var now = new Date();
    var hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
    if (d.toDateString() === now.toDateString()) return hm;
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 " + hm;
  }

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function dotClass(machine) {
    var ps = probeState[machine.id] || {};
    if (ps.probing) return "probing";
    if (ps.status === "online") return "on";
    if (ps.status === "offline") return "off";
    return "";
  }

  function statusText(machine) {
    var ps = probeState[machine.id] || {};
    if (ps.probing) return "正在检测…";
    if (ps.status === "online") return "在线";
    if (ps.status === "offline") return ps.reason === "timeout" ? "连不上 · 超时" : "连不上";
    return "还没检测";
  }

  /* ---------- 渲染 ---------- */

  var ARROW_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 17L17 7M17 7H9M17 7v8"/></svg>';
  var EYE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>';
  var COPY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M6.5 15H5.5A1.5 1.5 0 0 1 4 13.5v-8A1.5 1.5 0 0 1 5.5 4h8A1.5 1.5 0 0 1 15 5.5v1"/></svg>';

  function renderConns() {
    var box = byId("conns");
    if (!app.items.length) {
      box.innerHTML = '<div class="conns-empty"><p>还没有连接</p><p class="sub">点下面「＋ 添加连接」，把电脑上的配对串粘进来。</p></div>';
    } else {
      box.innerHTML = app.items.map(function (m) {
        return '<button class="conn' + (m.id === app.currentId ? " active" : "") + '" type="button" data-pick="' + esc(m.id) + '">' +
          '<div class="txt"><div class="n">' + esc(m.name) + '</div><div class="h">' + esc(m.host) + '</div></div>' +
          '<span class="dot ' + dotClass(m) + '"></span></button>';
      }).join("");
    }
    var online = app.items.filter(function (m) {
      var ps = probeState[m.id];
      return ps && ps.status === "online";
    }).length;
    byId("count").textContent = app.items.length ? app.items.length + " 台 · " + online + " 在线" : "0 台";
  }

  function renderPane() {
    var body = byId("body");
    var m = currentMachine();
    if (!m) {
      byId("title").textContent = "我的电脑";
      body.innerHTML =
        '<div class="empty">' +
          '<svg class="fish big" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="fish-empty" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb457"/><stop offset="1" stop-color="#ff8a3d"/></linearGradient></defs>' +
            '<path d="M12 32c0-8.5 8-15 19-15s19 6.5 19 15-8 15-19 15-19-6.5-19-15z" fill="url(#fish-empty)"/>' +
            '<path d="M50 32l9-8v16l-9-8z" fill="#ff8a3d"/>' +
            '<circle cx="24" cy="29" r="2.6" fill="#3b2415"/>' +
            '<path d="M21 38c2.5 2 6 2 8.5 0" stroke="#3b2415" stroke-width="2" stroke-linecap="round" fill="none"/>' +
          '</svg>' +
          '<h2>还没有连接</h2>' +
          '<p>在电脑的 DSH 设置里打开「手机访问」，复制配对串，粘到这里就能用。</p>' +
          '<button class="go" type="button" data-act="add">粘贴配对串</button>' +
        '</div>';
      return;
    }

    // 探测每 30 秒会重渲染一次，别把用户正在粘的密码冲掉
    var oldInput = byId("pinInput");
    var typedPin = oldInput ? oldInput.value : "";
    var keepFocus = !!(oldInput && document.activeElement === oldInput);

    byId("title").textContent = m.name;
    var ps = probeState[m.id] || {};
    var seen = ps.at ? " · 上次检测 " + formatSeen(ps.at) : "";
    var pin = machinePin(m);
    var pinText = revealed ? esc(pin) : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
    body.innerHTML =
      '<div class="status"><span class="dot ' + dotClass(m) + '"></span>' + esc(statusText(m) + seen) + '</div>' +
      '<div class="field">' +
        '<div class="label">公网地址</div>' +
        '<div class="val">https://' + esc(m.host) + '</div>' +
      '</div>' +
      '<div class="field">' +
        '<div class="label">访问密码</div>' +
        (pin
          ? '<div class="pinrow">' +
              '<div class="pinval">' + pinText + '</div>' +
              '<button class="iconbtn" type="button" data-act="reveal" aria-label="显示或隐藏密码">' + EYE_SVG + '</button>' +
              '<button class="iconbtn" type="button" data-act="copy" aria-label="复制密码">' + COPY_SVG + '</button>' +
            '</div>'
          : '<div class="pinrow">' +
              '<input class="input mono pin-input" id="pinInput" type="text" autocapitalize="off" autocomplete="off" spellcheck="false" aria-label="访问密码" placeholder="粘一下这台电脑的密码">' +
              '<button class="pin-save" type="button" data-act="savepin">用</button>' +
            '</div>' +
            '<p class="note tight">' + (app.rememberPins
              ? "粘完会存到这台手机上（记住密码开着）。"
              : "密码只放在这个页面里，刷新就没了。") + '</p>') +
        '<div class="switch-row">' +
          '<button class="switch" type="button" role="switch" aria-checked="' + (app.rememberPins ? "true" : "false") + '" data-act="toggle-remember" aria-label="记住密码"><span></span></button>' +
          '<div class="switch-text"><b>记住密码</b>' + (app.rememberPins
            ? "开着：密码明文存在这个浏览器里。"
            : "默认关。开了才会把密码存到这个浏览器里。") + '</div>' +
        '</div>' +
      '</div>' +
      '<button class="go" type="button" data-act="go">进入这台电脑' + ARROW_SVG + '</button>' +
      '<div class="fallback" id="fallback"' + (fallbackFor === m.id ? "" : " hidden") + '>' +
        '<a href="https://' + esc(m.host) + '" target="_blank" rel="noopener noreferrer">浏览器拦了弹窗？点这里手动打开 ↗</a>' +
      '</div>' +
      '<div class="note">点左边连接或点「进入」都会把密码复制到剪贴板，在登录页直接粘贴即可。</div>' +
      '<div class="field manage">' +
        '<div class="label">管理</div>' +
        '<div class="manage-row">' +
          '<button class="ghost" type="button" data-act="rename">改名</button>' +
          '<button class="ghost" type="button" data-act="up">上移</button>' +
          '<button class="ghost" type="button" data-act="down">下移</button>' +
          '<button class="ghost danger" type="button" data-act="delete">删除</button>' +
          '<button class="ghost danger" type="button" data-act="clear-all">清除所有配对</button>' +
        '</div>' +
        '<p class="note tight">状态灯只说明「这个地址连不连得上」，不是安全判断。清除只删手机这边的记录；想让旧手机真的连不上，得去那台电脑的 dsh-pocket 设置里换密码。</p>' +
      '</div>';

    var nextInput = byId("pinInput");
    if (nextInput) {
      if (typedPin) nextInput.value = typedPin;
      if (keepFocus && typeof nextInput.focus === "function") nextInput.focus();
    }
  }

  function renderAll() {
    renderConns();
    renderPane();
  }

  /* ---------- 探测 ---------- */

  function requestProbe(host) {
    if (typeof root.fetch !== "function" || typeof root.AbortController !== "function") {
      return Promise.resolve({ ok: false, name: "Unsupported" });
    }
    var controller = new root.AbortController();
    var timer = setTimeout(function () {
      try { controller.abort(); } catch (error) { /* 忽略 */ }
    }, PROBE_TIMEOUT_MS);
    return root.fetch("https://" + host, { mode: "no-cors", cache: "no-store", signal: controller.signal })
      .then(function () { return { ok: true }; })
      .catch(function (error) {
        return { ok: false, name: (error && error.name) || "Error", timeout: controller.signal.aborted };
      })
      .then(function (result) {
        clearTimeout(timer);
        return result;
      });
  }

  function probeOne(id) {
    var m = findMachine(app.items, id);
    if (!m || !m.host) return Promise.resolve(null);
    var ps = probeState[id] || (probeState[id] = {});
    ps.probing = true;
    renderAll();
    return requestProbe(m.host).then(function (result) {
      var verdict = classifyProbe(result);
      ps.probing = false;
      ps.status = verdict.state;
      ps.reason = verdict.reason;
      ps.at = Date.now();
      renderAll();
      return verdict;
    });
  }

  function probeAll() {
    if (probingRound || !app.items.length) return Promise.resolve();
    probingRound = true;
    var jobs = app.items.map(function (m) { return probeOne(m.id); });
    return Promise.all(jobs).then(function () { probingRound = false; }, function () { probingRound = false; });
  }

  /* ---------- 侧边栏 ---------- */

  function openSide() {
    var side = byId("side");
    side.classList.add("open");
    side.classList.remove("collapsed");
    byId("scrim").classList.add("show");
    byId("fab").classList.remove("show");
  }

  function closeSide() {
    var side = byId("side");
    side.classList.remove("open");
    byId("scrim").classList.remove("show");
    if (isMobile()) byId("fab").classList.add("show");
  }

  function toggleSide() {
    if (isMobile()) {
      if (byId("side").classList.contains("open")) closeSide();
      else openSide();
      return;
    }
    var collapsed = byId("side").classList.toggle("collapsed");
    byId("fab").classList.toggle("show", collapsed);
  }

  /* ---------- 交互 ---------- */

  function pickMachine(id) {
    var m = findMachine(app.items, id);
    if (!m) return;
    app.currentId = m.id;
    fallbackFor = null;
    writeStore();
    renderAll();
    if (isMobile()) closeSide();
    // 点开时顺手刷一次在线状态，比等 30 秒轮询更跟手
    probeOne(m.id);
    var pin = machinePin(m);
    if (!pin) {
      toast("先粘一下密码 · " + m.name);
      focusPinInput();
      return;
    }
    copyText(pin).then(function (ok) {
      toast(ok ? "已填入 · " + m.name : "复制失败，请手动复制 · " + m.name);
    });
  }

  function copyCurrentPin() {
    var m = currentMachine();
    if (!m) return;
    var pin = machinePin(m);
    if (!pin) {
      toast("先粘一下密码");
      focusPinInput();
      return;
    }
    copyText(pin).then(function (ok) {
      toast(ok ? "密码已复制" : "复制失败，请手动选择密码复制");
    });
  }

  function enterMachine() {
    var m = currentMachine();
    if (!m) return;
    var pin = machinePin(m);
    if (!pin) {
      toast("先粘一下密码再进");
      focusPinInput();
      return;
    }
    var url = "https://" + m.host;
    copyText(pin).then(function (ok) {
      if (!ok) {
        fallbackFor = m.id;
        renderPane();
        toast("密码没复制成功，先手动复制再打开");
        return;
      }
      var win = null;
      try {
        // 不传 noopener：带了它 window.open 永远返回 null，就没法识别被拦截
        win = root.open(url, "_blank");
      } catch (error) {
        win = null;
      }
      if (!win) {
        fallbackFor = m.id;
        renderPane();
        toast("浏览器拦了弹窗，点下面的备用链接");
        return;
      }
      try { win.opener = null; } catch (error) { /* 跨域时忽略 */ }
      toast("已复制密码 · 正在打开…");
    });
  }

  function openRename() {
    var m = currentMachine();
    if (!m) return;
    showModal({
      title: "改名",
      input: m.name,
      confirmText: "保存",
      onConfirm: function (value) {
        var result = renameMachine(app.items, m.id, value);
        if (!result.ok) {
          toast("名字不能为空");
          return;
        }
        app.items = result.list;
        writeStore();
        renderAll();
        toast("改好了 · " + value.trim());
      }
    });
  }

  function moveCurrent(delta) {
    var m = currentMachine();
    if (!m) return;
    var result = moveMachine(app.items, m.id, delta);
    if (!result.moved) {
      toast(delta < 0 ? "已经在最上面了" : "已经在最下面了");
      return;
    }
    app.items = result.list;
    writeStore();
    renderAll();
  }

  function openDelete() {
    var m = currentMachine();
    if (!m) return;
    showModal({
      title: "删除「" + m.name + "」？",
      body: "只是从这台手机上删掉记录，不会影响电脑。",
      confirmText: "删除",
      danger: true,
      onConfirm: function () {
        var result = removeMachine(app.items, m.id);
        delete memoryPins[m.id];
        app.items = result.list;
        if (app.currentId === m.id) app.currentId = app.items.length ? app.items[0].id : null;
        fallbackFor = null;
        writeStore();
        renderAll();
        toast("已删除 · " + m.name);
      }
    });
  }

  function saveTypedPin() {
    var m = currentMachine();
    var input = byId("pinInput");
    if (!m || !input) return;
    var value = input.value.trim();
    if (!value) {
      toast("先粘一下密码");
      input.focus();
      return;
    }
    setMachinePin(m.id, value);
    toast(app.rememberPins ? "密码已记住" : "密码只在本次页面有效");
  }

  function openRemember() {
    showModal({
      title: "记住密码？",
      body: "开了以后，密码会明文存在这个浏览器里。别人拿这台手机打开这个页面就能看到。确定要记住吗？",
      confirmText: "记住",
      onConfirm: function () {
        app.rememberPins = true;
        app.items = withPins(app.items, memoryPins);
        writeStore();
        renderAll();
        toast("已开启记住密码");
      }
    });
  }

  function turnOffRemember() {
    // 关掉时把已经存着的密码挪到内存，本次页面还能用，刷新就没了
    app.items.forEach(function (m) {
      if (typeof m.pin === "string" && m.pin && !memoryPins[m.id]) memoryPins[m.id] = m.pin;
    });
    app.items = stripPins(app.items);
    app.rememberPins = false;
    writeStore();
    renderAll();
    toast("已关闭，密码不再保存");
  }

  function onToggleRemember() {
    if (app.rememberPins) turnOffRemember();
    else openRemember();
  }

  function openClearAll() {
    showModal({
      title: "清除本机所有配对？",
      body: "会删掉这台手机上保存的所有电脑和密码。注意：这不等于让对方失效——要让旧手机真的连不上，得去那台电脑的 dsh-pocket 设置里换密码，我们这边删不掉对方的授权。",
      confirmText: "全部清除",
      danger: true,
      onConfirm: function () {
        app.items = [];
        app.currentId = null;
        app.rememberPins = false;
        memoryPins = {};
        fallbackFor = null;
        writeStore();
        renderAll();
        toast("已清除所有配对");
      }
    });
  }

  function handleAction(action) {
    if (action === "add") openSheet();
    else if (action === "go") enterMachine();
    else if (action === "reveal") { revealed = !revealed; renderPane(); }
    else if (action === "copy") copyCurrentPin();
    else if (action === "savepin") saveTypedPin();
    else if (action === "toggle-remember") onToggleRemember();
    else if (action === "rename") openRename();
    else if (action === "up") moveCurrent(-1);
    else if (action === "down") moveCurrent(1);
    else if (action === "delete") openDelete();
    else if (action === "clear-all") openClearAll();
  }

  /* ---------- 添加连接抽屉 ---------- */

  var PAIR_HINT = "在电脑的 DSH 设置 →「手机访问」里复制配对串，粘上来会自动识别。";

  function openSheet() {
    byId("pairInput").value = "";
    byId("fName").value = "";
    byId("fHost").value = "";
    byId("fPin").value = "";
    setHint(PAIR_HINT, "");
    var wrap = byId("sheetWrap");
    wrap.classList.add("show");
    wrap.setAttribute("aria-hidden", "false");
    setTimeout(function () {
      var input = byId("pairInput");
      if (input && typeof input.focus === "function") input.focus();
    }, 120);
  }

  function closeSheet() {
    var wrap = byId("sheetWrap");
    wrap.classList.remove("show");
    wrap.setAttribute("aria-hidden", "true");
  }

  function setHint(text, tone) {
    var hint = byId("pairHint");
    hint.textContent = text;
    hint.className = tone ? "hint " + tone : "hint";
  }

  function onPairInput() {
    var raw = byId("pairInput").value.trim();
    if (!raw) {
      setHint(PAIR_HINT, "");
      return;
    }
    var result = parsePair(raw);
    if (!result.ok) {
      setHint(result.message + " 也可以直接手填下面三项。", "bad");
      return;
    }
    byId("fName").value = result.value.name;
    byId("fHost").value = result.value.host;
    byId("fPin").value = result.value.pin;
    setHint("识别到：" + (result.value.name || result.value.host) + " · " + result.value.host, "good");
  }

  function useCurrentOrigin() {
    var host = normalizeHost(root.location && root.location.origin);
    if (!validHost(host)) {
      toast("拿不到当前地址");
      return;
    }
    byId("fHost").value = host;
    if (!byId("fName").value.trim()) byId("fName").value = "这台电脑";
    setHint("用的是当前页面的地址：" + host, "good");
  }

  function saveSheet() {
    var host = normalizeHost(byId("fHost").value);
    var pin = byId("fPin").value.trim();
    var name = byId("fName").value.trim();
    if (!validHost(host)) {
      setHint("地址不对，填个能打开的地址，比如 xxx.trycloudflare.com。", "bad");
      return;
    }
    if (!pin) {
      setHint("密码没填。", "bad");
      return;
    }
    var result = addMachine(app.items, { name: name, host: host, pin: pin });
    if (!result.ok) {
      setHint("保存失败：地址或密码为空。", "bad");
      return;
    }
    app.items = result.list;
    var saved = result.list[result.index];
    app.currentId = saved.id;
    fallbackFor = null;
    writeStore();
    closeSheet();
    renderAll();
    toast((result.replaced ? "已更新 · " : "已添加 · ") + saved.name);
    probeOne(saved.id);
  }

  /* ---------- 小对话框 ---------- */

  function showModal(options) {
    modalState = options;
    var box = byId("modalBox");
    box.innerHTML =
      "<h2>" + esc(options.title) + "</h2>" +
      (options.body ? "<p>" + esc(options.body) + "</p>" : "") +
      (options.input != null
        ? '<input class="input" id="modalInput" type="text" maxlength="40" autocomplete="off" value="' + esc(options.input) + '">'
        : "") +
      '<div class="modal-foot">' +
        '<button class="btn ghost" type="button" data-close="modal">取消</button>' +
        '<button class="btn' + (options.danger ? " danger" : "") + '" type="button" id="modalOk">' + esc(options.confirmText || "好") + "</button>" +
      "</div>";
    byId("modalWrap").classList.add("show");
    var input = byId("modalInput");
    if (input) {
      input.focus();
      if (typeof input.select === "function") input.select();
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          confirmModal();
        }
      });
    }
    byId("modalOk").addEventListener("click", confirmModal);
  }

  function confirmModal() {
    var options = modalState;
    if (!options) return;
    var input = byId("modalInput");
    var value = input ? input.value.trim() : "";
    closeModal();
    if (typeof options.onConfirm === "function") options.onConfirm(value);
  }

  function closeModal() {
    byId("modalWrap").classList.remove("show");
    modalState = null;
  }

  /* ---------- 事件 ---------- */

  function onDocumentClick(event) {
    var target = event.target;
    var hit = target && typeof target.closest === "function"
      ? target.closest("[data-pick],[data-act],[data-close]")
      : null;
    if (!hit) return;
    if (hit.hasAttribute("data-pick")) {
      pickMachine(hit.getAttribute("data-pick"));
      return;
    }
    if (hit.hasAttribute("data-close")) {
      if (hit.getAttribute("data-close") === "modal") closeModal();
      else closeSheet();
      return;
    }
    handleAction(hit.getAttribute("data-act"));
  }

  function onKeyDown(event) {
    if (event.key === "Enter" && event.target && event.target.id === "pinInput") {
      event.preventDefault();
      saveTypedPin();
      return;
    }
    if (event.key !== "Escape") return;
    if (byId("modalWrap").classList.contains("show")) closeModal();
    else if (byId("sheetWrap").classList.contains("show")) closeSheet();
  }

  function onResize() {
    byId("fab").classList.remove("show");
    if (!isMobile()) {
      byId("side").classList.remove("open");
      byId("scrim").classList.remove("show");
    } else if (!byId("side").classList.contains("open")) {
      byId("fab").classList.add("show");
    }
  }

  function bind() {
    byId("toggle").addEventListener("click", toggleSide);
    byId("fab").addEventListener("click", function () {
      if (isMobile()) openSide();
      else toggleSide();
    });
    byId("scrim").addEventListener("click", closeSide);
    byId("addBtn").addEventListener("click", openSheet);
    byId("sheetSave").addEventListener("click", saveSheet);
    byId("pairInput").addEventListener("input", onPairInput);
    byId("useCurrent").addEventListener("click", useCurrentOrigin);
    byId("sheetWrap").addEventListener("click", function (event) {
      if (event.target === byId("sheetWrap")) closeSheet();
    });
    byId("modalWrap").addEventListener("click", function (event) {
      if (event.target === byId("modalWrap")) closeModal();
    });
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onKeyDown);
    root.addEventListener("resize", onResize);
  }

  /* ---------- 启动 ---------- */

  function boot() {
    if (booted) return;
    booted = true;
    var loaded = readStore();
    app.items = loaded.items;
    app.currentId = loaded.currentId;
    app.rememberPins = loaded.rememberPins;
    // 立刻回写一次：默认模式下把老版本存过的明文密码当场清掉
    writeStore();
    bind();
    renderAll();
    if (isMobile() && !byId("side").classList.contains("open")) byId("fab").classList.add("show");
    if (app.items.length) probeAll();
    setInterval(function () { probeAll(); }, PROBE_INTERVAL_MS);
    // 手机切回前台时顺手刷新，别显示半小时前的状态
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) probeAll();
    });
  }

  return {
    STORE_KEY: STORE_KEY,
    PAIR_PREFIX: PAIR_PREFIX,
    PROBE_INTERVAL_MS: PROBE_INTERVAL_MS,
    PROBE_TIMEOUT_MS: PROBE_TIMEOUT_MS,
    parsePair: parsePair,
    normalizeHost: normalizeHost,
    validHost: validHost,
    makeMachine: makeMachine,
    addMachine: addMachine,
    removeMachine: removeMachine,
    renameMachine: renameMachine,
    moveMachine: moveMachine,
    findMachine: findMachine,
    parseStore: parseStore,
    serializeStore: serializeStore,
    pinOf: pinOf,
    stripPins: stripPins,
    withPins: withPins,
    classifyProbe: classifyProbe,
    boot: boot
  };
});
