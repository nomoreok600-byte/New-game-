#!/usr/bin/env node
// Generates Nova Pop launcher icons as PNGs (pure Node, no dependencies).
// 192 and 512 standard + maskable (with safe-zone padding).
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { crc32 } from "node:zlib";

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makeIcon(size, { maskable = false } = {}) {
  const pixels = Buffer.alloc(size * size * 3);
  const bg = [7, 11, 20];

  const cx = size / 2;
  const cy = size / 2;
  // Draw on a virtual 0..1 grid, scaled up.
  const S = maskable ? size * 0.72 : size * 0.86; // content scale (safe zone for maskable)
  const O = (size - S) / 2; // content offset
  const unit = S / 4; // 4x4 grid of rounded squares
  const pad = unit * 0.08;
  const cell = unit - pad * 2;
  const radius = cell * 0.28;

  const cells = [
    { gx: 0, gy: 0, a: 1.0, c: [129, 140, 248] },
    { gx: 1, gy: 0, a: 0.72, c: [236, 72, 153] },
    { gx: 0, gy: 1, a: 0.72, c: [251, 191, 36] },
    { gx: 1, gy: 1, a: 1.0, c: [99, 102, 241] },
  ];

  function inRoundedRect(x, y, rx, ry, w, h, r) {
    if (x < rx || x > rx + w || y < ry || y > ry + h) return false;
    const nx = Math.max(rx + r - x, 0, x - (rx + w - r));
    const ny = Math.max(ry + r - y, 0, y - (ry + h - r));
    return nx * nx + ny * ny <= r * r;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let color = bg;
      // subtle radial glow
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy) / (size * 0.7);
      const glow = [Math.round(bg[0] + 24 * (1 - d)), Math.round(bg[1] + 30 * (1 - d)), Math.round(bg[2] + 52 * (1 - d))];
      color = glow;
      for (const c of cells) {
        const rx = O + c.gx * unit + pad;
        const ry = O + c.gy * unit + pad;
        if (inRoundedRect(x + 0.5, y + 0.5, rx, ry, cell, cell, radius)) {
          const shade = 1 - 0.25 * (((x - rx) / cell + (y - ry) / cell) / 2);
          color = [Math.round(c.c[0] * shade), Math.round(c.c[1] * shade), Math.round(c.c[2] * shade)];
          break;
        }
      }
      const i = (y * size + x) * 3;
      pixels[i] = color[0];
      pixels[i + 1] = color[1];
      pixels[i + 2] = color[2];
    }
  }

  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public", { recursive: true });
writeFileSync("public/icon-192.png", makeIcon(192));
writeFileSync("public/icon-512.png", makeIcon(512));
writeFileSync("public/icon-maskable-512.png", makeIcon(512, { maskable: true }));
console.log("Icons written to public/: icon-192.png, icon-512.png, icon-maskable-512.png");
