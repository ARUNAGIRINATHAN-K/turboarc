export interface TrackSample {
  index: number;
  x: number;
  z: number;
  tx: number; // unit forward tangent X
  tz: number; // unit forward tangent Z
  rx: number; // unit right normal X (left-to-right perpendicular in XZ plane)
  rz: number; // unit right normal Z
  s: number;  // cumulative arc length from start/finish (0 .. totalLength)
  curvature: number; // signed curvature (rad/m); positive = turning right, negative = turning left
  racingOffset: number; // preferred lateral offset (m) for optimal racing line
}

export interface TrackProjection {
  sampleIndex: number;
  s: number;
  lateral: number; // signed distance along right normal (+ = right, - = left)
  tx: number;
  tz: number;
  rx: number;
  rz: number;
  cx: number;
  cz: number;
  curvature: number;
  racingOffset: number;
}

export interface CircuitTrack {
  samples: TrackSample[];
  totalLength: number;
  roadHalfWidth: number;
  kerbWidth: number;
  barrierHalfWidth: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  sampleAtS(s: number): TrackSample;
  projectPoint(x: number, z: number, hintIndex?: number): TrackProjection;
  wrapS(s: number): number;
}

export const ROAD_HALF_WIDTH = 9.0;     // 18m total asphalt width
export const KERB_WIDTH = 1.35;         // 1.35m red/white kerbs outside asphalt
export const BARRIER_HALF_WIDTH = 11.2; // Physical barrier walls at ±11.2m

/**
 * Closed circuit control points (clockwise in XZ plane, starting at (0, 0) heading +Z).
 * Designed with:
 * - Long main start/finish straight along +Z
 * - Fast Turn 1 right-hand sweeper
 * - Flowing high-speed S-curves
 * - Back straight braking into a tight 180-degree hairpin
 * - Fast double-apex return back onto the main straight
 */
const CONTROL_POINTS: ReadonlyArray<[number, number]> = [
  [0, -90],
  [0, 10],      // Start/finish line at s ≈ 0..90
  [0, 125],     // End of main straight
  [35, 195],    // Fast Turn 1 entry
  [115, 225],   // Fast Turn 1 sweeper apex
  [215, 210],   // High-speed sweeper exit
  [280, 155],   // Sweeper kink right
  [265, 75],    // Chicane / S-curve left
  [315, 10],    // S-curve right
  [380, -35],   // Back straight entry
  [410, -125],  // Back straight fast braking zone
  [370, -185],  // Tight Hairpin entry
  [310, -170],  // Tight Hairpin apex
  [315, -105],  // Hairpin exit
  [245, -75],   // Technical kink left
  [175, -135],  // Fast Esses right
  [105, -175],  // Final long sweeping corner entry
  [25, -165],   // Final corner apex onto main straight
];

function catmullRomPoint(
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
  p3: readonly [number, number],
  t: number
): [number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  const x =
    0.5 *
    (2 * p1[0] +
      (-p0[0] + p2[0]) * t +
      (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
      (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
  const z =
    0.5 *
    (2 * p1[1] +
      (-p0[1] + p2[1]) * t +
      (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
      (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
  return [x, z];
}

function buildCircuit(): CircuitTrack {
  const nCtrl = CONTROL_POINTS.length;
  const rawCount = 1800;
  const rawPts: Array<[number, number]> = [];

  for (let i = 0; i < rawCount; i++) {
    const u = (i / rawCount) * nCtrl;
    const seg = Math.floor(u) % nCtrl;
    const t = u - Math.floor(u);
    const p0 = CONTROL_POINTS[(seg - 1 + nCtrl) % nCtrl];
    const p1 = CONTROL_POINTS[seg];
    const p2 = CONTROL_POINTS[(seg + 1) % nCtrl];
    const p3 = CONTROL_POINTS[(seg + 2) % nCtrl];
    rawPts.push(catmullRomPoint(p0, p1, p2, p3, t));
  }

  // Compute raw cumulative arc lengths and resample uniformly at N = 640 points
  const cumLen: number[] = [0];
  for (let i = 1; i <= rawCount; i++) {
    const prev = rawPts[i - 1];
    const curr = rawPts[i % rawCount];
    cumLen.push(cumLen[i - 1] + Math.hypot(curr[0] - prev[0], curr[1] - prev[1]));
  }
  const totalRawLength = cumLen[rawCount];

  // Shift arc length s = 0 to start/finish near x = 0, z = 0 (index near seg=1)
  // Find raw point closest to (0, 0) with +Z direction
  let startRawIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < rawCount; i++) {
    const [px, pz] = rawPts[i];
    const next = rawPts[(i + 1) % rawCount];
    if (next[1] - pz > 0) {
      const d = px * px + pz * pz;
      if (d < bestDist) {
        bestDist = d;
        startRawIdx = i;
      }
    }
  }

  const reorderedRaw: Array<[number, number]> = [];
  for (let i = 0; i < rawCount; i++) {
    reorderedRaw.push(rawPts[(startRawIdx + i) % rawCount]);
  }

  const rawS: number[] = [0];
  for (let i = 1; i <= rawCount; i++) {
    const a = reorderedRaw[i - 1];
    const b = reorderedRaw[i % rawCount];
    rawS.push(rawS[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const totalLength = rawS[rawCount];

  const sampleCount = 640;
  const pts: Array<[number, number]> = [];
  let rIdx = 0;
  for (let i = 0; i < sampleCount; i++) {
    const targetS = (i / sampleCount) * totalLength;
    while (rIdx < rawCount - 1 && rawS[rIdx + 1] < targetS) {
      rIdx++;
    }
    const s0 = rawS[rIdx];
    const s1 = rawS[rIdx + 1];
    const alpha = s1 > s0 ? (targetS - s0) / (s1 - s0) : 0;
    const pA = reorderedRaw[rIdx];
    const pB = reorderedRaw[(rIdx + 1) % rawCount];
    pts.push([pA[0] + (pB[0] - pA[0]) * alpha, pA[1] + (pB[1] - pA[1]) * alpha]);
  }

  // Build TrackSample entries with tangents, right normals, curvature
  const samples: TrackSample[] = [];
  let accS = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < sampleCount; i++) {
    const prev = pts[(i - 1 + sampleCount) % sampleCount];
    const curr = pts[i];
    const next = pts[(i + 1) % sampleCount];

    if (i > 0) {
      accS += Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
    }

    const dx = next[0] - prev[0];
    const dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    const tx = dx / len;
    const tz = dz / len;
    // Right normal in XZ plane when forward is (tx, tz) with +Y up:
    // For forward (0, 1) (+Z), right is (-1, 0) or (+1, 0)?
    // Wait: in Three.js, +Y up, +Z forward -> right-hand cross(forward, up) = (0,0,1) x (0,1,0) = (-1, 0, 0).
    // Let's check: cross(forward, up) = (tz * 0 - 0 * 1, ..., tx * 1 - tz * 0) -> wait:
    // (tx, 0, tz) x (0, 1, 0) = (0*0 - tz*1, tz*0 - tx*0, tx*1 - 0*0) = (-tz, 0, tx)!
    // Wait: if forward = (0, 0, 1) (+Z), looking down +Z with +Y up, -X is to the RIGHT, +X is to the LEFT!
    // Let's verify: in Three.js default camera at (0,0,5) looking at (0,0,0) (toward -Z): +X is right, -X is left.
    // When facing +Z (opposite), +X is LEFT and -X is RIGHT!
    // Using rx = -tz, rz = tx guarantees (tx, 0, tz) x (0, 1, 0) = (rx, 0, rz), i.e., true geometric right!
    const rx = -tz;
    const rz = tx;

    // Signed curvature from Menger curvature of (prev, curr, next)
    const ax = curr[0] - prev[0];
    const az = curr[1] - prev[1];
    const bx = next[0] - curr[0];
    const bz = next[1] - curr[1];
    const cross = ax * bz - az * bx; // positive when turning toward -Z x +X? Let's check sign with (rx, rz):
    // If forward = (0, 1), right = (-1, 0). Turning right means next has negative X: bx < 0, az > 0 => ax*bz - az*bx > 0!
    // So cross > 0 means turning RIGHT (positive lateral direction)!
    const da = Math.hypot(ax, az);
    const db = Math.hypot(bx, bz);
    const dc = Math.hypot(next[0] - prev[0], next[1] - prev[1]);
    const denom = da * db * dc || 1;
    const curvature = (2 * cross) / denom;

    minX = Math.min(minX, curr[0]);
    maxX = Math.max(maxX, curr[0]);
    minZ = Math.min(minZ, curr[1]);
    maxZ = Math.max(maxZ, curr[1]);

    samples.push({
      index: i,
      x: curr[0],
      z: curr[1],
      tx,
      tz,
      rx,
      rz,
      s: accS,
      curvature,
      racingOffset: 0,
    });
  }

  // Smooth curvature & compute optimal racing line offset (hug inside apex on corners, swing wide before/after)
  const smoothCurv = new Array<number>(sampleCount).fill(0);
  const window = 6;
  for (let i = 0; i < sampleCount; i++) {
    let sum = 0;
    for (let k = -window; k <= window; k++) {
      sum += samples[(i + k + sampleCount) % sampleCount].curvature;
    }
    smoothCurv[i] = sum / (window * 2 + 1);
  }

  // Look ahead/behind for racing line: inside apex for peak curvature, subtle outside entry/exit
  const rawOffset = new Array<number>(sampleCount).fill(0);
  for (let i = 0; i < sampleCount; i++) {
    const c = smoothCurv[i];
    // Turn right (c > 0): hug right apex (+lat); turn left (c < 0): hug left apex (-lat)
    // Entry/exit counter-swing comes from averaging nearby negative-weighted curvature
    const cAhead = smoothCurv[(i + 14) % sampleCount];
    const cBehind = smoothCurv[(i - 14 + sampleCount) % sampleCount];
    const target = c * 280 - (cAhead + cBehind) * 55;
    rawOffset[i] = Math.max(-ROAD_HALF_WIDTH * 0.58, Math.min(ROAD_HALF_WIDTH * 0.58, target));
  }

  // Smooth racingOffset with wide Gaussian-like passes so AI steering is silky smooth
  let buf = rawOffset.slice();
  for (let pass = 0; pass < 4; pass++) {
    const nextBuf = new Array<number>(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      let acc = 0;
      for (let k = -4; k <= 4; k++) {
        acc += buf[(i + k + sampleCount) % sampleCount];
      }
      nextBuf[i] = acc / 9;
    }
    buf = nextBuf;
  }
  for (let i = 0; i < sampleCount; i++) {
    samples[i].curvature = smoothCurv[i];
    samples[i].racingOffset = buf[i];
  }

  const finalTotalLength =
    accS + Math.hypot(samples[0].x - samples[sampleCount - 1].x, samples[0].z - samples[sampleCount - 1].z);

  const wrapS = (s: number): number => {
    const r = s % finalTotalLength;
    return r < 0 ? r + finalTotalLength : r;
  };

  const sampleAtS = (s: number): TrackSample => {
    const ws = wrapS(s);
    const approxIdx = Math.floor((ws / finalTotalLength) * sampleCount) % sampleCount;
    return samples[approxIdx];
  };

  const projectPoint = (x: number, z: number, hintIndex?: number): TrackProjection => {
    let bestIdx = 0;
    let bestDistSq = Infinity;

    if (hintIndex !== undefined && hintIndex >= 0 && hintIndex < sampleCount) {
      // Search local window ±36 samples first
      for (let offset = -36; offset <= 36; offset++) {
        const idx = (hintIndex + offset + sampleCount) % sampleCount;
        const smp = samples[idx];
        const dx = x - smp.x;
        const dz = z - smp.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = idx;
        }
      }
    }

    // Fallback global search if hint wasn't given or car is far from hint
    if (bestDistSq > 900) {
      bestDistSq = Infinity;
      for (let i = 0; i < sampleCount; i++) {
        const smp = samples[i];
        const dx = x - smp.x;
        const dz = z - smp.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = i;
        }
      }
    }

    const s0 = samples[bestIdx];
    const sPrev = samples[(bestIdx - 1 + sampleCount) % sampleCount];
    const sNext = samples[(bestIdx + 1) % sampleCount];

    // Refine projection along local segment (sPrev -> sNext)
    const dx = x - s0.x;
    const dz = z - s0.z;
    const along = dx * s0.tx + dz * s0.tz;
    const segLen = Math.hypot(sNext.x - sPrev.x, sNext.z - sPrev.z) * 0.5 || 1;
    const frac = Math.max(-1, Math.min(1, along / segLen));

    const cx = s0.x + s0.tx * along;
    const cz = s0.z + s0.tz * along;
    const lateral = (x - cx) * s0.rx + (z - cz) * s0.rz;

    let sVal = s0.s + frac * segLen;
    sVal = wrapS(sVal);

    return {
      sampleIndex: bestIdx,
      s: sVal,
      lateral,
      tx: s0.tx,
      tz: s0.tz,
      rx: s0.rx,
      rz: s0.rz,
      cx,
      cz,
      curvature: s0.curvature,
      racingOffset: s0.racingOffset,
    };
  };

  // Sanity guard against unused variable warning
  void totalRawLength;

  return {
    samples,
    totalLength: finalTotalLength,
    roadHalfWidth: ROAD_HALF_WIDTH,
    kerbWidth: KERB_WIDTH,
    barrierHalfWidth: BARRIER_HALF_WIDTH,
    minX,
    maxX,
    minZ,
    maxZ,
    sampleAtS,
    projectPoint,
    wrapS,
  };
}

export const CIRCUIT: CircuitTrack = buildCircuit();
