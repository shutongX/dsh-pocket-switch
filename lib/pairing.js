// 本机配对串（DSHPAIR1.<base64url JSON>）：手机 app 粘贴即可自动填地址 + 密码。
// 从 dsh-config-migrator 的旧实现拷来（那个插件已撤掉配对），本插件不依赖它。
import { hostname, networkInterfaces } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { join } from 'node:path';

export const PAIR_PREFIX = 'DSHPAIR1.';
export const MAX_NAME = 40;

export function pinPath(home) { return join(home, 'dsh-pocket', 'token'); }

/** dsh-pocket 的公网 PIN；文件不存在时返回空串（不抛错）。 */
export async function readPin(home) {
  try {
    return (await readFile(pinPath(home), 'utf8')).trim().slice(0, 64);
  } catch {
    return '';
  }
}

/** 显示名：去控制字符、压空格、最多 40 字。 */
export function cleanName(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

/** localhost 的各种写法；空值按本地处理。 */
export function isLoopbackHostname(value) {
  const host = String(value ?? '').trim().replace(/^\[|\]$/g, '').split(':')[0].toLowerCase();
  return host === '' || host === 'localhost' || host === '::1' || host === '127.0.0.1' || host.startsWith('127.');
}

/** URL/host/header → host[:port]；不是纯 authority 时返回空串。 */
export function normalizeUrlHost(value) {
  let text = String(value ?? '').trim();
  if (text === '') return '';
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\/\//, '');
  text = text.replace(/^[^/@]*@/, '');
  text = text.split(/[/?#]/)[0].replace(/[\s\u0000-\u001f]/g, '').replace(/\.+$/, '');
  return /^[A-Za-z0-9._~:\-[\]%]+$/.test(text) ? text.slice(0, 255) : '';
}

export function encodePair(payload) { return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'); }

/** 解一个粘贴来的配对串（容忍引号/空格噪音）；不可用时返回 null。 */
export function decodePair(text) {
  if (typeof text !== 'string') return null;
  const at = text.toUpperCase().indexOf(PAIR_PREFIX);
  if (at < 0) return null;
  const rest = text.slice(at + PAIR_PREFIX.length).replace(/^[\s"':：,]+/, '');
  const token = /^[A-Za-z0-9\-_+/=]+/.exec(rest);
  if (token === null) return null;
  try {
    const raw = Buffer.from(token[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const data = JSON.parse(raw.slice(start, end + 1));
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

export function pairString({ name, url, pin }) {
  return PAIR_PREFIX + encodePair({ v: 1, name: String(name ?? ''), url: String(url ?? ''), pin: String(pin ?? '') });
}

/** 虚拟网卡/VPN 有私网地址但手机连不上，必须排除（和旧实现同一份规则）。 */
const VIRTUAL_IFACE = /vmware|virtualbox|vethernet|hyper-?v|wsl|docker|tailscale|zerotier|loopback|bluetooth|local area connection/i;

function isPrivateIPv4(ip) {
  return ip.startsWith('10.') || ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

function isLinkLocal(ip) { return ip.startsWith('169.254.'); }

/** 纯函数：从 networkInterfaces() 形状的数据里挑地址（方便单测）。 */
export function pickLanAddresses(interfaces) {
  const all = [];
  const preferred = [];
  for (const [name, list] of Object.entries(interfaces ?? {})) {
    const virtual = VIRTUAL_IFACE.test(String(name));
    for (const info of list ?? []) {
      if (info?.family !== 'IPv4' || info.internal) continue;
      all.push(info.address);
      if (!virtual && !isLinkLocal(info.address)) preferred.push(info.address);
    }
  }
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : isPrivateIPv4(ip) ? 2 : 3);
  const sorted = (list) => [...new Set(list)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  if (preferred.length > 0) return sorted(preferred);
  // 网卡名太奇怪时兜底：私网地址 → 任意非 internal 地址，保证单网卡也能配对
  const privateFallback = all.filter((ip) => !isLinkLocal(ip) && isPrivateIPv4(ip));
  if (privateFallback.length > 0) return sorted(privateFallback);
  return sorted(all);
}

export function lanAddresses() { return pickLanAddresses(networkInterfaces()); }

/** 手填/页面地址规范化：只认完整 http(s) origin，返回不带尾斜杠的形式。 */
export function normalizeManualUrl(value) {
  const text = String(value ?? '').trim();
  if (text === '') throw new Error('地址不能为空');
  if (text.length > 255) throw new Error('地址太长（最多 255 个字符）');
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('地址格式不对，要带 http:// 或 https://');
  }
  // 桌面 app 的 origin 是 dsh-app://，手机打不开；file:/data:/ftp: 同理
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    var label = url.protocol === 'dsh-app:' ? '桌面 app 的 dsh-app://' : url.protocol + '//';
    throw new Error('只支持 http:// 或 https:// 地址（你填的是 ' + label + '，手机打不开）');
  }
  if (!url.hostname) throw new Error('地址缺少主机名');
  return url.origin;
}

/** loopback / localhost / 127.x 不算手机能访问的地址。 */
export function isLoopbackUrl(value) {
  try {
    const host = new URL(String(value)).hostname.toLowerCase();
    return host === 'localhost' || host === '::1' || host === '[::1]' || host === '127.0.0.1' || host.startsWith('127.');
  } catch {
    return true;
  }
}

function normalizeOriginOrEmpty(value) {
  try {
    return normalizeManualUrl(value);
  } catch {
    return '';
  }
}

/** dsh-pocket 代理端口：settings.json 没写就按默认 3081。 */
export function pocketProxyPort(home) {
  try {
    const settings = JSON.parse(readFileSync(join(home, 'dsh-pocket', 'settings.json'), 'utf8'));
    if (settings && Number.isInteger(Number(settings.proxyPort)) && Number(settings.proxyPort) > 0) return Number(settings.proxyPort);
  } catch {
    // 文件不存在/坏掉都退回默认值：探测本身会判断它是否活着
  }
  return 3081;
}

/** 本机 pocket 代理在不在监听：GET 127.0.0.1:<port>/ 有响应就算。 */
export function probePocket(port, timeoutMs = 400) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      resolve(ok);
    };
    const req = httpGet({ host: '127.0.0.1', port, path: '/', timeout: timeoutMs }, (res) => {
      res.resume();
      finish(true);
    });
    req.on('timeout', () => {
      req.destroy();
      finish(false);
    });
    req.on('error', () => finish(false));
  });
}

/** 局域网配对地址：只有 pocket 代理活着才返回（防火墙拦了就别误导手机）。 */
export async function detectLanPairUrl(home, timeoutMs = 400) {
  const ip = lanAddresses()[0];
  if (!ip) return '';
  const port = pocketProxyPort(home);
  const alive = await probePocket(port, timeoutMs);
  return alive ? 'http://' + ip + ':' + port : '';
}

/** cloudflared 官方 metrics 端口（默认 20241，向上试 10 个）。 */
const QUICKTUNNEL_PORTS = Array.from({ length: 10 }, (_, index) => 20241 + index);
const TUNNEL_HOST = /^[a-z0-9.-]+\.trycloudflare\.com$/i;
const PUBLIC_URL_CACHE_MS = 30 * 1000;
let publicUrlCache = { value: '', at: 0 };

async function quicktunnelHost(port) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/quicktunnel', { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) return '';
    const data = await response.json();
    const hostname = typeof data?.hostname === 'string' ? data.hostname.trim().toLowerCase() : '';
    return TUNNEL_HOST.test(hostname) ? hostname : '';
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 自动检测 cloudflared 快速隧道地址：读 metrics 的 /quicktunnel。
 * 10 个端口并发探测（每个 500ms）——串行最坏要 5s，超过验收要求的 2s。
 * 任何异常/超时返回空串；结果缓存 30s。
 */
export async function detectPublicUrl({ refresh = false, ports = QUICKTUNNEL_PORTS } = {}) {
  const now = Date.now();
  if (!refresh && ports === QUICKTUNNEL_PORTS && now - publicUrlCache.at < PUBLIC_URL_CACHE_MS) return publicUrlCache.value;
  let value = '';
  if (typeof fetch === 'function') {
    const hosts = await Promise.all(ports.map((port) => quicktunnelHost(port)));
    const host = hosts.find((item) => item !== '') ?? '';
    if (host !== '') value = 'https://' + host;
  }
  if (ports === QUICKTUNNEL_PORTS) publicUrlCache = { value, at: Date.now() };
  return value;
}

export function clearPublicUrlCache() {
  publicUrlCache = { value: '', at: 0 };
}

/** pinned 标记：用户点过「保存」就锁死他填的地址，直到点「恢复自动」。 */
export function pairPrefsPath(home) { return join(home, 'dsh-pocket-switch', 'pair.json'); }

export async function readPairPinned(home) {
  try {
    const data = JSON.parse(await readFile(pairPrefsPath(home), 'utf8'));
    return data !== null && typeof data === 'object' && data.pinned === true;
  } catch {
    return false;
  }
}

export async function writePairPinned(home, pinned) {
  const file = pairPrefsPath(home);
  await mkdir(join(home, 'dsh-pocket-switch'), { recursive: true });
  await writeFile(file, JSON.stringify({ pinned: pinned === true }, null, 2) + '\n', 'utf8');
}

/**
 * 配对所需的一切。
 * url 优先级：pinned 保存地址 → 自动检测的公网地址 → store 保存地址 → 页面 origin → 局域网地址。
 * 完整 origin 原样使用，不再追加 DSH 的 web 端口；url 或 pin 为空时 pair 返回空串。
 */
export async function buildPairInfo({ home, savedUrl, origin, lanUrl, tunnelUrl, pinned } = {}) {
  const pin = await readPin(home);
  const name = cleanName(hostname()) || 'DSH';
  const saved = normalizeOriginOrEmpty(savedUrl);
  const tunnel = typeof tunnelUrl === 'string' ? tunnelUrl.trim() : '';
  const fromPage = normalizeOriginOrEmpty(origin);
  const pageUsable = fromPage !== '' && !isLoopbackUrl(fromPage) ? fromPage : '';
  const lan = typeof lanUrl === 'string' ? lanUrl.trim() : '';
  const isPinned = pinned === true && saved !== '';
  let url = '';
  let source = 'none';
  if (isPinned) { url = saved; source = 'saved'; }
  else if (tunnel !== '') { url = tunnel; source = 'tunnel'; }
  else if (saved !== '') { url = saved; source = 'saved'; }
  else if (pageUsable !== '') { url = pageUsable; source = 'origin'; }
  else if (lan !== '') { url = lan; source = 'lan'; }
  const pair = pin !== '' && url !== '' ? pairString({ name, url, pin }) : '';
  return { name, url, pin, lanUrl: lan, savedUrl: saved, tunnelUrl: tunnel, pinned: isPinned, source, pair };
}
