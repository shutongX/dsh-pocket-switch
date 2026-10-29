// 主页图标：运行时生成 PNG（不引第三方库，也不用外部图片）。
// 手机「添加到主屏幕」时 iOS/Android 都认这个图标，看起来才像个 App。
import { deflateSync } from 'node:zlib';

const BG = [79, 110, 247]; // #4F6EF7
const FG = [255, 255, 255];
const SS = 4; // 4x 超采样，抗锯齿

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ table[(crc ^ buffer[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function inRoundedRect(x, y, size, radius) {
  const r = radius;
  if (x >= r && x <= size - r) return true;
  if (y >= r && y <= size - r) return true;
  const cx = x < r ? r : size - r;
  const cy = y < r ? r : size - r;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const sign = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = sign(px, py, ax, ay, bx, by);
  const d2 = sign(px, py, bx, by, cx, cy);
  const d3 = sign(px, py, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function drawArrow(x, y, size, dir, yCenter) {
  const t = size * 0.085;
  const head = size * 0.17;
  const left = size * 0.2;
  const right = size * 0.8;
  const cy = size * yCenter;
  const shaftStart = dir > 0 ? left : left + head;
  const shaftEnd = dir > 0 ? right - head : right;
  const inShaft = x >= shaftStart - t / 2 && x <= shaftEnd + t / 2 && Math.abs(y - cy) <= t / 2;
  if (inShaft) return true;
  if (dir > 0) return inTriangle(x, y, right - head, cy - t * 1.15, right - head, cy + t * 1.15, right, cy);
  return inTriangle(x, y, left + head, cy - t * 1.15, left + head, cy + t * 1.15, left, cy);
}

const cache = new Map();

export function renderIcon(size = 192) {
  if (cache.has(size)) return cache.get(size);
  const big = size * SS;
  const acc = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = (x * SS + sx + 0.5) / SS;
          const py = (y * SS + sy + 0.5) / SS;
          const inside = inRoundedRect(px, py, size, radius);
          if (!inside) continue;
          const arrow = drawArrow(px, py, size, 1, 0.38) || drawArrow(px, py, size, -1, 0.62);
          const color = arrow ? FG : BG;
          r += color[0];
          g += color[1];
          b += color[2];
          a += 255;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      if (a === 0) continue;
      acc[i] = Math.round(r / n);
      acc[i + 1] = Math.round(g / n);
      acc[i + 2] = Math.round(b / n);
      acc[i + 3] = Math.round(a / n);
    }
  }
  const png = encodePng(size, size, acc);
  cache.set(size, png);
  return png;
}
