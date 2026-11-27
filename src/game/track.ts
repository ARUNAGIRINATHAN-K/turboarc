import { CarSpec } from './types';

export interface TrackSample {
  s: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  kappa: number;
  racingOffset: number;
  /** 0 = safe green throttle, 0.5 = yellow approach, 1 = red braking zone */
  brakeIntensity: number;
}

export interface TrackProjection {
  idx: number;
  s: number;
  d: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  kappa: number;
  racingOffset: number;
}

export interface CornerMarker {
  cornerNumber: number;
  label: string;
  apexS: number;
  turnDir: number; // +1 right, -1 left
  hasBrakingBoards: boolean;
}

export const ROAD_HALF_WIDTH = 8.5; // 17m wide asphalt
export const KERB_WIDTH = 0.95;
export const BARRIER_HALF_WIDTH = 11.2; // 22.4m between outer barriers

const CONTROL_POINTS: Array<[number, number]> = [
  [-120, 0],
  [-40, 0],
  [40, 0],
  [125, 0],    // End of long main straight
  [195, 14],   // Turn 1 entry
  [235, 62],   // Fast sweeper apex
  [215, 125],  // Sweeper exit
  [155, 155],  // Turn 2 S-entry
  [105, 195],  // Turn 3 sweeper crest
  [40, 225],   // Back straight entry
  [-45, 220],  // Back straight
  [-115, 200], // Heavy braking into hairpin
  [-168, 228], // Turn 4 Tight Hairpin entry
  [-195, 200], // Tight Hairpin apex
  [-165, 165], // Tight Hairpin exit
  [-95, 152],  // Acceleration chute
  [-65, 110],  // Turn 5 Chicane left
  [-115, 75],  // Turn 6 Chicane right
  [-175, 48],  // Final sweeper entry
  [-180, 12],  // Final corner exit onto main straight
];

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

export class CircuitTrack {
  readonly samples: TrackSample[];
  readonly totalLength: number;
  readonly count: number;
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  readonly corners: CornerMarker[];

  constructor(sampleCount = 640) {
    this.count = sampleCount;

    const denseN = 4000;
    const nCtrl = CONTROL_POINTS.length;
    const denseX = new Float64Array(denseN);
    const denseZ = new Float64Array(denseN);
    const cumLen = new Float64Array(denseN + 1);

    for (let i = 0; i < denseN; i++) {
      const u = (i / denseN) * nCtrl;
      const seg = Math.floor(u) % nCtrl;
      const t = u - Math.floor(u);
      const p0 = CONTROL_POINTS[(seg - 1 + nCtrl) % nCtrl];
      const p1 = CONTROL_POINTS[seg];
      const p2 = CONTROL_POINTS[(seg + 1) % nCtrl];
      const p3 = CONTROL_POINTS[(seg + 2) % nCtrl];
      denseX[i] = catmullRom(p0[0], p1[0], p2[0], p3[0], t);
      denseZ[i] = catmullRom(p0[1], p1[1], p2[1], p3[1], t);
    }

    let total = 0;
    cumLen[0] = 0;
    for (let i = 0; i < denseN; i++) {
      const next = (i + 1) % denseN;
      const dx = denseX[next] - denseX[i];
      const dz = denseZ[next] - denseZ[i];
      total += Math.hypot(dx, dz);
      cumLen[i + 1] = total;
    }
    this.totalLength = total;

    const rawSamples: Array<{ s: number; x: number; z: number }> = [];
    let denseIdx = 0;
    for (let i = 0; i < sampleCount; i++) {
      const targetS = (i / sampleCount) * total;
      while (denseIdx < denseN - 1 && cumLen[denseIdx + 1] < targetS) {
        denseIdx++;
      }
      const s0 = cumLen[denseIdx];
      const s1 = cumLen[denseIdx + 1];
      const alpha = s1 > s0 ? (targetS - s0) / (s1 - s0) : 0;
      const next = (denseIdx + 1) % denseN;
      rawSamples.push({
        s: targetS,
        x: denseX[denseIdx] + (denseX[next] - denseX[denseIdx]) * alpha,
        z: denseZ[denseIdx] + (denseZ[next] - denseZ[denseIdx]) * alpha,
      });
    }

    const ds = total / sampleCount;
    const samples: TrackSample[] = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i < sampleCount; i++) {
      const prev = rawSamples[(i - 1 + sampleCount) % sampleCount];
      const curr = rawSamples[i];
      const next = rawSamples[(i + 1) % sampleCount];
      const dx = next.x - prev.x;
      const dz = next.z - prev.z;
      const len = Math.hypot(dx, dz) || 1;
      const tx = dx / len;
      const tz = dz / len;
      const nx = -tz;
      const nz = tx;

      if (curr.x < minX) minX = curr.x;
      if (curr.x > maxX) maxX = curr.x;
      if (curr.z < minZ) minZ = curr.z;
      if (curr.z > maxZ) maxZ = curr.z;

      samples.push({
        s: curr.s,
        x: curr.x,
        z: curr.z,
        tx,
        tz,
        nx,
        nz,
        kappa: 0,
        racingOffset: 0,
        brakeIntensity: 0,
      });
    }

    this.bounds = { minX, maxX, minZ, maxZ };

    const win = 4;
    const rawKappa = new Float64Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      const p = samples[(i - win + sampleCount) % sampleCount];
      const n = samples[(i + win) % sampleCount];
      const cross = p.tx * n.tz - p.tz * n.tx;
      const dot = Math.max(-1, Math.min(1, p.tx * n.tx + p.tz * n.tz));
      const dTheta = Math.atan2(cross, dot);
      rawKappa[i] = dTheta / (2 * win * ds);
    }

    for (let i = 0; i < sampleCount; i++) {
      let sum = 0;
      for (let k = -3; k <= 3; k++) {
        sum += rawKappa[(i + k + sampleCount) % sampleCount];
      }
      samples[i].kappa = sum / 7;
    }

    const rawOffset = new Float64Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      const kLocal = samples[i].kappa;
      const kAhead = samples[(i + 14) % sampleCount].kappa;
      const kBehind = samples[(i - 14 + sampleCount) % sampleCount].kappa;
      const apexPull = Math.tanh(kLocal * 42) * 5.2;
      const entrySwing = -Math.tanh(kAhead * 36) * 3.0;
      const exitSwing = -Math.tanh(kBehind * 36) * 2.4;
      rawOffset[i] = Math.max(-5.5, Math.min(5.5, apexPull + entrySwing * 0.55 + exitSwing * 0.45));
    }

    let smoothed = Float64Array.from(rawOffset);
    for (let pass = 0; pass < 12; pass++) {
      const nextArr = new Float64Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        const a = smoothed[(i - 1 + sampleCount) % sampleCount];
        const b = smoothed[i];
        const c = smoothed[(i + 1) % sampleCount];
        nextArr[i] = a * 0.25 + b * 0.5 + c * 0.25;
      }
      smoothed = nextArr;
    }

    for (let i = 0; i < sampleCount; i++) {
      samples[i].racingOffset = smoothed[i];
    }

    // Compute dynamic racing line brakeIntensity (0=green, 0.5=yellow, 1=red)
    // Based on how much a top-speed car must decelerate for upcoming curvature
    const maxStraightSpeed = 70;
    const rawBrake = new Float64Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      let maxBrakeDemand = 0;
      // Scan ahead up to 110m
      for (let step = 0; step <= 55; step += 2) {
        const idxAhead = (i + step) % sampleCount;
        const dist = step * ds;
        const absK = Math.abs(samples[idxAhead].kappa);
        if (absK > 0.008) {
          const latBudget = absK > 0.022 ? 15.8 : 19.5;
          const cornerSpeed = Math.sqrt(latBudget / absK);
          const safeApproach = Math.sqrt(cornerSpeed * cornerSpeed + 2 * 22.0 * dist);
          if (safeApproach < maxStraightSpeed) {
            const demand = Math.min(1, (maxStraightSpeed - safeApproach) / 34);
            if (demand > maxBrakeDemand) maxBrakeDemand = demand;
          }
        }
      }
      rawBrake[i] = maxBrakeDemand;
    }

    // Smooth brakeIntensity for gradual Green -> Yellow -> Red transitions
    let smoothBrake = Float64Array.from(rawBrake);
    for (let pass = 0; pass < 6; pass++) {
      const nextArr = new Float64Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        const a = smoothBrake[(i - 1 + sampleCount) % sampleCount];
        const b = smoothBrake[i];
        const c = smoothBrake[(i + 1) % sampleCount];
        nextArr[i] = a * 0.25 + b * 0.5 + c * 0.25;
      }
      smoothBrake = nextArr;
    }
    for (let i = 0; i < sampleCount; i++) {
      samples[i].brakeIntensity = Math.max(0, Math.min(1, smoothBrake[i]));
    }

    this.samples = samples;

    // Identify major corners by local curvature peaks for corner signage & braking boards
    this.corners = this.detectCornerMarkers();
  }

  private detectCornerMarkers(): CornerMarker[] {
    const markers: CornerMarker[] = [];
    const minGapS = 85;
    let cornerNum = 1;

    // Find curvature peaks
    const peaks: Array<{ idx: number; absK: number; dir: number }> = [];
    for (let i = 0; i < this.count; i++) {
      const k = this.samples[i].kappa;
      const ak = Math.abs(k);
      if (ak < 0.012) continue;
      const prev = Math.abs(this.samples[(i - 2 + this.count) % this.count].kappa);
      const next = Math.abs(this.samples[(i + 2) % this.count].kappa);
      if (ak >= prev && ak >= next) {
        peaks.push({ idx: i, absK: ak, dir: k >= 0 ? 1 : -1 });
      }
    }

    // Filter out peaks too close to each other (keep strongest)
    const chosen: Array<{ idx: number; absK: number; dir: number }> = [];
    for (const p of peaks) {
      const s = this.samples[p.idx].s;
      const tooClose = chosen.find((c) => {
        const cs = this.samples[c.idx].s;
        const d = Math.min(Math.abs(s - cs), this.totalLength - Math.abs(s - cs));
        return d < minGapS;
      });
      if (!tooClose) {
        chosen.push(p);
      } else if (p.absK > tooClose.absK) {
        tooClose.idx = p.idx;
        tooClose.absK = p.absK;
        tooClose.dir = p.dir;
      }
    }

    chosen.sort((a, b) => a.idx - b.idx);
    for (const c of chosen) {
      const isHairpin = c.absK > 0.026;
      markers.push({
        cornerNumber: cornerNum,
        label: isHairpin ? `T${cornerNum} HAIRPIN` : `T${cornerNum}`,
        apexS: this.samples[c.idx].s,
        turnDir: c.dir,
        hasBrakingBoards: c.absK > 0.015,
      });
      cornerNum++;
    }
    return markers;
  }

  sampleAtS(s: number): TrackSample {
    const wrapped = ((s % this.totalLength) + this.totalLength) % this.totalLength;
    const fIdx = (wrapped / this.totalLength) * this.count;
    const i0 = Math.floor(fIdx) % this.count;
    const i1 = (i0 + 1) % this.count;
    const t = fIdx - Math.floor(fIdx);
    const a = this.samples[i0];
    const b = this.samples[i1];
    const tx = a.tx + (b.tx - a.tx) * t;
    const tz = a.tz + (b.tz - a.tz) * t;
    const len = Math.hypot(tx, tz) || 1;
    const utx = tx / len;
    const utz = tz / len;
    return {
      s: wrapped,
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      tx: utx,
      tz: utz,
      nx: -utz,
      nz: utx,
      kappa: a.kappa + (b.kappa - a.kappa) * t,
      racingOffset: a.racingOffset + (b.racingOffset - a.racingOffset) * t,
      brakeIntensity: a.brakeIntensity + (b.brakeIntensity - a.brakeIntensity) * t,
    };
  }

  project(x: number, z: number, hintIdx?: number): TrackProjection {
    let bestIdx = 0;
    let bestDistSq = Infinity;

    if (hintIdx !== undefined && hintIdx >= 0 && hintIdx < this.count) {
      const searchSpan = 32;
      for (let off = -searchSpan; off <= searchSpan; off++) {
        const i = (hintIdx + off + this.count) % this.count;
        const sp = this.samples[i];
        const dx = x - sp.x;
        const dz = z - sp.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestIdx = i;
        }
      }
    }

    if (bestDistSq > 900 || hintIdx === undefined) {
      bestDistSq = Infinity;
      for (let i = 0; i < this.count; i++) {
        const sp = this.samples[i];
        const dx = x - sp.x;
        const dz = z - sp.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestIdx = i;
        }
      }
    }

    const sp = this.samples[bestIdx];
    const dx = x - sp.x;
    const dz = z - sp.z;
    const along = dx * sp.tx + dz * sp.tz;
    const exactS = ((sp.s + along) % this.totalLength + this.totalLength) % this.totalLength;
    const interp = this.sampleAtS(exactS);
    const rx = x - interp.x;
    const rz = z - interp.z;
    const d = rx * interp.nx + rz * interp.nz;

    return {
      idx: bestIdx,
      s: exactS,
      d,
      x: interp.x,
      z: interp.z,
      tx: interp.tx,
      tz: interp.tz,
      nx: interp.nx,
      nz: interp.nz,
      kappa: interp.kappa,
      racingOffset: interp.racingOffset,
    };
  }
}

export const DEFAULT_CAR_SPECS: CarSpec[] = [
  {
    index: 0,
    number: '00',
    name: 'PLAYER',
    colorHex: '#06b6d4',
    secondaryHex: '#f8fafc',
    colorNum: 0x06b6d4,
    accentNum: 0xf8fafc,
    symbol: 'diamond',
    personality: 'balanced',
    isPlayer: true,
    baseSkill: 1.0,
    aggression: 0.78,
    mistakeRate: 0.0,
    straightBoost: 1.0,
    cornerGripSkill: 1.0,
    cornerCaution: 1.0,
  },
  {
    index: 1,
    number: '07',
    name: 'RAZOR',
    colorHex: '#ef4444',
    secondaryHex: '#111827',
    colorNum: 0xef4444,
    accentNum: 0x111827,
    symbol: 'chevron',
    personality: 'aggressive',
    isPlayer: false,
    baseSkill: 0.985,
    aggression: 0.96,
    mistakeRate: 0.24,
    straightBoost: 1.01,
    cornerGripSkill: 1.0,
    cornerCaution: 0.96,
  },
  {
    index: 2,
    number: '12',
    name: 'BLAZE',
    colorHex: '#eab308',
    secondaryHex: '#111827',
    colorNum: 0xeab308,
    accentNum: 0x111827,
    symbol: 'bolt',
    personality: 'speedster',
    isPlayer: false,
    baseSkill: 0.975,
    aggression: 0.72,
    mistakeRate: 0.22,
    straightBoost: 1.055,
    cornerGripSkill: 0.96,
    cornerCaution: 1.05,
  },
  {
    index: 3,
    number: '18',
    name: 'MOSS',
    colorHex: '#84cc16',
    secondaryHex: '#1e293b',
    colorNum: 0x84cc16,
    accentNum: 0x1e293b,
    symbol: 'shield',
    personality: 'defensive',
    isPlayer: false,
    baseSkill: 0.955,
    aggression: 0.45,
    mistakeRate: 0.14,
    straightBoost: 0.98,
    cornerGripSkill: 0.99,
    cornerCaution: 1.08,
  },
  {
    index: 4,
    number: '23',
    name: 'NOVA',
    colorHex: '#9333ea',
    secondaryHex: '#111827',
    colorNum: 0x9333ea,
    accentNum: 0x111827,
    symbol: 'star',
    personality: 'cornering',
    isPlayer: false,
    baseSkill: 0.968,
    aggression: 0.62,
    mistakeRate: 0.1,
    straightBoost: 0.965,
    cornerGripSkill: 1.06,
    cornerCaution: 0.94,
  },
  {
    index: 5,
    number: '31',
    name: 'COMET',
    colorHex: '#f97316',
    secondaryHex: '#111827',
    colorNum: 0xf97316,
    accentNum: 0x111827,
    symbol: 'comet',
    personality: 'opportunistic',
    isPlayer: false,
    baseSkill: 0.945,
    aggression: 0.84,
    mistakeRate: 0.28,
    straightBoost: 1.0,
    cornerGripSkill: 0.98,
    cornerCaution: 1.0,
  },
];
