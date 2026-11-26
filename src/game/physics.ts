import { CIRCUIT, TrackProjection } from './track';

export interface CarSpec {
  id: number;
  name: string;
  shortCode: string;
  color: string;
  accent: string;
  topSpeed: number;     // m/s
  accel: number;        // m/s^2
  grip: number;         // lateral damping factor
}

export const CAR_SPECS: ReadonlyArray<CarSpec> = [
  { id: 0, name: 'You (Apex Red)', shortCode: 'YOU', color: '#ef4444', accent: '#ffffff', topSpeed: 69.5, accel: 32.5, grip: 9.8 },
  { id: 1, name: 'Cobalt RS', shortCode: 'COB', color: '#2563eb', accent: '#bae6fd', topSpeed: 69.0, accel: 31.8, grip: 9.6 },
  { id: 2, name: 'Solaris GT', shortCode: 'SOL', color: '#f59e0b', accent: '#1e293b', topSpeed: 68.5, accel: 31.6, grip: 9.5 },
  { id: 3, name: 'Emerald Evo', shortCode: 'EME', color: '#10b981', accent: '#ecfdf5', topSpeed: 68.0, accel: 31.2, grip: 9.6 },
  { id: 4, name: 'Violet V8', shortCode: 'VIO', color: '#8b5cf6', accent: '#f5f3ff', topSpeed: 67.5, accel: 30.8, grip: 9.4 },
  { id: 5, name: 'Glacier Spec', shortCode: 'GLA', color: '#06b6d4', accent: '#0f172a', topSpeed: 67.0, accel: 30.5, grip: 9.4 },
];

export interface ControlInput {
  throttle: number;   // 0..1
  brake: number;      // 0..1
  steer: number;      // -1 (left) .. +1 (right)
  handbrake: boolean; // Space drift
}

export interface CarState {
  id: number;
  spec: CarSpec;
  x: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;      // radians; 0 = +Z, +PI/2 = +X
  yawRate: number;
  steerAngle: number; // visual & physics steer angle (+ = right, - = left)
  wheelSpin: number;
  speed: number;      // signed forward speed (m/s)
  speedKmh: number;
  throttle: number;
  braking: boolean;
  handbrake: boolean;
  isDrifting: boolean;
  driftIntensity: number;
  bodyRoll: number;
  bodyPitch: number;

  // Track progress & lap timing
  sampleIndex: number;
  s: number;
  lateral: number;
  lapsCompleted: number;
  maxLapS: number; // anti-cheat checkpoint progress within current lap
  passedHalfway: boolean;
  totalProgress: number;
  finished: boolean;
  finishTime: number | null;
  currentLapStartTime: number;
  lastLapTime: number | null;
  bestLapTime: number | null;
  lapTimes: number[];

  // Collision & stuck telemetry
  barrierHitCooldown: number;
  stuckWindowTimer: number;
  stuckAnchorX: number;
  stuckAnchorZ: number;
  maxStationaryDuration: number;
  hasBeenStuckOver5s: boolean;

  // Hit shake feedback (for player camera)
  lastImpactIntensity: number;
}

export function createCarAtGrid(id: number): CarState {
  const spec = CAR_SPECS[id];
  // Grid: 2 columns x 3 rows behind start/finish line (s = totalLength - offset)
  // Row 0 (pole): id 5, 4 or id 1, 2; Player starts P6 (back right) for exciting overtakes,
  // or P4/P6! Let's put Player at P6 (id 0 at back-right of grid) so overtaking is rewarding,
  // and grid order 1..6 is [1, 2, 3, 4, 5, 0] -> wait: let's make grid slot = id so P1..P6:
  // Actually starting player in P6 (slot 5) behind 5 opponents makes the race thrilling!
  const gridSlot = id === 0 ? 5 : id - 1; // Opponents in slots 0..4, Player in slot 5
  const row = Math.floor(gridSlot / 2); // 0, 1, 2
  const col = gridSlot % 2;             // 0 (left), 1 (right)
  const sBack = 14 + row * 10.5 + col * 3.0;
  const s = CIRCUIT.wrapS(CIRCUIT.totalLength - sBack);
  const lat = col === 0 ? -3.4 : 3.4;

  const smp = CIRCUIT.sampleAtS(s);
  const x = smp.x + smp.rx * lat;
  const z = smp.z + smp.rz * lat;
  const yaw = Math.atan2(smp.tx, smp.tz);

  return {
    id,
    spec,
    x,
    z,
    vx: 0,
    vz: 0,
    yaw,
    yawRate: 0,
    steerAngle: 0,
    wheelSpin: 0,
    speed: 0,
    speedKmh: 0,
    throttle: 0,
    braking: false,
    handbrake: false,
    isDrifting: false,
    driftIntensity: 0,
    bodyRoll: 0,
    bodyPitch: 0,

    sampleIndex: smp.index,
    s,
    lateral: lat,
    lapsCompleted: 0,
    maxLapS: 0,
    passedHalfway: false,
    // Negative initial progress proportional to distance behind start line so starting order P1..P6 is exact
    totalProgress: -sBack,
    finished: false,
    finishTime: null,
    currentLapStartTime: 0,
    lastLapTime: null,
    bestLapTime: null,
    lapTimes: [],

    barrierHitCooldown: 0,
    stuckWindowTimer: 0,
    stuckAnchorX: x,
    stuckAnchorZ: z,
    maxStationaryDuration: 0,
    hasBeenStuckOver5s: false,
    lastImpactIntensity: 0,
  };
}

export function stepCarPhysics(car: CarState, input: ControlInput, dt: number): void {
  car.lastImpactIntensity = 0;
  if (car.barrierHitCooldown > 0) {
    car.barrierHitCooldown = Math.max(0, car.barrierHitCooldown - dt);
  }

  const fx = Math.sin(car.yaw);
  const fz = Math.cos(car.yaw);
  const rx = -fz; // right normal perpendicular to (fx, fz)
  const rz = fx;

  let vFwd = car.vx * fx + car.vz * fz;
  let vLat = car.vx * rx + car.vz * rz;
  const absSpeed = Math.hypot(vFwd, vLat);

  // Smooth steering angle
  const maxSteer = 0.52; // ~30 deg
  const speedSteerScale = 1.0 - 0.58 * Math.min(1, Math.abs(vFwd) / car.spec.topSpeed);
  const targetSteer = input.steer * maxSteer * (0.45 + 0.55 * speedSteerScale);
  const steerRate = 9.5;
  car.steerAngle += (targetSteer - car.steerAngle) * Math.min(1, steerRate * dt);

  // Determine drift engagement (Space handbrake while moving & turning, or high lateral slip)
  const wantHandbrake = input.handbrake && Math.abs(vFwd) > 7.5;
  const isSliding = Math.abs(vLat) > 3.2 || (wantHandbrake && Math.abs(input.steer) > 0.15);
  car.isDrifting = isSliding && absSpeed > 8.0;
  const targetDriftInt = car.isDrifting
    ? Math.min(1, (Math.abs(vLat) / 14) + (wantHandbrake ? 0.35 : 0))
    : 0;
  car.driftIntensity += (targetDriftInt - car.driftIntensity) * Math.min(1, 10 * dt);

  // Longitudinal forces: acceleration, braking, reverse, aerodynamic drag
  car.throttle = input.throttle;
  car.handbrake = input.handbrake;
  car.braking = input.brake > 0.1 && vFwd > 1.5;

  let accelFwd = 0;
  if (input.throttle > 0) {
    const speedRatio = Math.max(0, vFwd / car.spec.topSpeed);
    // Strong arcade torque curve
    const torqueCurve = Math.max(0.18, 1.15 - 0.92 * speedRatio * speedRatio);
    accelFwd += input.throttle * car.spec.accel * torqueCurve;
  }

  if (input.brake > 0) {
    if (vFwd > 1.0) {
      accelFwd -= input.brake * 38.0; // strong braking
    } else {
      // Reverse gear (capped at -18 m/s)
      if (vFwd > -18.0) {
        accelFwd -= input.brake * 18.0;
      }
    }
  }

  if (wantHandbrake) {
    // Handbrake shaves slight forward speed while kicking out the rear
    accelFwd -= Math.sign(vFwd) * 4.5;
  }

  // Rolling resistance + quadratic aero drag
  const drag = 0.0048 * vFwd * Math.abs(vFwd) + 0.32 * vFwd;
  accelFwd -= drag;

  vFwd += accelFwd * dt;
  // Soft top-speed cap
  if (vFwd > car.spec.topSpeed) {
    vFwd += (car.spec.topSpeed - vFwd) * Math.min(1, 6 * dt);
  }
  if (vFwd < -18.0) {
    vFwd = -18.0;
  }

  // Steering & yaw dynamics (positive steer = turn right => yaw decreases)
  const dirSign = vFwd >= -0.4 ? 1 : -1;
  const lowSpeedFactor = Math.min(1, absSpeed / 5.5);
  const driftTurnBoost = wantHandbrake ? 1.48 : car.isDrifting ? 1.22 : 1.0;
  const targetYawRate = -car.steerAngle * 3.15 * lowSpeedFactor * dirSign * driftTurnBoost;
  const yawResponse = wantHandbrake ? 11.0 : 14.0;
  car.yawRate += (targetYawRate - car.yawRate) * Math.min(1, yawResponse * dt);
  car.yaw += car.yawRate * dt;

  // Re-evaluate basis vectors after yaw update? Actually apply lateral grip in current heading:
  // When handbrake is held, lateral grip drops sharply so the car slides through the corner!
  const effectiveGrip = wantHandbrake
    ? car.spec.grip * 0.24
    : car.isDrifting
      ? car.spec.grip * 0.56
      : car.spec.grip;

  // Lateral grip damps sideways slip velocity toward 0
  vLat *= Math.exp(-effectiveGrip * dt);

  // Subtle drift kick when initiating handbrake slide with steering
  if (wantHandbrake && Math.abs(input.steer) > 0.2) {
    // Turning right (+steer) kicks rear left (-rx) -> positive forward-aligned drift slip toward -steer
    vLat -= input.steer * 9.5 * dt;
  }

  // Reconstruct world velocity from updated heading
  const nfx = Math.sin(car.yaw);
  const nfz = Math.cos(car.yaw);
  const nrx = -nfz;
  const nrz = nfx;

  car.vx = nfx * vFwd + nrx * vLat;
  car.vz = nfz * vFwd + nrz * vLat;

  car.x += car.vx * dt;
  car.z += car.vz * dt;

  // Visual wheel spin & suspension roll/pitch
  car.speed = vFwd;
  car.speedKmh = Math.abs(vFwd) * 3.6;
  car.wheelSpin += (vFwd / 0.36) * dt; // 0.36m wheel radius

  const targetRoll = Math.max(-0.09, Math.min(0.09, -car.yawRate * 0.032 - vLat * 0.004));
  const targetPitch = Math.max(-0.045, Math.min(0.045, -accelFwd * 0.0014));
  car.bodyRoll += (targetRoll - car.bodyRoll) * Math.min(1, 12 * dt);
  car.bodyPitch += (targetPitch - car.bodyPitch) * Math.min(1, 10 * dt);
}

/**
 * Resolve car-to-car collisions using 2-circle rigid body approximation per car
 * so bumpers and side doors collide accurately without tunneling or overlapping.
 */
export function resolveCarCollisions(cars: CarState[]): void {
  const circleRadius = 0.96;
  const minDist = circleRadius * 2;
  const minDistSq = minDist * minDist;
  const halfOffset = 1.15; // front & rear circle centers along car forward vector

  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    const afx = Math.sin(a.yaw);
    const afz = Math.cos(a.yaw);

    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      // Broadphase check
      const dxCenter = b.x - a.x;
      const dzCenter = b.z - a.z;
      if (dxCenter * dxCenter + dzCenter * dzCenter > 25.0) continue;

      const bfx = Math.sin(b.yaw);
      const bfz = Math.cos(b.yaw);

      // Test all 4 circle pairs and pick the deepest overlap
      let deepestOverlap = 0;
      let hitNx = 0;
      let hitNz = 0;
      let hitLeverA = 0;
      let hitLeverB = 0;

      for (const sa of [-halfOffset, halfOffset]) {
        const ax = a.x + afx * sa;
        const az = a.z + afz * sa;
        for (const sb of [-halfOffset, halfOffset]) {
          const bx = b.x + bfx * sb;
          const bz = b.z + bfz * sb;
          const dx = bx - ax;
          const dz = bz - az;
          const dSq = dx * dx + dz * dz;
          if (dSq < minDistSq) {
            const d = Math.sqrt(dSq) || 0.001;
            const overlap = minDist - d;
            if (overlap > deepestOverlap) {
              deepestOverlap = overlap;
              hitNx = dx / d;
              hitNz = dz / d;
              hitLeverA = sa;
              hitLeverB = sb;
            }
          }
        }
      }

      if (deepestOverlap > 0) {
        // Positional separation
        const sep = deepestOverlap * 0.52;
        a.x -= hitNx * sep;
        a.z -= hitNz * sep;
        b.x += hitNx * sep;
        b.z += hitNz * sep;

        // Relative velocity along contact normal (from A to B)
        const rvx = b.vx - a.vx;
        const rvz = b.vz - a.vz;
        const velAlongNormal = rvx * hitNx + rvz * hitNz;

        if (velAlongNormal < 0) {
          const restitution = 0.35;
          const jImpulse = -(1 + restitution) * velAlongNormal * 0.5;
          a.vx -= hitNx * jImpulse;
          a.vz -= hitNz * jImpulse;
          b.vx += hitNx * jImpulse;
          b.vz += hitNz * jImpulse;

          // Subtle rotational nudge on corner hits
          const crossA = afx * hitNz - afz * hitNx;
          const crossB = bfx * hitNz - bfz * hitNx;
          a.yawRate -= crossA * hitLeverA * jImpulse * 0.06;
          b.yawRate += crossB * hitLeverB * jImpulse * 0.06;

          const impactMag = Math.min(1, Math.abs(velAlongNormal) / 22);
          a.lastImpactIntensity = Math.max(a.lastImpactIntensity, impactMag);
          b.lastImpactIntensity = Math.max(b.lastImpactIntensity, impactMag);
        }
      }
    }
  }
}

/**
 * Clamp car strictly inside circuit barriers and count distinct barrier impacts.
 */
export function resolveBarrierCollision(car: CarState): { projection: TrackProjection; hitBarrier: boolean } {
  const proj = CIRCUIT.projectPoint(car.x, car.z, car.sampleIndex);
  const maxLateral = CIRCUIT.barrierHalfWidth - 1.15;
  let hitBarrier = false;

  if (Math.abs(proj.lateral) > maxLateral) {
    const sign = proj.lateral > 0 ? 1 : -1;
    const clampedLat = sign * maxLateral;
    car.x = proj.cx + proj.rx * clampedLat;
    car.z = proj.cz + proj.rz * clampedLat;

    // Velocity component into the barrier along (sign * rx, sign * rz)
    const nx = sign * proj.rx;
    const nz = sign * proj.rz;
    const vIntoWall = car.vx * nx + car.vz * nz;

    if (vIntoWall > 0) {
      // Reflect & damp outward velocity, scrub slight tangential speed
      const bounce = 0.25;
      car.vx -= (1 + bounce) * vIntoWall * nx;
      car.vz -= (1 + bounce) * vIntoWall * nz;
      car.vx *= 0.94;
      car.vz *= 0.94;

      if (vIntoWall > 1.8 && car.barrierHitCooldown <= 0) {
        hitBarrier = true;
        car.barrierHitCooldown = 0.45;
        car.lastImpactIntensity = Math.max(car.lastImpactIntensity, Math.min(1, vIntoWall / 18));
      }
    }

    // Gently deflect heading back toward track tangent so cars don't nose-lock into walls
    const trackYaw = Math.atan2(proj.tx, proj.tz);
    let yawDiff = trackYaw - car.yaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    if (Math.abs(yawDiff) > 0.25) {
      car.yaw += yawDiff * 0.14;
    }
  }

  // Recompute projection after possible clamp
  const finalProj =
    Math.abs(proj.lateral) > maxLateral
      ? CIRCUIT.projectPoint(car.x, car.z, proj.sampleIndex)
      : proj;

  car.sampleIndex = finalProj.sampleIndex;
  car.s = finalProj.s;
  car.lateral = finalProj.lateral;

  return { projection: finalProj, hitBarrier };
}

/**
 * Reset car onto the track centerline at its current track progress s.
 */
export function resetCarToTrack(car: CarState): void {
  const smp = CIRCUIT.sampleAtS(car.s);
  car.x = smp.x;
  car.z = smp.z;
  car.vx = 0;
  car.vz = 0;
  car.yaw = Math.atan2(smp.tx, smp.tz);
  car.yawRate = 0;
  car.steerAngle = 0;
  car.speed = 0;
  car.speedKmh = 0;
  car.isDrifting = false;
  car.driftIntensity = 0;
  car.sampleIndex = smp.index;
  car.lateral = 0;
}
