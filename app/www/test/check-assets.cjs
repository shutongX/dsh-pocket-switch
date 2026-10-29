"use strict";
// 静态资源自检：index.html 无外链、manifest 合法、icon.svg 是 SVG 且有鱼。
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
let checks = 0;

function ok(label, detail) {
  checks += 1;
  console.log("PASS " + label + (detail ? " — " + detail : ""));
}

const html = read("index.html");
assert.doesNotMatch(html, /https?:\/\//i, "index.html 里不该有 http(s):// 外链");
ok("index.html 无 http(s) 外链", "0 处匹配");

for (const ref of ["style.css", "app.js", "manifest.webmanifest", "icon.svg"]) {
  assert.match(html, new RegExp('(?:\\./)?' + ref.replace(/\./g, "\\.")), "index.html 没引用 " + ref);
  assert.ok(fs.existsSync(path.join(root, ref)), "缺少文件 " + ref);
}
ok("index.html 引用的本地文件都在", "style.css / app.js / manifest / icon.svg");

const manifest = JSON.parse(read("manifest.webmanifest"));
assert.equal(manifest.name, "我的电脑");
assert.equal(manifest.short_name, "我的电脑");
assert.equal(manifest.display, "standalone");
assert.equal(manifest.theme_color, "#f4f1ea");
assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 3, "icons 至少三条");
assert.ok(manifest.icons.every((icon) => icon.src === "./icon.svg"), "icons 都指向 icon.svg");
const sizes = manifest.icons.map((icon) => icon.sizes);
assert.ok(sizes.includes("192x192") && sizes.includes("512x512") && sizes.includes("any"), "缺 192/512/any");
assert.ok(manifest.icons.some((icon) => String(icon.purpose).includes("maskable")), "缺 maskable");
ok("manifest 是合法 JSON 且字段齐全", manifest.name + " / " + manifest.display + " / " + sizes.join(","));

const icon = read("icon.svg");
assert.match(icon, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, "icon.svg 不是带 xmlns 的 SVG");
assert.match(icon, /<\/svg>\s*$/);
assert.match(icon, /<path\b/, "icon.svg 没有 path");
assert.match(icon, /fish/i, "icon.svg 没有 fish 标识");
const opens = (icon.match(/<svg\b/g) || []).length;
const closes = (icon.match(/<\/svg>/g) || []).length;
assert.equal(opens, closes, "svg 标签没闭合");
ok("icon.svg 结构合法且是鱼", "path=" + (icon.match(/<path\b/g) || []).length + " 个");

const appJs = read("app.js");
assert.match(appJs, /dsh-phone-status\.machines\.v1/);
assert.match(appJs, /module\.exports\s*=\s*api/);
ok("app.js 有本地存储 key 和 CommonJS 导出", "单测用 vm 加载");

console.log("\n" + checks + " 项检查全部通过");

