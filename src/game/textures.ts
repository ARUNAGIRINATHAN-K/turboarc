import * as THREE from 'three';
import { CarSpec, RoofSymbol } from './types';

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function drawSymbolPath(ctx: CanvasRenderingContext2D, symbol: RoofSymbol, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  if (symbol === 'diamond') {
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
  } else if (symbol === 'chevron') {
    ctx.moveTo(cx - r, cy + r * 0.6);
    ctx.lineTo(cx, cy - r * 0.8);
    ctx.lineTo(cx + r, cy + r * 0.6);
    ctx.lineTo(cx + r * 0.55, cy + r * 0.6);
    ctx.lineTo(cx, cy - r * 0.15);
    ctx.lineTo(cx - r * 0.55, cy + r * 0.6);
    ctx.closePath();
  } else if (symbol === 'bolt') {
    ctx.moveTo(cx + r * 0.25, cy - r);
    ctx.lineTo(cx - r * 0.65, cy + r * 0.1);
    ctx.lineTo(cx + r * 0.05, cy + r * 0.1);
    ctx.lineTo(cx - r * 0.25, cy + r);
    ctx.lineTo(cx + r * 0.65, cy - r * 0.1);
    ctx.lineTo(cx - r * 0.05, cy - r * 0.1);
    ctx.closePath();
  } else if (symbol === 'shield') {
    ctx.moveTo(cx - r * 0.8, cy - r * 0.85);
    ctx.lineTo(cx + r * 0.8, cy - r * 0.85);
    ctx.lineTo(cx + r * 0.8, cy + r * 0.1);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r * 0.8, cy + r * 0.1);
    ctx.closePath();
  } else if (symbol === 'star') {
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 === 0 ? r : r * 0.44;
      const px = cx + Math.cos(ang) * rad;
      const py = cy + Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else {
    // comet: triangle + streak
    ctx.moveTo(cx + r, cy);
    ctx.lineTo(cx - r * 0.75, cy - r * 0.78);
    ctx.lineTo(cx - r * 0.35, cy);
    ctx.lineTo(cx - r * 0.75, cy + r * 0.78);
    ctx.closePath();
  }
}

export function createCarRoofDecalTexture(spec: CarSpec, maxAniso: number): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = spec.secondaryHex;
  ctx.fillRect(0, 0, 256, 256);

  // Contrasting side borders
  ctx.fillStyle = spec.colorHex;
  ctx.fillRect(0, 0, 26, 256);
  ctx.fillRect(230, 0, 26, 256);

  // Symbol at top of roof
  ctx.fillStyle = spec.isPlayer ? '#06b6d4' : spec.colorHex;
  drawSymbolPath(ctx, spec.symbol, 128, 62, 32);
  ctx.fill();

  // Large readable racing number
  ctx.fillStyle = spec.isPlayer ? '#0f172a' : '#ffffff';
  ctx.font = '900 108px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(spec.number, 128, 174);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

export function createNameplateTexture(spec: CarSpec): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(320, 88);
  ctx.clearRect(0, 0, 320, 88);

  // Badge background
  ctx.fillStyle = spec.isPlayer ? 'rgba(6, 182, 212, 0.94)' : 'rgba(11, 15, 25, 0.88)';
  ctx.beginPath();
  ctx.roundRect(8, 10, 304, 68, 14);
  ctx.fill();

  ctx.lineWidth = 4;
  ctx.strokeStyle = spec.isPlayer ? '#ffffff' : spec.colorHex;
  ctx.stroke();

  // Symbol
  ctx.fillStyle = spec.isPlayer ? '#0f172a' : spec.colorHex;
  drawSymbolPath(ctx, spec.symbol, 42, 44, 16);
  ctx.fill();

  // Number + Name
  ctx.fillStyle = spec.isPlayer ? '#0f172a' : '#ffffff';
  ctx.font = '900 32px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${spec.number} ${spec.name}`, 72, 46);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createSignTexture(
  headline: string,
  subline: string,
  bgHex: string,
  accentHex: string,
  textHex: string,
  maxAniso: number
): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 256);
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 512, 256);

  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 0, 512, 24);
  ctx.fillRect(0, 232, 512, 24);

  ctx.fillStyle = textHex;
  ctx.font = '900 84px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(headline, 256, subline ? 104 : 128);

  if (subline) {
    ctx.fillStyle = accentHex;
    ctx.font = '800 38px system-ui, -apple-system, sans-serif';
    ctx.fillText(subline, 256, 184);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

export function createAsphaltTexture(maxAniso: number): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = '#262930';
  ctx.fillRect(0, 0, 512, 512);

  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0.18)');
  grad.addColorStop(0.15, 'rgba(0,0,0,0.0)');
  grad.addColorStop(0.35, 'rgba(0,0,0,0.14)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.03)');
  grad.addColorStop(0.65, 'rgba(0,0,0,0.14)');
  grad.addColorStop(0.85, 'rgba(0,0,0,0.0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 6500; i++) {
    const x = (i * 73) % 512;
    const y = ((i * 197) + Math.floor(i / 512) * 31) % 512;
    const lum = i % 5 === 0 ? 62 : i % 3 === 0 ? 48 : 30;
    ctx.fillStyle = `rgb(${lum},${lum + 2},${lum + 6})`;
    ctx.fillRect(x, y, 2, 2);
  }

  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(10, 0, 12, 512);
  ctx.fillRect(490, 0, 12, 512);

  ctx.fillStyle = 'rgba(241, 245, 249, 0.45)';
  for (let y = 0; y < 512; y += 128) {
    ctx.fillRect(253, y + 16, 6, 68);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  return tex;
}

export function createKerbTexture(maxAniso: number): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 256);
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(0, 0, 64, 128);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 128, 64, 128);
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  ctx.fillRect(0, 0, 6, 256);
  ctx.fillRect(58, 0, 6, 256);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  return tex;
}

export function createGrassTexture(maxAniso: number): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = '#3b7a2c';
  ctx.fillRect(0, 0, 512, 512);

  ctx.fillStyle = '#448832';
  for (let y = 0; y < 512; y += 64) {
    ctx.fillRect(0, y, 512, 32);
  }

  for (let i = 0; i < 4000; i++) {
    const x = (i * 131) % 512;
    const y = (i * 257) % 512;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(30,70,20,0.35)' : 'rgba(130,190,80,0.22)';
    ctx.fillRect(x, y, 3, 2);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(60, 60);
  tex.anisotropy = maxAniso;
  return tex;
}

export function createCheckerTexture(maxAniso: number): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 128);
  const size = 32;
  for (let y = 0; y < 128; y += size) {
    for (let x = 0; x < 512; x += size) {
      const dark = (x / size + y / size) % 2 === 0;
      ctx.fillStyle = dark ? '#0f172a' : '#f8fafc';
      ctx.fillRect(x, y, size, size);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

export function createGantryBannerTexture(maxAniso: number): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(1024, 192);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 1024, 192);

  ctx.fillStyle = '#06b6d4';
  ctx.fillRect(0, 0, 1024, 14);
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(0, 178, 1024, 14);

  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? '#f8fafc' : '#1e293b';
      ctx.fillRect(24 + col * 24, 48 + row * 24, 24, 24);
      ctx.fillRect(1024 - 120 + col * 24, 48 + row * 24, 24, 24);
    }
  }

  ctx.fillStyle = '#f8fafc';
  ctx.font = '900 64px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TURBOVEX 2.0  ·  APEX GP', 512, 98);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  const grad = ctx.createRadialGradient(64, 64, 10, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.36)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCrowdTexture(maxAniso: number): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 256);
  ctx.fillStyle = '#334155';
  ctx.fillRect(0, 0, 512, 256);
  const palette = ['#06b6d4', '#ef4444', '#eab308', '#f8fafc', '#84cc16', '#9333ea', '#f97316'];
  for (let row = 0; row < 16; row++) {
    ctx.fillStyle = row % 2 === 0 ? '#475569' : '#334155';
    ctx.fillRect(0, row * 16, 512, 16);
    for (let col = 0; col < 48; col++) {
      if ((row * 37 + col * 19) % 7 === 0) continue;
      const color = palette[(row * 13 + col * 7) % palette.length];
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(6 + col * 10.6 + (row % 2) * 3, 8 + row * 16, 4.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  return tex;
}
