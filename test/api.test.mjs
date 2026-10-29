import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { hostname as osHostname, tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'dsh-switch-api-'));
process.env.DSH_HOME = home;
mkdirSync(join(home, 'dsh-pocket'), { recursive: true });
writeFileSync(join(home, 'dsh-pocket', 'token'), 'public-pin');
writeFileSync(join(home, 'dsh-pocket', 'token-lan'), 'lan-pin');

const { apply } = await import('../lib/index.js');

function makePlugin(rejection) {
  let handler;
  const disposers = [];
  const ctx = {
    logger: { info() {}, warn() {} },
    get(name) {
      if (name === 'connection') return rejection === undefined ? undefined : { requestRejection: () => rejection };
      return undefined;
    },
    effect(fn) {
      const value = fn();
      if (typeof value === 'function') disposers.push(value);
    },
    webServer: {
      register(route) {
        handler = route.handler;
        return () => {};
      },
    },
  };
  apply(ctx);
  return { handler, disposers };
}

function makeReq({ method = 'POST', url = '/dsh-pocket-switch/api', body, headers } = {}) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  stream.method = method;
  stream.url = url;
  stream.headers = headers ?? { host: '127.0.0.1:64173' };
  return stream;
}

function makeRes() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers ?? {};
    },
    end(body) {
      this.body = body ?? '';
    },
  };
}

async function call(handler, body, options = {}) {
  const res = makeRes();
  await handler(makeReq({ body, ...options }), res);
  let json;
  try { json = JSON.parse(res.body); } catch { json = undefined; }
  return { status: res.status, headers: res.headers, body: res.body, json };
}

test('页面 / 清单 / 图标无需登录也能取', async () => {
  const { handler } = makePlugin(undefined);
  const page = await call(handler, undefined, { method: 'GET', url: '/dsh-pocket-switch/' });
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.body, /换电脑/);
  const redirect = await call(handler, undefined, { method: 'GET', url: '/dsh-pocket-switch' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.location, '/dsh-pocket-switch/');
  const manifest = await call(handler, undefined, { method: 'GET', url: '/dsh-pocket-switch/manifest.webmanifest' });
  assert.equal(manifest.status, 200);
  assert.equal(manifest.json.name, '换电脑');
  const icon = await call(handler, undefined, { method: 'GET', url: '/dsh-pocket-switch/icon-180.png' });
  assert.equal(icon.status, 200);
  assert.equal(icon.headers['content-type'], 'image/png');
  const missing = await call(handler, undefined, { method: 'GET', url: '/dsh-pocket-switch/nope' });
  assert.equal(missing.status, 404);
});

test('API 未登录直接 401', async () => {
  const { handler } = makePlugin(401);
  const res = await call(handler, { action: 'state' });
  assert.equal(res.status, 401);
});

test('保存 / 读回 / 排序 / 删除 / 记录打开', async () => {
  const { handler } = makePlugin(undefined);
  const empty = await call(handler, { action: 'state' });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json.instances, []);
  assert.equal(empty.json.local.pocket.present, true);

  const a = await call(handler, { action: 'save', instance: { name: '家里', endpoints: [{ kind: 'lan', url: 'http://192.168.1.5:3081', token: 'lan-pin' }] } });
  assert.equal(a.status, 200);
  assert.equal(a.json.instances.length, 1);
  const idA = a.json.instances[0].id;
  const b = await call(handler, { action: 'save', instance: { name: '公司', endpoints: [{ kind: 'public', url: 'https://office.trycloudflare.com', token: 'public-pin' }] } });
  assert.equal(b.json.instances.length, 2);
  const idB = b.json.instances[1].id;

  const reopened = await call(handler, { action: 'record-open', id: idB, endpointId: b.json.instances[1].endpoints[0].id });
  assert.equal(reopened.status, 200);
  const opened = reopened.json.instances.find((item) => item.id === idB);
  assert.ok(opened.lastOpenedAt);
  assert.equal(opened.preferredEndpointId, opened.endpoints[0].id);

  const reordered = await call(handler, { action: 'reorder', ids: [idB, idA] });
  assert.deepEqual(reordered.json.instances.map((item) => item.name), ['公司', '家里']);

  const bad = await call(handler, { action: 'save', instance: { name: '坏', endpoints: [] } });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /至少填一个地址/);

  const removed = await call(handler, { action: 'remove', id: idA });
  assert.deepEqual(removed.json.instances.map((item) => item.name), ['公司']);
});

test('导出再导入：同名替换，不重复', async () => {
  const { handler } = makePlugin(undefined);
  const state = await call(handler, { action: 'state' });
  const text = JSON.stringify(state.json.export);
  const imported = await call(handler, { action: 'import', text });
  assert.equal(imported.status, 200);
  assert.equal(imported.json.instances.length, 1);
  assert.equal(imported.json.instances[0].name, '公司');
});

test('save-local-url：记住地址后 pair 用它，state 里能读回', async () => {
  const { handler } = makePlugin(undefined);
  const saved = await call(handler, { action: 'save-local-url', url: 'https://intended-frederick-dated-essays.trycloudflare.com/' });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.url, 'https://intended-frederick-dated-essays.trycloudflare.com');

  const state = await call(handler, { action: 'state' });
  const mine = state.json.instances.find((item) => item.name === osHostname());
  assert.ok(mine, '本机实例应写进 store');
  // store 内部按 URL 序列化（带尾斜杠）；配对串那边会归一到不带斜杠的 origin
  assert.ok(mine.endpoints[0].url.startsWith('https://intended-frederick-dated-essays.trycloudflare.com'));

  const pair = await call(handler, { action: 'pair', origin: 'https://ignored.example.com' });
  assert.equal(pair.status, 200);
  assert.equal(pair.json.url, 'https://intended-frederick-dated-essays.trycloudflare.com');
  assert.equal(pair.json.savedUrl, 'https://intended-frederick-dated-essays.trycloudflare.com');
  assert.equal(pair.json.pin, 'public-pin');
  const decoded = JSON.parse(Buffer.from(String(pair.json.pair).slice('DSHPAIR1.'.length), 'base64url').toString('utf8'));
  assert.deepEqual(decoded, { v: 1, name: osHostname(), url: 'https://intended-frederick-dated-essays.trycloudflare.com', pin: 'public-pin' });

  // 再保存一次不产生第二台「本机」
  await call(handler, { action: 'save-local-url', url: 'https://second.example.com' });
  const again = await call(handler, { action: 'state' });
  assert.equal(again.json.instances.filter((item) => item.name === osHostname()).length, 1);
});

test('save-local-url：非法地址给出明确 400', async () => {
  const { handler } = makePlugin(undefined);
  const cases = [
    ['x.trycloudflare.com', /http:\/\/ 或 https:\/\//],
    ['javascript:alert(1)', /http:\/\/ 或 https:\/\//],
    ['dsh-app://app', /dsh-app/],
    ['file:///C:/x', /只支持 http/],
    ['ftp://x', /只支持 http/],
    ['https://' + 'a'.repeat(300), /太长/],
    ['   ', /不能为空/],
  ];
  for (const [url, pattern] of cases) {
    const res = await call(handler, { action: 'save-local-url', url });
    assert.equal(res.status, 400, '应拒绝：' + url.slice(0, 40));
    assert.match(res.json.error, pattern);
  }
});

test('pinned：手动保存压过自动检测，恢复自动后取消', async () => {
  const { handler } = makePlugin(undefined);
  const target = 'https://pinned.example.com';
  const saved = await call(handler, { action: 'save-local-url', url: target, pinned: true });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.pinned, true);

  const pair = await call(handler, { action: 'pair' });
  assert.equal(pair.json.url, target);
  assert.equal(pair.json.pinned, true);
  assert.equal(pair.json.source, 'saved');
  const decoded = JSON.parse(Buffer.from(String(pair.json.pair).slice('DSHPAIR1.'.length), 'base64url').toString('utf8'));
  assert.equal(decoded.url, target);

  const auto = await call(handler, { action: 'auto-local-url' });
  assert.equal(auto.status, 200);
  assert.equal(auto.json.pinned, false);
  const after = await call(handler, { action: 'pair' });
  assert.equal(after.json.pinned, false);
  // 取消 pinned 后：机器上有隧道用隧道，没有才回落到保存地址
  assert.ok(after.json.source === 'tunnel' || after.json.url === target, 'source=' + after.json.source + ' url=' + after.json.url);
});

test('pair：没存地址时用页面 origin，loopback 被忽略；Host 非本机 403', async () => {
  const freshHome = mkdtempSync(join(tmpdir(), 'dsh-switch-pair-'));
  mkdirSync(join(freshHome, 'dsh-pocket'), { recursive: true });
  writeFileSync(join(freshHome, 'dsh-pocket', 'token'), 'fresh-pin');
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = freshHome;
  try {
    const { handler } = makePlugin(undefined);
    const fromPage = await call(handler, { action: 'pair', origin: 'https://page.example.com' });
    assert.equal(fromPage.status, 200);
    // 机器上有 cloudflared 时自动检测（tunnel）优先；没有就回落到页面 origin
    assert.ok(['tunnel', 'origin'].includes(fromPage.json.source), 'source=' + fromPage.json.source);
    if (fromPage.json.source === 'origin') assert.equal(fromPage.json.url, 'https://page.example.com');
    else assert.match(fromPage.json.url, /^https:\/\/[a-z0-9.-]+\.trycloudflare\.com$/);
    const decoded = JSON.parse(Buffer.from(String(fromPage.json.pair).slice('DSHPAIR1.'.length), 'base64url').toString('utf8'));
    assert.equal(decoded.url, fromPage.json.url);
    assert.equal(decoded.pin, 'fresh-pin');

    const loopbackOnly = await call(handler, { action: 'pair', origin: 'http://127.0.0.1:60288' });
    assert.notEqual(loopbackOnly.json.url, 'http://127.0.0.1:60288');

    const evil = await call(handler, { action: 'pair' }, { headers: { host: 'evil.com' } });
    assert.equal(evil.status, 403);
  } finally {
    process.env.DSH_HOME = prevHome;
  }
});

test('坏 JSON / 未知操作给出 400 与可读错误', async () => {
  const { handler } = makePlugin(undefined);
  const res = makeRes();
  await handler(makeReq({ body: undefined }), res);
  const empty = JSON.parse(res.body);
  assert.equal(empty.error.includes('未知操作'), true);
  const bad = await call(handler, { action: 'save', instance: { name: 'x', endpoints: [{ url: 'ftp://x' }] } });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /http/);
});
