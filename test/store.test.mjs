import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'dsh-switch-test-'));
process.env.DSH_HOME = home;
mkdirSync(join(home, 'dsh-pocket'), { recursive: true });
writeFileSync(join(home, 'dsh-pocket', 'token'), 'public-pin');
writeFileSync(join(home, 'dsh-pocket', 'token-lan'), 'lan-pin');
writeFileSync(join(home, 'dsh-pocket', 'settings.json'), JSON.stringify({ proxyPort: 3099, tunnelMode: 'named', tunnelHostname: 'home.example.com' }));

const {
  normalizeInstance,
  parseImport,
  exportPayload,
  withStore,
  readState,
  localInfo,
  emptyState,
} = await import('../lib/store.js');

test('normalizeInstance 校验地址与密码', () => {
  const instance = normalizeInstance({
    name: '  家里  ',
    endpoints: [
      { kind: 'lan', url: 'http://192.168.1.5:3081/', token: ' 12345678 ' },
      { kind: 'public', url: 'https://x.trycloudflare.com', token: '' },
    ],
  });
  assert.equal(instance.name, '家里');
  assert.equal(instance.endpoints.length, 2);
  assert.equal(instance.endpoints[0].url, 'http://192.168.1.5:3081/');
  assert.equal(instance.endpoints[0].token, '12345678');
  assert.equal(instance.preferredEndpointId, instance.endpoints[0].id);
  assert.ok(instance.id);
  assert.throws(() => normalizeInstance({ name: 'x', endpoints: [] }), /至少填一个地址/);
  assert.throws(() => normalizeInstance({ name: 'x', endpoints: [{ url: 'javascript:alert(1)' }] }), /http/);
  assert.throws(() => normalizeInstance({ name: 'x', endpoints: [{ url: 'not a url' }] }), /格式不对/);
});

test('normalizeInstance 更新时保留 id 与创建时间', () => {
  const first = normalizeInstance({ name: 'A', endpoints: [{ url: 'http://a.test' }] });
  const second = normalizeInstance({ ...first, name: 'B' }, first);
  assert.equal(second.id, first.id);
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.name, 'B');
});

test('parseImport 接受导出包 / 单条 / 裸数组', () => {
  const one = { name: 'A', endpoints: [{ kind: 'lan', url: 'http://a.test', token: 'x' }] };
  assert.equal(parseImport(JSON.stringify({ app: 'dsh-pocket-switch', instances: [one] })).instances.length, 1);
  assert.equal(parseImport(JSON.stringify(one)).instances.length, 1);
  assert.equal(parseImport(JSON.stringify([one, one])).instances.length, 2);
  assert.throws(() => parseImport('not json'), /不是合法 JSON/);
  assert.throws(() => parseImport('{}'), /没有可导入的电脑/);
});

test('withStore 保存/排序/重开读取', async () => {
  await withStore((state) => {
    state.instances = [
      normalizeInstance({ name: 'A', endpoints: [{ url: 'http://a.test' }] }),
      normalizeInstance({ name: 'B', endpoints: [{ url: 'http://b.test' }] }),
    ];
    return state;
  });
  const saved = await readState();
  assert.equal(saved.instances.length, 2);
  const ids = saved.instances.map((item) => item.id).reverse();
  await withStore((state) => {
    state.instances = ids.map((id) => state.instances.find((item) => item.id === id));
    return state;
  });
  const reordered = await readState();
  assert.deepEqual(reordered.instances.map((item) => item.name), ['B', 'A']);
  const exported = exportPayload(reordered);
  assert.equal(exported.app, 'dsh-pocket-switch');
  assert.equal(exported.instances.length, 2);
  const raw = JSON.parse(readFileSync(join(home, 'dsh-pocket-switch', 'instances.json'), 'utf8'));
  assert.equal(raw.version, 1);
});

test('localInfo 读 dsh-pocket 配置', () => {
  const local = localInfo();
  assert.equal(local.pocket.present, true);
  assert.equal(local.pocket.proxyPort, 3099);
  assert.equal(local.pocket.lanToken, 'lan-pin');
  assert.equal(local.pocket.publicToken, 'public-pin');
  assert.equal(local.pocket.tunnelMode, 'named');
  assert.equal(local.pocket.tunnelHostname, 'home.example.com');
  assert.ok(Array.isArray(local.lanCandidates));
});

test('坏文件不炸', async () => {
  writeFileSync(join(home, 'dsh-pocket-switch', 'instances.json'), '{oops');
  const state = await readState();
  assert.deepEqual(state, emptyState());
});
