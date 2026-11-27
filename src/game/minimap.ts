import { CircuitTrack } from './track';
import { CarState } from './types';

export class MinimapRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scale: number;
  private offsetX: number;
  private offsetZ: number;
  private bgCanvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, track: CircuitTrack) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;

    const pad = 18;
    const w = canvas.width;
    const h = canvas.height;
    const spanX = track.bounds.maxX - track.bounds.minX;
    const spanZ = track.bounds.maxZ - track.bounds.minZ;
    this.scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanZ);
    const drawnW = spanX * this.scale;
    const drawnH = spanZ * this.scale;
    this.offsetX = (w - drawnW) * 0.5 - track.bounds.minX * this.scale;
    this.offsetZ = (h - drawnH) * 0.5 - track.bounds.minZ * this.scale;

    this.bgCanvas = document.createElement('canvas');
    this.bgCanvas.width = w;
    this.bgCanvas.height = h;
    const bctx = this.bgCanvas.getContext('2d')!;

    bctx.clearRect(0, 0, w, h);

    bctx.beginPath();
    for (let i = 0; i < track.count; i += 2) {
      const sp = track.samples[i];
      const px = sp.x * this.scale + this.offsetX;
      const py = sp.z * this.scale + this.offsetZ;
      if (i === 0) bctx.moveTo(px, py);
      else bctx.lineTo(px, py);
    }
    bctx.closePath();
    bctx.lineJoin = 'round';
    bctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
    bctx.lineWidth = 11;
    bctx.stroke();

    bctx.strokeStyle = 'rgba(226, 232, 240, 0.85)';
    bctx.lineWidth = 5;
    bctx.stroke();

    // Start/finish checkered marker
    const s0 = track.samples[0];
    const sx = s0.x * this.scale + this.offsetX;
    const sy = s0.z * this.scale + this.offsetZ;
    bctx.strokeStyle = '#06b6d4';
    bctx.lineWidth = 3.5;
    bctx.beginPath();
    bctx.moveTo(sx - s0.nx * 7, sy - s0.nz * 7);
    bctx.lineTo(sx + s0.nx * 7, sy + s0.nz * 7);
    bctx.stroke();
  }

  render(cars: CarState[]): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.bgCanvas, 0, 0);

    // Draw opponents first, then player on top
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i];
        const isPlayer = car.spec.isPlayer;
        if ((pass === 0 && isPlayer) || (pass === 1 && !isPlayer)) continue;

        const px = car.x * this.scale + this.offsetX;
        const py = car.z * this.scale + this.offsetZ;

        if (isPlayer) {
          // Cyan player directional arrow/diamond + bright white/cyan halo
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(car.heading);
          ctx.beginPath();
          ctx.arc(0, 0, 9.5, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(6, 182, 212, 0.28)';
          ctx.fill();

          ctx.beginPath();
          ctx.moveTo(8, 0);
          ctx.lineTo(-5, -5.5);
          ctx.lineTo(-3, 0);
          ctx.lineTo(-5, 5.5);
          ctx.closePath();
          ctx.fillStyle = '#06b6d4';
          ctx.fill();
          ctx.lineWidth = 1.8;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(px, py, 6.2, 0, Math.PI * 2);
          ctx.fillStyle = car.spec.colorHex;
          ctx.fill();
          ctx.lineWidth = 1.4;
          ctx.strokeStyle = '#0f172a';
          ctx.stroke();

          ctx.fillStyle = car.index === 2 ? '#0f172a' : '#ffffff';
          ctx.font = '800 7.5px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(car.spec.number, px, py + 0.5);
        }
      }
    }
  }
}
