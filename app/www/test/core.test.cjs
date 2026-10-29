"use strict";
// 纯逻辑单测：把浏览器用的 app.js 当普通脚本跑一遍（UMD 的 CommonJS 分支），不需要 DOM。
// 注意不能用 require("../app.js")：插件 package.json 是 "type":"module"，.js 会被当成 ESM。
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

function loadCore() {
  const file = path.join(__dirname, "..", "app.js");
  const source = fs.readFileSync(file, "utf8");
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(source, sandbox, { filename: file });
  return sandbox.module.exports;
}

const core = loadCore();

// vm 沙箱里的对象和主线程对象原型不同，deepStrictEqual 会误报，先拍平成普通 JSON 再比
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function pairOf(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function makeList() {
  const base = [];
  const one = core.addMachine(base, { name: "家里的台式机", host: "https://quiet-river-8a2f.trycloudflare.com/", pin: "48213907" });
  const two = core.addMachine(one.list, { name: "公司笔记本", host: "brave-cloud-19c4.trycloudflare.com", pin: "93051827" });
  const three = core.addMachine(two.list, { name: "旧 MacBook", host: "slow-pine-7d10.trycloudflare.com", pin: "11204833" });
  return three.list;
}

test("配对串：正常解析", () => {
  const payload = pairOf({ v: 1, name: "家里的台式机", url: "https://quiet-river-8a2f.trycloudflare.com/", pin: "48213907" });
  const result = core.parsePair("DSHPAIR1." + payload);
  assert.equal(result.ok, true);
  assert.equal(result.value.name, "家里的台式机");
  assert.equal(result.value.host, "quiet-river-8a2f.trycloudflare.com");
  assert.equal(result.value.pin, "48213907");
  assert.equal(result.value.v, 1);
});

test("配对串：多出 base64 / data 前缀和前后说明文字也能认", () => {
  const payload = pairOf({ v: 1, name: "公司笔记本", url: "brave-cloud-19c4.trycloudflare.com", pin: "93051827" });
  const wrapped = "从电脑复制的： DSHPAIR1.data:application/json;base64," + payload + "  （复制自电脑）";
  const result = core.parsePair(wrapped);
  assert.equal(result.ok, true);
  assert.equal(result.value.host, "brave-cloud-19c4.trycloudflare.com");
  assert.equal(result.value.name, "公司笔记本");
});

test("配对串：乱码 / 不是 JSON / 没有前缀都失败且给原因", () => {
  const noPrefix = core.parsePair("hello world");
  assert.equal(noPrefix.ok, false);
  assert.equal(noPrefix.code, "no-prefix");

  const garbage = core.parsePair("DSHPAIR1.%%%");
  assert.equal(garbage.ok, false);
  assert.ok(["empty", "bad-base64"].includes(garbage.code));

  const notJson = core.parsePair("DSHPAIR1." + Buffer.from("not-json", "utf8").toString("base64"));
  assert.equal(notJson.ok, false);
  assert.equal(notJson.code, "bad-json");
  assert.ok(notJson.message.length > 0);
});

test("配对串：缺字段会报缺什么", () => {
  const noPin = core.parsePair("DSHPAIR1." + pairOf({ v: 1, name: "x", url: "https://a.example.com" }));
  assert.equal(noPin.ok, false);
  assert.equal(noPin.code, "incomplete");
  assert.match(noPin.message, /密码/);

  const noUrl = core.parsePair("DSHPAIR1." + pairOf({ v: 1, name: "x", pin: "1234" }));
  assert.equal(noUrl.ok, false);
  assert.equal(noUrl.code, "incomplete");
  assert.match(noUrl.message, /地址/);
});

test("地址归一化：去协议、去路径、去空白", () => {
  assert.equal(core.normalizeHost(" https://a.b.c/foo?x=1 "), "a.b.c");
  assert.equal(core.normalizeHost("http://u:p@host:8443/path"), "host:8443");
  assert.equal(core.normalizeHost(""), "");
});

test("列表：添加 / 同地址去重 / 删除 / 改名", () => {
  let list = makeList();
  assert.equal(list.length, 3);
  assert.equal(list[0].name, "家里的台式机");

  const dup = core.addMachine(list, { name: "台式机改名", host: "quiet-river-8a2f.trycloudflare.com", pin: "99999999" });
  assert.equal(dup.replaced, true);
  assert.equal(dup.list.length, 3);
  assert.equal(dup.list[0].name, "台式机改名");
  assert.equal(dup.list[0].pin, "99999999");

  list = dup.list;
  const removed = core.removeMachine(list, list[1].id);
  assert.equal(removed.removed, true);
  assert.equal(removed.list.length, 2);
  assert.equal(removed.list[1].name, "旧 MacBook");

  const renamed = core.renameMachine(removed.list, removed.list[1].id, "  老 Mac  ");
  assert.equal(renamed.ok, true);
  assert.equal(renamed.list[1].name, "老 Mac");
});

test("列表：上下移动，边界不动", () => {
  let list = makeList();
  const secondId = list[1].id;

  const up = core.moveMachine(list, secondId, -1);
  assert.equal(up.moved, true);
  assert.deepEqual(up.list.map((m) => m.name), ["公司笔记本", "家里的台式机", "旧 MacBook"]);

  const down = core.moveMachine(up.list, secondId, 1);
  assert.deepEqual(down.list.map((m) => m.name), ["家里的台式机", "公司笔记本", "旧 MacBook"]);

  const top = core.moveMachine(down.list, down.list[0].id, -1);
  assert.equal(top.moved, false);
  const bottom = core.moveMachine(down.list, down.list[2].id, 1);
  assert.equal(bottom.moved, false);
});

test("列表：缺地址或密码的机器不进来", () => {
  const result = core.addMachine([], { name: "x", host: "", pin: "1" });
  assert.equal(result.ok, false);
  const result2 = core.addMachine([], { name: "x", host: "a.b", pin: "" });
  assert.equal(result2.ok, false);
});

test("本地存储：正常读写、坏数据兜底、兼容直接存数组", () => {
  const list = makeList();
  const state = { v: 1, items: list, currentId: list[1].id };
  const parsed = core.parseStore(core.serializeStore(state));
  assert.equal(parsed.items.length, 3);
  assert.equal(parsed.currentId, list[1].id);

  assert.deepEqual(plain(core.parseStore("not json").items), []);
  assert.deepEqual(plain(core.parseStore("").items), []);
  assert.deepEqual(plain(core.parseStore(null).items), []);

  const legacy = core.parseStore(JSON.stringify(list));
  assert.equal(legacy.items.length, 3);
  assert.equal(legacy.currentId, list[0].id);

  const dropped = core.parseStore(JSON.stringify({ items: [{ name: "坏了" }, null] }));
  assert.deepEqual(plain(dropped.items), []);
});

test("记住密码：默认关，密码不落盘", () => {
  const list = makeList();
  const raw = core.serializeStore({ items: list, currentId: list[0].id });
  assert.equal(raw.includes("48213907"), false, "默认模式不该把密码写进存储");
  const back = core.parseStore(raw);
  assert.equal(back.rememberPins, false);
  assert.equal(back.items.every((m) => !m.pin), true);
  assert.equal(back.items.length, 3);
});

test("记住密码：打开后密码能存能读", () => {
  const list = makeList();
  const raw = core.serializeStore({ items: list, currentId: list[0].id, rememberPins: true });
  assert.equal(raw.includes("48213907"), true);
  const back = core.parseStore(raw);
  assert.equal(back.rememberPins, true);
  assert.equal(back.items[0].pin, "48213907");
});

test("记住密码：内存表里的密码在开启时也能合进来", () => {
  const list = core.stripPins(makeList());
  const raw = core.serializeStore({
    items: list,
    currentId: list[0].id,
    rememberPins: true,
    pins: { [list[0].id]: "77777777" },
  });
  const back = core.parseStore(raw);
  assert.equal(back.items[0].pin, "77777777");
  assert.ok(!back.items[1].pin, "没密码的机器读回来应该是空");
});

test("记住密码：老数据（有 pin 没开关）默认按关处理并清掉明文", () => {
  const legacy = JSON.stringify({ v: 1, items: makeList(), currentId: null });
  const back = core.parseStore(legacy);
  assert.equal(back.rememberPins, false);
  assert.equal(back.items.every((m) => !m.pin), true);
  assert.equal(back.items.length, 3);
});

test("密码取值：机器记录优先，内存表兜底，都没有给空", () => {
  assert.equal(core.pinOf({ id: "a", pin: "111" }, {}), "111");
  assert.equal(core.pinOf({ id: "b" }, { b: "222" }), "222");
  assert.equal(core.pinOf({ id: "c" }, {}), "");
  assert.equal(core.pinOf(null, { c: "333" }), "");
});

test("stripPins / withPins：只动密码，其它字段不变", () => {
  const list = makeList();
  const stripped = core.stripPins(list);
  assert.equal(stripped.length, 3);
  assert.equal(stripped.every((m) => !m.pin), true);
  assert.equal(stripped[0].id, list[0].id);
  assert.equal(stripped[0].host, list[0].host);
  const merged = core.withPins(stripped, { [stripped[0].id]: "999" });
  assert.equal(merged[0].pin, "999");
  assert.equal(merged[1].pin, undefined);
});

test("探测结果归类：成功 / 超时 / 网络异常", () => {
  assert.deepEqual(plain(core.classifyProbe({ ok: true })), { state: "online", reason: "ok" });
  assert.deepEqual(plain(core.classifyProbe({ ok: false, name: "AbortError" })), { state: "offline", reason: "timeout" });
  assert.deepEqual(plain(core.classifyProbe({ ok: false, name: "TypeError" })), { state: "offline", reason: "network" });
  assert.deepEqual(plain(core.classifyProbe({ ok: false, name: "Error", timeout: true })), { state: "offline", reason: "timeout" });
  assert.deepEqual(plain(core.classifyProbe(null)), { state: "offline", reason: "network" });
});

test("探测常量跟需求一致（30 秒一轮 / 5 秒超时）", () => {
  assert.equal(core.PROBE_INTERVAL_MS, 30000);
  assert.equal(core.PROBE_TIMEOUT_MS, 5000);
  assert.equal(core.STORE_KEY, "dsh-phone-status.machines.v1");
});

