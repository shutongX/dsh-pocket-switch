// dsh-pocket-switch —— host 半。
// 作用：把「多台电脑的 dsh-pocket 地址 + 密码」存本机，并提供一个手机优先的切换页。
// 设计取舍：
//   - 页面自己写（不塞进 DSH 的 React 界面）→ 能当独立手机 App 用，DSH 升级不牵连；
//   - 密码只走本插件已登录的 API（和 dsh-pocket 设置页同一把信任锁）；
//   - 读 dsh-pocket 的文件只为了「自动填入本机」，读不到就退回手填，不硬依赖。
import { renderIcon } from './icon.js';
import { PAGE_HTML, PAGE_PATH, API_PATH } from './page.js';
import { buildPairInfo, detectLanPairUrl, detectPublicUrl, normalizeManualUrl, readPairPinned, writePairPinned } from './pairing.js';
import {
  MAX_INSTANCES,
  exportPayload,
  localInfo,
  localRecordUrl,
  normalizeInstance,
  saveLocalUrl,
  parseImport,
  readState,
  resolveDshHome,
  withStore,
} from './store.js';

export const name = 'dsh-pocket-switch';
export const inject = ['webServer'];

const PLUGIN_VERSION = '0.1.0';
const ROUTE = '/dsh-pocket-switch';
const BODY_LIMIT = 1024 * 1024;
const ICONS = { 180: 'icon-180.png', 192: 'icon-192.png', 512: 'icon-512.png' };

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), { 'content-type': 'application/json; charset=utf-8' });
}

function sendPng(res, size) {
  const png = renderIcon(size);
  send(res, 200, png, {
    'content-type': 'image/png',
    'content-length': String(png.length),
    'cache-control': 'public, max-age=604800, immutable',
  });
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new Error('请求体太大');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

/**
 * 请求是否已经被 DSH 的浏览器会话认证过。
 * 注意：手机经过 dsh-pocket 代理进来时 socket 永远是 127.0.0.1，所以绝不能用来源 IP 判权限。
 */
function authorize(ctx, req) {
  const connection = ctx.get('connection');
  if (connection && typeof connection.requestRejection === 'function') {
    try {
      const rejection = connection.requestRejection(req);
      if (rejection !== undefined) return rejection;
      return undefined;
    } catch {
      return 403;
    }
  }
  // 老版本 DSH 没有 connection.requestRejection：只放行本机回环 Host（和 dsh-pocket 的兜底同款）
  const host = String(req.headers?.host ?? '').split(':')[0].toLowerCase();
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  return loopback ? undefined : 403;
}

function manifest() {
  return {
    name: '换电脑',
    short_name: '换电脑',
    description: '在多台电脑的 DSH 之间切换',
    start_url: PAGE_PATH,
    scope: PAGE_PATH,
    display: 'standalone',
    background_color: '#f4f5f8',
    theme_color: '#4f6ef7',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}

async function handleApi(ctx, req, res) {
  const rejection = authorize(ctx, req);
  if (rejection !== undefined) {
    send(res, rejection, rejection === 401 ? 'unauthorized' : 'forbidden', { 'content-type': 'text/plain; charset=utf-8' });
    return;
  }
  if (req.method !== 'POST') {
    send(res, 405, 'method not allowed', { 'content-type': 'text/plain; charset=utf-8' });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }
  const action = typeof body.action === 'string' ? body.action : '';
  try {
    if (action === 'state') {
      const state = await readState();
      sendJson(res, 200, {
        ok: true,
        version: PLUGIN_VERSION,
        page: PAGE_PATH,
        instances: state.instances,
        local: localInfo(),
        export: exportPayload(state),
      });
      return;
    }
    if (action === 'local') {
      sendJson(res, 200, { ok: true, local: localInfo() });
      return;
    }
    if (action === 'pair') {
      // 手机 app 粘贴这串就能自动填地址 + 密码。
      // url：pinned 保存地址 → cloudflared 自动检测 → store 保存地址 → 页面 origin → 局域网
      const home = resolveDshHome();
      const info = await buildPairInfo({
        home,
        savedUrl: await localRecordUrl(),
        origin: typeof body.origin === 'string' ? body.origin : '',
        lanUrl: await detectLanPairUrl(home),
        tunnelUrl: await detectPublicUrl({ refresh: body.refresh === true }),
        pinned: await readPairPinned(home),
      });
      sendJson(res, 200, { ok: true, ...info });
      return;
    }
    if (action === 'save-local-url') {
      // 用户点「保存」= pinned 锁死；页面自动捕获 origin 时传 pinned:false，只记录不锁定
      const url = normalizeManualUrl(body.url);
      const pinned = body.pinned !== false;
      await saveLocalUrl(url);
      await writePairPinned(resolveDshHome(), pinned);
      sendJson(res, 200, { ok: true, url, pinned });
      return;
    }
    if (action === 'auto-local-url') {
      // 「恢复自动」：取消 pinned，回到 cloudflared 自动检测
      await writePairPinned(resolveDshHome(), false);
      sendJson(res, 200, { ok: true, pinned: false });
      return;
    }
    if (action === 'save') {
      const raw = body.instance;
      if (!raw || typeof raw !== 'object') throw new Error('缺少 instance');
      const next = await withStore(async (state) => {
        const byId = new Map(state.instances.map((item) => [item.id, item]));
        const prev = typeof raw.id === 'string' ? byId.get(raw.id) : undefined;
        // 只有「新增」才受上限约束：编辑已有条目时列表可能已经满了
        if (!prev && state.instances.length >= MAX_INSTANCES) throw new Error('电脑太多了（最多 ' + MAX_INSTANCES + ' 台）');
        const instance = normalizeInstance(raw, prev);
        if (prev) {
          state.instances = state.instances.map((item) => (item.id === instance.id ? instance : item));
        } else {
          state.instances.push(instance);
        }
        return state;
      });
      sendJson(res, 200, { ok: true, instances: next.instances });
      return;
    }
    if (action === 'remove') {
      const id = String(body.id ?? '');
      const next = await withStore(async (state) => {
        state.instances = state.instances.filter((item) => item.id !== id);
        return state;
      });
      sendJson(res, 200, { ok: true, instances: next.instances });
      return;
    }
    if (action === 'reorder') {
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      const next = await withStore(async (state) => {
        const byId = new Map(state.instances.map((item) => [item.id, item]));
        const ordered = [];
        for (const id of ids) {
          const item = byId.get(id);
          if (item) {
            ordered.push(item);
            byId.delete(id);
          }
        }
        for (const item of state.instances) {
          if (byId.has(item.id)) ordered.push(item);
        }
        state.instances = ordered;
        return state;
      });
      sendJson(res, 200, { ok: true, instances: next.instances });
      return;
    }
    if (action === 'record-open') {
      const id = String(body.id ?? '');
      const endpointId = String(body.endpointId ?? '');
      const next = await withStore(async (state) => {
        state.instances = state.instances.map((item) => {
          if (item.id !== id) return item;
          const hasEndpoint = item.endpoints.some((ep) => ep.id === endpointId);
          return {
            ...item,
            preferredEndpointId: hasEndpoint ? endpointId : item.preferredEndpointId,
            lastOpenedAt: new Date().toISOString(),
          };
        });
        return state;
      });
      sendJson(res, 200, { ok: true, instances: next.instances });
      return;
    }
    if (action === 'import') {
      const parsed = parseImport(body.text);
      const next = await withStore(async (state) => {
        if (state.instances.length + parsed.instances.length > MAX_INSTANCES) throw new Error('电脑太多了（最多 ' + MAX_INSTANCES + ' 台）');
        for (const instance of parsed.instances) {
          // 同名视为「同一条配置的新版本」：替换并沿用原 id，避免出现两张一样的卡
          const index = state.instances.findIndex((item) => item.name === instance.name);
          if (index >= 0) state.instances[index] = { ...instance, id: state.instances[index].id };
          else state.instances.push(instance);
        }
        return state;
      });
      sendJson(res, 200, { ok: true, imported: parsed.instances.length, skipped: parsed.skipped.length, instances: next.instances });
      return;
    }
    sendJson(res, 400, { error: '未知操作 ' + JSON.stringify(action) });
  } catch (error) {
    sendJson(res, 400, { error: error?.message ?? String(error) });
  }
}

function handleRoute(ctx) {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const pathname = url.pathname;
      // 只把「没有结尾斜杠」的入口 302 到带斜杠的页面：否则 /dsh-pocket-switch/ 会自己重定向自己
      if (pathname === ROUTE) {
        send(res, 302, '', { location: PAGE_PATH });
        return;
      }
      if (pathname === PAGE_PATH) {
        send(res, 200, PAGE_HTML, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return;
      }
      if (pathname === API_PATH) {
        await handleApi(ctx, req, res);
        return;
      }
      if (pathname === ROUTE + '/manifest.webmanifest') {
        send(res, 200, JSON.stringify(manifest()), { 'content-type': 'application/manifest+json; charset=utf-8' });
        return;
      }
      const iconMatch = /^\/dsh-pocket-switch\/icon-(\d+)\.png$/.exec(pathname);
      if (iconMatch) {
        const size = Number(iconMatch[1]);
        if (ICONS[size]) {
          sendPng(res, size);
          return;
        }
      }
      send(res, 404, 'not found', { 'content-type': 'text/plain; charset=utf-8' });
    } catch (error) {
      ctx.logger?.warn?.(error);
      if (!res.headersSent) send(res, 500, 'internal error', { 'content-type': 'text/plain; charset=utf-8' });
      else res.end();
    }
  };
}

export function apply(ctx) {
  const handler = handleRoute(ctx);
  ctx.effect(() => {
    const dispose = ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler });
    if (typeof dispose === 'function') return dispose;
    if (dispose && typeof dispose.then === 'function') {
      return () => {
        dispose.then((fn) => { if (typeof fn === 'function') fn(); }).catch(() => {});
      };
    }
    return () => {};
  }, 'dsh-pocket-switch: router');
  ctx.logger?.info?.('[dsh-pocket-switch] 切换页已就绪：' + PAGE_PATH);
}
