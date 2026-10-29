#!/usr/bin/env node
/**
 * 直接读 APK 的 zip 中央目录原始字节，打印条目名并检查分隔符。
 * 用途：PowerShell/.NET/7z 在 Windows 上都可能把 '/' 显示或写成 '\\'，只有读原始字节才可信。
 * 用法：node check-apk-entries.cjs <apk路径>
 * 断言：assets/www/ 下五个文件都必须是正斜杠，且整包没有任何条目含反斜杠。
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const file = process.argv[2];
if (!file) {
  console.error("用法: node check-apk-entries.cjs <apk>");
  process.exit(2);
}
const buf = fs.readFileSync(file);

function findEocd(b) {
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i -= 1) {
    if (b.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

const eocd = findEocd(buf);
if (eocd < 0) {
  console.error("FAIL: 找不到 zip 中央目录结尾记录 (EOCD)");
  process.exit(1);
}
const count = buf.readUInt16LE(eocd + 10);
const cdOffset = buf.readUInt32LE(eocd + 16);

const names = [];
let pos = cdOffset;
for (let i = 0; i < count; i += 1) {
  if (buf.readUInt32LE(pos) !== 0x02014b50) {
    console.error("FAIL: 中央目录第 " + i + " 条签名不对 @ " + pos);
    process.exit(1);
  }
  const nameLen = buf.readUInt16LE(pos + 28);
  const extraLen = buf.readUInt16LE(pos + 30);
  const commentLen = buf.readUInt16LE(pos + 32);
  names.push(buf.toString("utf8", pos + 46, pos + 46 + nameLen));
  pos += 46 + nameLen + extraLen + commentLen;
}

console.log("APK: " + file + " (" + buf.length + " bytes)");
console.log("entries (" + names.length + "):");
for (const name of names) console.log("  " + JSON.stringify(name));

const expected = [
  "assets/www/index.html",
  "assets/www/app.js",
  "assets/www/style.css",
  "assets/www/icon.svg",
  "assets/www/manifest.webmanifest",
];
const problems = [];
for (const want of expected) {
  if (!names.includes(want)) problems.push("缺少条目: " + want);
}
for (const name of names) {
  if (name.includes("\\")) problems.push("条目名里有反斜杠: " + JSON.stringify(name));
}
const badAssets = names.filter((n) => n.startsWith("assets/") && !expected.includes(n));
if (badAssets.length) problems.push("assets/ 下有多余条目: " + badAssets.join(", "));

if (problems.length) {
  console.error("\nFAIL:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("\nPASS: 五个 assets 条目都是正斜杠，整包无反斜杠条目");
