import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildPairInfo,
  clearPublicUrlCache,
  decodePair,
  detectLanPairUrl,
  detectPublicUrl,
  isLoopbackUrl,
  normalizeManualUrl,
  pickLanAddresses,
  pocketProxyPort,
  readPairPinned,
  writePairPinned,
} from '../lib/pairing.js';
import { copyText, originButtonState, PAGE_HTML, pickDefaultAddress, sanitizePastedUrl } from '../lib/page.js';

function makeHome({ pin = 'public-pin', proxyPort } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-switch-pair-'));
  const pocket = join(home, 'dsh-pocket');
  mkdirSync(pocket, { recursive: true });
  if (pin) writeFileSync(join(pocket, 'token'), pin);
  if (proxyPort) writeFileSync(join(pocket, 'settings.json'), JSON.stringify({ proxyPort }));
  return home;
}

test('buildPairInfo：公网 origin 原样进配对串（不加端口/斜杠）', async () => {
  const home = makeHome();
  const info = await buildPairInfo({ home, origin: 'https://x.trycloudflare.com' });
  assert.equal(info.url, 'https://x.trycloudflare.com');
  assert.equal(info.pin, 'public-pin');
  const decoded = decodePair(info.pair);
  assert.equal(decoded.v, 1);
  assert.equal(decoded.url, 'https://x.trycloudflare.com');
  assert.equal(decoded.pin, 'public-pin');
  assert.ok(decoded.name.length > 0);
});

test('buildPairInfo：优先级 pinned > 自动检测 > 保存地址 > 页面 origin > 局域网', async () => {
  const home = makeHome();
  const tunnel = 'https://auto.trycloudflare.com';
  const saved = 'https://saved.example.com';
  const origin = 'https://page.example.com';
  const lanUrl = 'http://192.168.1.5:3081';

  const tunnelFirst = await buildPairInfo({ home, savedUrl: saved, origin, lanUrl, tunnelUrl: tunnel });
  assert.equal(tunnelFirst.url, tunnel);
  assert.equal(tunnelFirst.source, 'tunnel');

  const pinned = await buildPairInfo({ home, savedUrl: saved, origin, lanUrl, tunnelUrl: tunnel, pinned: true });
  assert.equal(pinned.url, saved);
  assert.equal(pinned.source, 'saved');
  assert.equal(pinned.pinned, true);
  assert.equal(decodePair(pinned.pair).url, saved);

  const unpinnedSaved = await buildPairInfo({ home, savedUrl: saved, origin, lanUrl });
  assert.equal(unpinnedSaved.url, saved);
  assert.equal(unpinnedSaved.source, 'saved');

  const page = await buildPairInfo({ home, origin, lanUrl });
  assert.equal(page.url, origin);
  assert.equal(page.source, 'origin');

  const lan = await buildPairInfo({ home, lanUrl });
  assert.equal(lan.url, lanUrl);
  assert.equal(lan.source, 'lan');

  const none = await buildPairInfo({ home });
  assert.equal(none.url, '');
  assert.equal(none.source, 'none');
  assert.equal(none.pair, '');

  // loopback 的 origin 不能当手机地址
  const loop = await buildPairInfo({ home, origin: 'http://127.0.0.1:60288', lanUrl });
  assert.equal(loop.url, lanUrl);
});

test('detectPublicUrl：真实环境能拿到 https://<tunnel>.trycloudflare.com', async () => {
  clearPublicUrlCache();
  const startedAt = Date.now();
  const url = await detectPublicUrl({ refresh: true });
  const elapsed = Date.now() - startedAt;
  // CI/无隧道机器上可能为空：非空时必须是合法快速隧道地址
  assert.ok(url === '' || /^https:\/\/[a-z0-9.-]+\.trycloudflare\.com$/.test(url), '地址形状不对：' + url);
  assert.ok(elapsed < 2000, '探测超时（应 <2s）：' + elapsed + 'ms');
  assert.equal(await detectPublicUrl(), url, '第二次应命中缓存');
});

test('detectPublicUrl：端口全关时返回空串且 <2s', async () => {
  const startedAt = Date.now();
  const url = await detectPublicUrl({ refresh: true, ports: [1, 2, 3] });
  const elapsed = Date.now() - startedAt;
  assert.equal(url, '');
  assert.ok(elapsed < 2000, '端口全关耗时过长：' + elapsed + 'ms');
});

test('pinned 标记：读写与默认值', async () => {
  const home = makeHome();
  assert.equal(await readPairPinned(home), false);
  await writePairPinned(home, true);
  assert.equal(await readPairPinned(home), true);
  await writePairPinned(home, false);
  assert.equal(await readPairPinned(home), false);
});

test('buildPairInfo：pin 或地址为空时 pair 为空串', async () => {
  const noPin = makeHome({ pin: '' });
  const info = await buildPairInfo({ home: noPin, origin: 'https://x.trycloudflare.com' });
  assert.equal(info.pin, '');
  assert.equal(info.pair, '');
  const noUrl = await buildPairInfo({ home: makeHome() });
  assert.equal(noUrl.url, '');
  assert.equal(noUrl.pair, '');
});

test('normalizeManualUrl：只收完整 http(s)，错误信息可读', () => {
  assert.equal(normalizeManualUrl('https://a.example.com/'), 'https://a.example.com');
  assert.equal(normalizeManualUrl('http://10.0.0.5:3081/x?y=1'), 'http://10.0.0.5:3081');
  assert.throws(() => normalizeManualUrl('x.trycloudflare.com'), /http:\/\/ 或 https:\/\//);
  assert.throws(() => normalizeManualUrl('javascript:alert(1)'), /http:\/\/ 或 https:\/\//);
  assert.throws(() => normalizeManualUrl('https://' + 'a'.repeat(300)), /太长/);
  assert.throws(() => normalizeManualUrl('   '), /不能为空/);
  // 桌面外壳 / 本地文件 / 脚本协议一律拒绝，错误信息要能看懂
  for (const bad of ['dsh-app://app', 'file:///C:/x', 'chrome://settings', 'data:text/plain,hi', 'ftp://x', 'javascript:alert(1)']) {
    assert.throws(() => normalizeManualUrl(bad), /只支持 http:\/\/ 或 https:\/\//, '应拒绝：' + bad);
  }
  assert.throws(() => normalizeManualUrl('dsh-app://app'), /dsh-app:\/\//);
  assert.equal(isLoopbackUrl('http://127.0.0.1:60288'), true);
  assert.equal(isLoopbackUrl('https://x.trycloudflare.com'), false);
});

test('originButtonState / pickDefaultAddress：桌面外壳 dsh-app:// 不能用', () => {
  const dshApp = originButtonState('dsh-app://app');
  assert.equal(dshApp.disabled, true);
  assert.match(dshApp.title, /当前是桌面外壳，读不到网页地址，请手动粘贴公网地址/);
  assert.equal(dshApp.noteHidden, false);
  const web = originButtonState('https://x.trycloudflare.com');
  assert.equal(web.disabled, false);
  assert.equal(web.title, '');
  assert.equal(originButtonState('http://127.0.0.1:60288').disabled, true);
  assert.equal(originButtonState('').disabled, true);
  // 默认值：保存的地址优先；origin 是 dsh-app:// 时跳过它，用局域网地址
  assert.equal(pickDefaultAddress({ savedUrl: 'https://saved.example.com', origin: 'dsh-app://app' }), 'https://saved.example.com');
  assert.equal(pickDefaultAddress({ origin: 'dsh-app://app', lanUrl: 'http://10.0.0.2:3081' }), 'http://10.0.0.2:3081');
  assert.equal(pickDefaultAddress({ origin: 'https://page.example.com' }), 'https://page.example.com');
});

test('sanitizePastedUrl：剪贴板里的空格/换行/引号都能处理', () => {
  assert.equal(sanitizePastedUrl('  https://a.trycloudflare.com  '), 'https://a.trycloudflare.com');
  assert.equal(sanitizePastedUrl('"https://a.trycloudflare.com"'), 'https://a.trycloudflare.com');
  assert.equal(sanitizePastedUrl('  “https://a.trycloudflare.com”  '), 'https://a.trycloudflare.com');
  assert.equal(sanitizePastedUrl("'https://c.example.com'"), 'https://c.example.com');
  assert.equal(sanitizePastedUrl('公网地址：\n  https://b.example.com  '), 'https://b.example.com');
  assert.equal(sanitizePastedUrl('   '), '');
  assert.equal(sanitizePastedUrl('dsh-app://app'), 'dsh-app://app');
});

test('pocketProxyPort / LAN 选地址：排除虚拟网卡与 169.254', () => {
  const home = makeHome({ proxyPort: 3999 });
  assert.equal(pocketProxyPort(home), 3999);
  assert.equal(pocketProxyPort(makeHome()), 3081);
  const picked = pickLanAddresses({
    'VMware Network Adapter VMnet1': [{ family: 'IPv4', address: '192.168.56.1', internal: false }],
    'Wi-Fi': [{ family: 'IPv4', address: '10.32.201.112', internal: false }],
    'WSL': [{ family: 'IPv4', address: '172.20.0.1', internal: false }],
    lo: [{ family: 'IPv4', address: '169.254.1.1', internal: false }],
  });
  assert.deepEqual(picked, ['10.32.201.112']);
});

test('detectLanPairUrl：pocket 代理活着才给地址（否则空串）', async () => {
  const home = makeHome({ proxyPort: 1 });
  assert.equal(await detectLanPairUrl(home, 200), '');
});

test('copyText：剪贴板成功 / 失败回退选中 / 老接口成功', async () => {
  const says = [];
  const fakeDoc = (execOk) => {
    const calls = [];
    return {
      calls,
      doc: {
        body: { appendChild() {}, removeChild() {} },
        createElement() { return { value: '', select() { calls.push('select'); } }; },
        execCommand(cmd) { calls.push('exec:' + cmd); return execOk; },
        createRange() { return { selectNodeContents() { calls.push('range'); } }; },
        getSelection() { return { removeAllRanges() {}, addRange() { calls.push('addRange'); } }; },
      },
    };
  };
  const okNav = { clipboard: { writeText: () => Promise.resolve() } };
  assert.equal(await copyText({ navigator: okNav, document: fakeDoc(false).doc, toast: (m) => says.push(m) }, 'abc', '已复制'), true);
  assert.equal(says.pop(), '已复制');

  const badNav = { clipboard: { writeText: () => Promise.reject(new Error('denied')) } };
  const fallbackDoc = fakeDoc(false);
  await copyText({ navigator: badNav, document: fallbackDoc.doc, toast: (m) => says.push(m) }, 'abc', '已复制', { id: 'node' });
  assert.match(says.pop(), /按 Ctrl\+C/);
  assert.ok(fallbackDoc.calls.includes('addRange'));

  const legacyDoc = fakeDoc(true);
  assert.equal(copyText({ navigator: {}, document: legacyDoc.doc, toast: (m) => says.push(m) }, 'abc', '已复制'), true);
  assert.equal(says.pop(), '已复制');
});

test('页面「本机配对」：字段顺序、按钮、黄字提示都在', () => {
  const start = PAGE_HTML.indexOf('<section id="pair-card"');
  const end = PAGE_HTML.indexOf('</section>', start);
  const block = PAGE_HTML.slice(start, end);
  const order = ['pair-url-input', 'pair-btns', 'pair-warn', 'pair-pin', 'pair-text', 'pair-actions', 'pair-hint'].map((id) => block.indexOf(id));
  assert.ok(order.every((value) => value >= 0), '字段缺失：' + JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order, '字段顺序不对');
  assert.match(block, /用当前页面地址/);
  assert.match(block, /粘贴并保存/);
  assert.match(block, /保存/);
  assert.match(block, /当前是局域网地址，手机可能需要同一 WiFi；出门请填 dsh-pocket 的公网地址/);
  assert.match(block, /pair-current/);
  // 公网地址在哪看：默认收起的说明 + 桌面外壳提示
  assert.match(block, /<details id="pair-help"/);
  assert.doesNotMatch(block, /<details id="pair-help"[^>]*\bopen\b/);
  assert.match(block, /公网地址在 设置 →『手机访问』→ 公网 一栏/);
  assert.match(block, /当前是桌面外壳，读不到网页地址，请手动粘贴公网地址/);
  assert.match(PAGE_HTML, /overflow-wrap:anywhere/);
  assert.match(PAGE_HTML, /已记住当前地址/);
  assert.match(PAGE_HTML, /button\.disabled = view\.disabled/);
  assert.match(PAGE_HTML, /dsh-app:\/\//);
});
