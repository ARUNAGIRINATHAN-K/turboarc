import { BARRIER_HALF_WIDTH, CircuitTrack, ROAD_HALF_WIDTH } from './track';
import { CarState, InputState, SimEvent } from './types';

export const CAR_LENGTH = 4.3;
export const CAR_WIDTH = 1.96;
export const CAR_RADIUS = 1.12;
export const WHEEL_RADIUS = 0.36;
export const CIRCLE_OFFSET = 1.05;
export const CIRCLE_RADIUS = 0.96;

const MAX_FORWARD_SPEED = 70.0; // ~252 km/h
const NITRO_MAX_SPEED = 84.5; // ~304 km/h
const MAX_REVERSE_SPEED = 18.0;
const ENGINE_ACCEL = 34.0;
const BRAKE_DECEL = 52.0;
const REVERSE_ACCEL = 22.0;
const ROLLING_DRAG = 0.22;
const AERO_DRAG = 0.0046;

export function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function stepCarPhysics(
  car: CarState,
  input: InputState,
  track: CircuitTrack,
  dt: number,
  events: SimEvent[],
  canMove: boolean
): { barrierHit: boolean } {
  if (car.barrierHitCooldown > 0) {
    car.barrierHitCooldown = Math.max(0, car.barrierHitCooldown - dt);
  }
  if (car.carHitCooldown > 0) {
    car.carHitCooldown = Math.max(0, car.carHitCooldown - dt);
  }

  // Handle reset onto track
  if (canMove && input.resetPressed) {
    const proj = track.project(car.x, car.z, car.trackIdx);
    car.x = proj.x;
    car.z = proj.z;
    car.vx = 0;
    car.vz = 0;
    car.angularVel = 0;
    car.heading = Math.atan2(proj.tz, proj.tx);
    car.forwardSpeed = 0;
    car.lateralSpeed = 0;
    car.isDrifting = false;
    car.isBoosting = false;
    car.currentDriftScore = 0;
    car.driftTime = 0;
    car.driftCombo = 1;
    car.driftAngleDeg = 0;
    car.bodyRoll = 0;
    car.bodyPitch = 0;
    car.trackIdx = proj.idx;
    car.trackS = proj.s;
    car.trackD = 0;
    car.isOffTrack = false;
    car.stuckTimer = 0;
    return { barrierHit: false };
  }

  if (!canMove) {
    const targetSteer = input.steer * 0.42;
    car.steerAngle += (targetSteer - car.steerAngle) * Math.min(1, 12 * dt);
    car.vx = 0;
    car.vz = 0;
    car.forwardSpeed = 0;
    car.lateralSpeed = 0;
    car.isDrifting = false;
    car.isBoosting = false;
    car.isBraking = input.brake > 0.1 || input.handbrake;
    return { barrierHit: false };
  }

  // Nitro boost state update
  if (car.nitro >= 15) {
    car.nitroLockedUntilRecharge = false;
  }
  const canNitro = input.nitro && !car.nitroLockedUntilRecharge && car.nitro > 0.5 && input.brake < 0.2;
  if (canNitro) {
    if (!car.isBoosting) {
      car.boostActivations += 1;
      events.push({ type: 'nitro_start', carIndex: car.index });
    }
    car.isBoosting = true;
    car.nitro = Math.max(0, car.nitro - 26.0 * dt);
    car.boostSecondsUsed += dt;
    if (car.nitro <= 0.5) {
      car.nitro = 0;
      car.isBoosting = false;
      car.nitroLockedUntilRecharge = true;
    }
  } else {
    car.isBoosting = false;
  }

  const fx = Math.cos(car.heading);
  const fz = Math.sin(car.heading);
  const rx = -fz;
  const rz = fx;

  let vLong = car.vx * fx + car.vz * fz;
  let vLat = car.vx * rx + car.vz * rz;
  const speedMag = Math.hypot(vLong, vLat);

  const maxSteerVisual = 0.46;
  const targetSteerAngle = input.steer * maxSteerVisual;
  car.steerAngle += (targetSteerAngle - car.steerAngle) * Math.min(1, 14 * dt);

  const wantDrift = input.handbrake && vLong > 10.5 && (Math.abs(input.steer) > 0.12 || Math.abs(vLat) > 2.8);
  car.isDrifting = wantDrift || (Math.abs(vLat) > 5.4 && vLong > 10);

  // Longitudinal forces
  let accelLong = 0;
  let braking = false;

  const activeTopSpeed = (car.isBoosting ? NITRO_MAX_SPEED : MAX_FORWARD_SPEED) * car.spec.straightBoost;
  const effectiveThrottle = car.isBoosting ? Math.max(input.throttle, 1.0) : input.throttle;

  if (effectiveThrottle > 0) {
    if (vLong < -1.0) {
      accelLong += BRAKE_DECEL * effectiveThrottle;
      braking = true;
    } else {
      const speedRatio = Math.max(0, vLong / activeTopSpeed);
      const torqueCurve = 1.15 - 0.55 * speedRatio * speedRatio;
      const boostMul = car.isBoosting ? 1.48 : 1.0;
      accelLong += ENGINE_ACCEL * effectiveThrottle * torqueCurve * car.spec.baseSkill * boostMul;
    }
  }

  if (input.brake > 0) {
    if (vLong > 1.2) {
      accelLong -= BRAKE_DECEL * input.brake;
      braking = true;
    } else if (vLong > -MAX_REVERSE_SPEED) {
      accelLong -= REVERSE_ACCEL * input.brake;
    }
  }

  if (input.handbrake) {
    if (vLong > 14 && Math.abs(input.steer) > 0.1) {
      accelLong -= 7.0;
    } else if (vLong > 0.5) {
      accelLong -= 24.0;
      braking = true;
    }
  }

  car.isBraking = braking;

  // Aerodynamic + rolling drag (boost scales aero drag cap smoothly)
  const aeroCoef = car.isBoosting ? AERO_DRAG * 0.68 : AERO_DRAG;
  const drag = ROLLING_DRAG * vLong + aeroCoef * vLong * Math.abs(vLong);
  vLong += (accelLong - drag) * dt;
  vLong = Math.max(-MAX_REVERSE_SPEED, Math.min(activeTopSpeed * 1.04, vLong));

  // Steering angular rate
  const speedFactor = Math.min(1, speedMag / 9.5);
  const highSpeedTaper = 1.0 / (1.0 + 0.011 * Math.max(0, speedMag - 22));
  const driftTurnBoost = wantDrift ? 1.38 : 1.0;
  const reverseSign = vLong >= -0.5 ? 1 : -1;
  const targetYawRate = input.steer * 2.55 * speedFactor * highSpeedTaper * driftTurnBoost * reverseSign;

  car.angularVel += (targetYawRate - car.angularVel) * Math.min(1, (wantDrift ? 11 : 16) * dt);
  car.heading = normalizeAngle(car.heading + car.angularVel * dt);

  const newFx = Math.cos(car.heading);
  const newFz = Math.sin(car.heading);
  const newRx = -newFz;
  const newRz = newFx;

  const worldVx = fx * vLong + rx * vLat;
  const worldVz = fz * vLong + rz * vLat;

  let newVLong = worldVx * newFx + worldVz * newFz;
  let newVLat = worldVx * newRx + worldVz * newRz;

  // Off-track check & grip
  const offTrack = Math.abs(car.trackD) > ROAD_HALF_WIDTH + 0.65;
  car.isOffTrack = offTrack;

  const baseGrip = wantDrift ? 2.45 : offTrack ? 5.3 : 9.4 * car.spec.cornerGripSkill;
  const gripDecay = Math.exp(-baseGrip * dt);
  newVLat *= gripDecay;

  if (offTrack && Math.abs(newVLong) > 14) {
    newVLong *= Math.exp(-1.15 * dt);
  }

  car.vx = newFx * newVLong + newRx * newVLat;
  car.vz = newFz * newVLong + newRz * newVLat;
  car.forwardSpeed = newVLong;
  car.lateralSpeed = newVLat;

  car.x += car.vx * dt;
  car.z += car.vz * dt;

  car.wheelSpin += (newVLong / WHEEL_RADIUS) * dt;
  const targetRoll = Math.max(-0.085, Math.min(0.085, newVLat * 0.008 + input.steer * Math.min(1, speedMag / 25) * 0.045));
  const targetPitch = Math.max(-0.055, Math.min(0.055, -accelLong * 0.001));
  car.bodyRoll += (targetRoll - car.bodyRoll) * Math.min(1, 10 * dt);
  car.bodyPitch += (targetPitch - car.bodyPitch) * Math.min(1, 10 * dt);

  // Off-track dust particles
  const newSpeedMag = Math.hypot(car.vx, car.vz);
  if (offTrack && newSpeedMag > 6.5) {
    events.push({
      type: 'dust',
      carIndex: car.index,
      x: car.x - newFx * 1.4,
      z: car.z - newFz * 1.4,
      heading: car.heading,
      intensity: Math.min(1, newSpeedMag / 35),
    });
  }

  // Drift angle, scoring, combo, smoke & skid marks
  const slipMag = Math.abs(newVLat);
  const slipAngleDeg = newVLong > 3 ? (Math.atan2(slipMag, newVLong) * 180) / Math.PI : 0;
  car.driftAngleDeg = car.isDrifting ? Math.min(89, Math.round(slipAngleDeg)) : 0;

  if (car.isDrifting && newSpeedMag > 10 && slipAngleDeg > 6 && !offTrack) {
    car.driftTime += dt;
    car.driftCombo = Math.min(5, 1 + Math.floor(car.driftTime / 1.15));
    car.bestDriftCombo = Math.max(car.bestDriftCombo, car.driftCombo);
    const rate = newSpeedMag * 2.4 + Math.min(45, slipAngleDeg) * 2.2;
    car.currentDriftScore += rate * dt;
    car.nitro = Math.min(100, car.nitro + 12.5 * dt);
  } else if (!car.isDrifting && car.currentDriftScore > 0) {
    if (car.currentDriftScore >= 24 && newSpeedMag > 8) {
      const banked = Math.round(car.currentDriftScore * car.driftCombo);
      car.totalDriftScore += banked;
      car.nitro = Math.min(100, car.nitro + Math.min(18, 4.5 * car.driftCombo));
      events.push({
        type: 'drift_bank',
        carIndex: car.index,
        value: banked,
        extra: car.driftCombo,
      });
    }
    car.currentDriftScore = 0;
    car.driftTime = 0;
    car.driftCombo = 1;
  }

  // Spinout breaks drift combo
  if (car.currentDriftScore > 20 && (newSpeedMag < 5.5 || slipAngleDeg > 78)) {
    car.currentDriftScore = 0;
    car.driftTime = 0;
    car.driftCombo = 1;
    events.push({ type: 'drift_break', carIndex: car.index });
  }

  if ((wantDrift || slipMag > 4.4) && newSpeedMag > 9.5) {
    const intensity = Math.min(1, (slipMag - 1.5) / 10);
    if (intensity > 0.08) {
      events.push({
        type: 'skid',
        carIndex: car.index,
        x: car.x - newFx * 1.25,
        z: car.z - newFz * 1.25,
        heading: car.heading,
        intensity,
      });
      events.push({
        type: 'smoke',
        carIndex: car.index,
        x: car.x - newFx * 1.35,
        z: car.z - newFz * 1.35,
        heading: car.heading,
        intensity,
      });
    }
  }

  // Project onto track & clean-corner nitro reward
  const proj = track.project(car.x, car.z, car.trackIdx);
  car.trackIdx = proj.idx;
  car.trackS = proj.s;
  car.trackD = proj.d;

  const absK = Math.abs(proj.kappa);
  if (absK > 0.013) {
    if (!car.inCornerZone) {
      car.inCornerZone = true;
      car.cornerClean = !offTrack;
    } else if (offTrack) {
      car.cornerClean = false;
    }
  } else if (car.inCornerZone && absK < 0.008) {
    if (car.cornerClean && newSpeedMag > 16) {
      car.nitro = Math.min(100, car.nitro + 10);
    }
    car.inCornerZone = false;
    car.cornerClean = true;
  }

  // Enforce barrier collision
  const maxD = BARRIER_HALF_WIDTH - CAR_RADIUS;
  let barrierHit = false;

  if (Math.abs(proj.d) > maxD) {
    const sign = proj.d >= 0 ? 1 : -1;
    const clampedD = sign * maxD;
    car.x = proj.x + proj.nx * clampedD;
    car.z = proj.z + proj.nz * clampedD;
    car.trackD = clampedD;
    car.cornerClean = false;

    const outNx = proj.nx * sign;
    const outNz = proj.nz * sign;
    const vOut = car.vx * outNx + car.vz * outNz;

    if (vOut > 0) {
      const restitution = 0.28;
      car.vx -= (1 + restitution) * vOut * outNx;
      car.vz -= (1 + restitution) * vOut * outNz;
      const tx = proj.tx;
      const tz = proj.tz;
      const vTan = car.vx * tx + car.vz * tz;
      const vIn = car.vx * outNx + car.vz * outNz;
      car.vx = tx * (vTan * 0.88) + outNx * vIn;
      car.vz = tz * (vTan * 0.88) + outNz * vIn;

      const trackHeading = Math.atan2(proj.tz, proj.tx);
      const headingErr = normalizeAngle(trackHeading - car.heading);
      if (Math.abs(headingErr) > 0.35) {
        car.heading = normalizeAngle(car.heading + headingErr * Math.min(0.45, dt * 6));
      }

      if (vOut > 5.0 && car.currentDriftScore > 15) {
        car.currentDriftScore = 0;
        car.driftTime = 0;
        car.driftCombo = 1;
        events.push({ type: 'drift_break', carIndex: car.index });
      }

      if (vOut > 2.2 && car.barrierHitCooldown <= 0) {
        barrierHit = true;
        car.collisions += 1;
        car.barrierHitCooldown = 0.5;
        events.push({
          type: 'barrier',
          carIndex: car.index,
          x: car.x,
          z: car.z,
          intensity: Math.min(1, vOut / 25),
        });
        if (vOut > 4.5) {
          events.push({
            type: 'sparks',
            carIndex: car.index,
            x: car.x + outNx * 0.6,
            z: car.z + outNz * 0.6,
            intensity: Math.min(1, vOut / 22),
          });
        }
      }
    }
  }

  car.forwardSpeed = car.vx * Math.cos(car.heading) + car.vz * Math.sin(car.heading);
  car.lateralSpeed = car.vx * -Math.sin(car.heading) + car.vz * Math.cos(car.heading);

  return { barrierHit };
}

export function resolveCarCollisions(
  cars: CarState[],
  track: CircuitTrack,
  events: SimEvent[]
): void {
  const minDist = CIRCLE_RADIUS * 2;
  const minDistSq = minDist * minDist;

  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    const afx = Math.cos(a.heading);
    const afz = Math.sin(a.heading);

    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      const dxBroad = b.x - a.x;
      const dzBroad = b.z - a.z;
      if (dxBroad * dxBroad + dzBroad * dzBroad > 26) continue;

      const bfx = Math.cos(b.heading);
      const bfz = Math.sin(b.heading);

      let deepestOverlap = 0;
      let bestNx = 0;
      let bestNz = 0;

      for (let sa = -1; sa <= 1; sa += 2) {
        const ax = a.x + afx * CIRCLE_OFFSET * sa;
        const az = a.z + afz * CIRCLE_OFFSET * sa;
        for (let sb = -1; sb <= 1; sb += 2) {
          const bx = b.x + bfx * CIRCLE_OFFSET * sb;
          const bz = b.z + bfz * CIRCLE_OFFSET * sb;
          const dx = bx - ax;
          const dz = bz - az;
          const dSq = dx * dx + dz * dz;
          if (dSq < minDistSq) {
            const dist = Math.sqrt(dSq) || 0.001;
            const overlap = minDist - dist;
            if (overlap > deepestOverlap) {
              deepestOverlap = overlap;
              bestNx = dx / dist;
              bestNz = dz / dist;
            }
          }
        }
      }

      if (deepestOverlap > 0) {
        const push = deepestOverlap * 0.52;
        a.x -= bestNx * push;
        a.z -= bestNz * push;
        b.x += bestNx * push;
        b.z += bestNz * push;

        const rvx = b.vx - a.vx;
        const rvz = b.vz - a.vz;
        const velAlongNormal = rvx * bestNx + rvz * bestNz;

        if (velAlongNormal < 0) {
          const restitution = 0.35;
          const jImp = (-(1 + restitution) * velAlongNormal) * 0.5;
          a.vx -= jImp * bestNx;
          a.vz -= jImp * bestNz;
          b.vx += jImp * bestNx;
          b.vz += jImp * bestNz;

          if (-velAlongNormal > 4.0) {
            const intensity = Math.min(1, -velAlongNormal / 22);
            const midX = (a.x + b.x) * 0.5;
            const midZ = (a.z + b.z) * 0.5;
            if (a.carHitCooldown <= 0) {
              a.collisions += 1;
              a.carHitCooldown = 0.45;
            }
            if (b.carHitCooldown <= 0) {
              b.collisions += 1;
              b.carHitCooldown = 0.45;
            }
            events.push({
              type: 'car_hit',
              carIndex: a.index,
              otherIndex: b.index,
              x: midX,
              z: midZ,
              intensity,
            });
            events.push({
              type: 'sparks',
              carIndex: a.index,
              x: midX,
              z: midZ,
              intensity,
            });
          }
        }

        const maxD = BARRIER_HALF_WIDTH - CAR_RADIUS;
        for (const car of [a, b]) {
          const proj = track.project(car.x, car.z, car.trackIdx);
          car.trackIdx = proj.idx;
          car.trackS = proj.s;
          car.trackD = proj.d;
          if (Math.abs(proj.d) > maxD) {
            const sign = proj.d >= 0 ? 1 : -1;
            car.x = proj.x + proj.nx * (sign * maxD);
            car.z = proj.z + proj.nz * (sign * maxD);
            car.trackD = sign * maxD;
          }
        }
      }
    }
  }
}
