// 配置存储 + 本机信息探测（host 半，纯 Node，无第三方依赖）。
// 存的是「另一台电脑的地址 + pocket 密码」——和 dsh-pocket 自己存 PIN 的做法一致，
// 只落本机磁盘（0600），也只通过本插件已登录的 API 返回。
import { promises as fsp } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, hostname as osHostname, networkInterfaces, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const STORE_VERSION = 1;
export const MAX_INSTANCES = 40;
export const MAX_ENDPOINTS = 8;
export const NAME_MAX = 40;
export const URL_MAX = 2048;
export const TOKEN_MAX = 256;
const KINDS = new Set(['lan', 'public', 'custom']);

export function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return join(homedir(), '.dsh');
}

export function storeDir() {
  return join(resolveDshHome(), 'dsh-pocket-switch');
}

export function storeFile() {
  return join(storeDir(), 'instances.json');
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function readText(file) {
  try {
    const text = readFileSync(file, 'utf8').trim();
    return text || '';
  } catch {
    return '';
  }
}

function isPrivateIpv4(address) {
  return /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address)
    || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(address)
    || /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(address);
}

/** 局域网候选地址：只取私有 IPv4，供用户在「本机导入」时手选（比猜一个更靠谱）。 */
export function lanCandidates() {
  const out = [];
  const seen = new Set();
  let interfaces = {};
  try {
    interfaces = networkInterfaces();
  } catch {
    return out;
  }
  for (const [iface, list] of Object.entries(interfaces)) {
    for (const item of list ?? []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      if (!isPrivateIpv4(item.address) || seen.has(item.address)) continue;
      seen.add(item.address);
      out.push({ address: item.address, iface });
    }
  }
  return out;
}

/**
 * 本机 dsh-pocket 的现状。
 * 密码/端口/隧道域名都来自 pocket 自己的文件；公网地址（快速隧道）只在 pocket 进程内存里，
 * 这里给不出来，页面会再通过 pocket 的 status RPC 补一次。
 */
/**
 * 记住本机访问地址：按主机名 upsert 一条实例，配对串优先用它。
 * 只动地址字段，不动用户自己加的其它电脑。
 */
export async function saveLocalUrl(url) {
  const want = osHostname().trim().toLowerCase();
  const kind = /^https:/i.test(url) ? 'public' : 'lan';
  return withStore((state) => {
    const index = state.instances.findIndex((item) => item.name.trim().toLowerCase() === want);
    if (index < 0) {
      state.instances.push(normalizeInstance({ name: osHostname(), endpoints: [{ kind, url, token: '' }] }));
      return state;
    }
    const prev = state.instances[index];
    const preferred = prev.endpoints.find((item) => item.id === prev.preferredEndpointId) ?? prev.endpoints[0];
    const endpoints = prev.endpoints.map((item) => (item.id === preferred.id ? { ...item, url, kind } : item));
    state.instances[index] = normalizeInstance({ ...prev, endpoints }, prev);
    return state;
  });
}

/** store 里「本机」那条实例的地址（配对串优先用它）：按主机名匹配，没有就空串。 */
export async function localRecordUrl() {
  const state = await readState();
  const want = osHostname().trim().toLowerCase();
  const inst = state.instances.find((item) => item.name.trim().toLowerCase() === want);
  if (!inst) return '';
  const endpoint = inst.endpoints.find((item) => item.id === inst.preferredEndpointId) ?? inst.endpoints[0];
  return endpoint?.url ?? '';
}

export function localInfo() {
  const dshHome = resolveDshHome();
  const pocketDir = join(dshHome, 'dsh-pocket');
  const settings = readJson(join(pocketDir, 'settings.json')) ?? {};
  const candidates = lanCandidates();
  const proxyPort = Number.isInteger(Number(settings.proxyPort)) && Number(settings.proxyPort) > 0
    ? Number(settings.proxyPort)
    : 3081;
  const namedHost = typeof settings.tunnelHostname === 'string' ? settings.tunnelHostname.trim() : '';
  return {
    hostname: osHostname(),
    platform: platform(),
    dshHome,
    lanCandidates: candidates,
    pocket: {
      present: existsSync(pocketDir),
      lanEnabled: settings.lanEnabled !== false,
      lanAuthEnabled: settings.lanAuthEnabled !== false,
      proxyPort,
      lanToken: readText(join(pocketDir, 'token-lan')),
      publicToken: readText(join(pocketDir, 'token')),
      tunnelMode: settings.tunnelMode === 'named' ? 'named' : 'quick',
      tunnelHostname: namedHost,
    },
  };
}

/** 把本机 pocket 现状折叠成一条可保存的实例（页面在拿不到 pocket RPC 时用它兜底）。 */
export function localInstance(local) {
  const endpoints = [];
  if (local?.pocket?.lanEnabled && local.pocket.lanAuthEnabled) {
    const ip = local.lanCandidates[0]?.address;
    if (ip) endpoints.push({ kind: 'lan', url: `http://${ip}:${local.pocket.proxyPort}`, token: local.pocket.lanToken });
  }
  if (local?.pocket?.tunnelMode === 'named' && local.pocket.tunnelHostname) {
    endpoints.push({ kind: 'public', url: `https://${local.pocket.tunnelHostname}`, token: local.pocket.publicToken });
  }
  return {
    name: local?.hostname || '这台电脑',
    endpoints,
  };
}

function cleanUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text) throw new Error('地址不能为空');
  if (text.length > URL_MAX) throw new Error('地址太长');
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`地址格式不对：${text.slice(0, 80)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('地址必须是 http 或 https');
  // 深链/哈希留着没意义，还容易把 token 写进分享串；统一丢掉
  url.hash = '';
  return url.toString();
}

function cleanToken(raw) {
  const text = String(raw ?? '').trim();
  if (text.length > TOKEN_MAX) throw new Error('密码太长');
  return text;
}

function cleanName(raw, fallback) {
  const text = String(raw ?? '').trim().slice(0, NAME_MAX);
  return text || fallback;
}

export function normalizeEndpoint(raw, id) {
  if (!raw || typeof raw !== 'object') throw new Error('地址条目不是对象');
  const kind = KINDS.has(raw.kind) ? raw.kind : 'custom';
  return {
    id: typeof id === 'string' && id ? id : randomUUID(),
    kind,
    url: cleanUrl(raw.url),
    token: cleanToken(raw.token),
  };
}

/** 校验并补全一条实例。id/创建时间只在新建时生成，更新时沿用旧值。 */
export function normalizeInstance(raw, prev) {
  if (!raw || typeof raw !== 'object') throw new Error('实例不是对象');
  const list = Array.isArray(raw.endpoints) ? raw.endpoints : [];
  if (list.length === 0) throw new Error('至少填一个地址');
  if (list.length > MAX_ENDPOINTS) throw new Error(`最多 ${MAX_ENDPOINTS} 个地址`);
  const endpoints = list.map((item) => normalizeEndpoint(item, item?.id));
  const ids = new Set(endpoints.map((item) => item.id));
  const preferred = typeof raw.preferredEndpointId === 'string' && ids.has(raw.preferredEndpointId)
    ? raw.preferredEndpointId
    : endpoints[0].id;
  const now = new Date().toISOString();
  return {
    id: prev?.id ?? (typeof raw.id === 'string' && raw.id ? raw.id : randomUUID()),
    name: cleanName(raw.name, prev?.name || '未命名电脑'),
    endpoints,
    preferredEndpointId: preferred,
    note: typeof raw.note === 'string' ? raw.note.slice(0, 200) : (prev?.note ?? ''),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    lastOpenedAt: typeof raw.lastOpenedAt === 'string' ? raw.lastOpenedAt : (prev?.lastOpenedAt ?? null),
  };
}

export function emptyState() {
  return { version: STORE_VERSION, instances: [] };
}

function normalizeState(raw) {
  const state = emptyState();
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.instances)) return state;
  const seen = new Set();
  for (const item of raw.instances.slice(0, MAX_INSTANCES)) {
    try {
      const inst = normalizeInstance(item, item?.id ? { id: String(item.id), createdAt: item.createdAt, lastOpenedAt: item.lastOpenedAt } : undefined);
      if (seen.has(inst.id)) continue;
      seen.add(inst.id);
      state.instances.push(inst);
    } catch {
      // 坏条目直接跳过，别让一条脏数据废掉整份清单
    }
  }
  return state;
}

let queue = Promise.resolve();

/** 串行读-改-写：并发保存不会互相覆盖。 */
export function withStore(mutator) {
  const run = queue.then(async () => {
    let state = emptyState();
    try {
      state = normalizeState(JSON.parse(await fsp.readFile(storeFile(), 'utf8')));
    } catch {
      state = emptyState();
    }
    const next = (await mutator(state)) ?? state;
    await writeState(next);
    return next;
  });
  queue = run.catch(() => {});
  return run;
}

async function writeState(state) {
  await fsp.mkdir(dirname(storeFile()), { recursive: true });
  const text = JSON.stringify({ version: STORE_VERSION, instances: state.instances }, null, 2) + '\n';
  const tmp = storeFile() + '.tmp';
  await fsp.writeFile(tmp, text, { mode: 0o600 });
  await fsp.rename(tmp, storeFile());
}

export async function readState() {
  try {
    return normalizeState(JSON.parse(await fsp.readFile(storeFile(), 'utf8')));
  } catch {
    return emptyState();
  }
}

export function parseImport(text) {
  let raw;
  try {
    raw = JSON.parse(String(text ?? ''));
  } catch {
    throw new Error('导入内容不是合法 JSON');
  }
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.instances) ? raw.instances : raw?.instances ? [raw.instances] : [raw];
  const instances = [];
  const skipped = [];
  for (const item of list) {
    try {
      instances.push(normalizeInstance(item));
    } catch (error) {
      skipped.push({ name: item?.name ?? '（无名）', reason: error.message });
    }
  }
  if (instances.length === 0) throw new Error('没有可导入的电脑');
  return { instances, skipped };
}

export function exportPayload(state) {
  return {
    app: 'dsh-pocket-switch',
    version: STORE_VERSION,
    exportedAt: new Date().toISOString(),
    instances: state.instances.map((inst) => ({
      name: inst.name,
      endpoints: inst.endpoints.map((ep) => ({ kind: ep.kind, url: ep.url, token: ep.token })),
      preferredEndpointId: inst.preferredEndpointId,
      note: inst.note,
    })),
  };
}
