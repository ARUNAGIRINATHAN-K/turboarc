import { CarState, ControlInput } from './physics';
import { SeededRNG } from './rng';
import { CIRCUIT } from './track';

export interface AIDriverProfile {
  skillSpeedFactor: number;     // 0.94 .. 1.02
  cornerBrakeCaution: number;   // higher = brakes earlier
  lineAggression: number;       // 0.7 .. 1.1
  mistakeTimer: number;         // countdown until next small mistake check
  mistakeActiveTimer: number;   // active duration of small mistake
  mistakeSteerBias: number;     // slight drift/wide-entry steering bias
  mistakeThrottleScale: number; // brief lift or late brake
  recoveryTimer: number;        // reverse-out timer if pinned
  recoveryDir: number;
  lowMoveTimer: number;
  prevX: number;
  prevZ: number;
}

export function createAIProfile(carId: number, rng: SeededRNG, isPlayerAutopilot: boolean): AIDriverProfile {
  if (isPlayerAutopilot && carId === 0) {
    return {
      skillSpeedFactor: 1.0,
      cornerBrakeCaution: 1.0,
      lineAggression: 0.95,
      mistakeTimer: 99999,
      mistakeActiveTimer: 0,
      mistakeSteerBias: 0,
      mistakeThrottleScale: 1,
      recoveryTimer: 0,
      recoveryDir: 1,
      lowMoveTimer: 0,
      prevX: 0,
      prevZ: 0,
    };
  }

  // Spread 5 AI opponent paces naturally so racing pack stays competitive with overtakes
  const baseSkill = 0.935 + (5 - carId) * 0.015 + rng.range(-0.01, 0.012);
  return {
    skillSpeedFactor: baseSkill,
    cornerBrakeCaution: rng.range(0.92, 1.12),
    lineAggression: rng.range(0.78, 1.05),
    mistakeTimer: rng.range(7, 16),
    mistakeActiveTimer: 0,
    mistakeSteerBias: 0,
    mistakeThrottleScale: 1,
    recoveryTimer: 0,
    recoveryDir: 1,
    lowMoveTimer: 0,
    prevX: 0,
    prevZ: 0,
  };
}

export function computeAIControl(
  car: CarState,
  allCars: ReadonlyArray<CarState>,
  profile: AIDriverProfile,
  rng: SeededRNG,
  dt: number,
  isAutopilot: boolean,
  raceActive: boolean
): ControlInput {
  if (!raceActive) {
    return { throttle: 0, brake: 0, steer: 0, handbrake: false };
  }

  // Anti-stuck recovery check: if car moves < 0.8m over 2.0s during active race, reverse & turn out
  const moved = Math.hypot(car.x - profile.prevX, car.z - profile.prevZ);
  if (moved > 1.2) {
    profile.prevX = car.x;
    profile.prevZ = car.z;
    profile.lowMoveTimer = 0;
  } else {
    profile.lowMoveTimer += dt;
    if (profile.lowMoveTimer > 1.8 && profile.recoveryTimer <= 0) {
      profile.recoveryTimer = 0.85;
      profile.recoveryDir = car.lateral > 0 ? -1 : 1;
      profile.lowMoveTimer = 0;
    }
  }

  if (profile.recoveryTimer > 0) {
    profile.recoveryTimer -= dt;
    return {
      throttle: 0,
      brake: 1,
      steer: profile.recoveryDir,
      handbrake: false,
    };
  }

  // Occasional small human-like mistakes for opponent AI cars (never for player autopilot)
  if (!isAutopilot) {
    if (profile.mistakeActiveTimer > 0) {
      profile.mistakeActiveTimer -= dt;
      if (profile.mistakeActiveTimer <= 0) {
        profile.mistakeSteerBias = 0;
        profile.mistakeThrottleScale = 1.0;
      }
    } else {
      profile.mistakeTimer -= dt;
      if (profile.mistakeTimer <= 0) {
        profile.mistakeTimer = rng.range(9, 20);
        // Only trigger a small mistake if safely inside the road (won't crash straight into a wall)
        if (Math.abs(car.lateral) < 4.8 && car.speed > 20) {
          profile.mistakeActiveTimer = rng.range(0.45, 0.85);
          profile.mistakeSteerBias = rng.range(-0.16, 0.16);
          profile.mistakeThrottleScale = rng.range(0.75, 0.92);
        }
      }
    }
  }

  // 1. Overtake / traffic avoidance lane selection
  let overtakeOffset = 0;
  let nearestAheadDist = Infinity;
  let nearestAheadSpeed = 999;

  for (let i = 0; i < allCars.length; i++) {
    const other = allCars[i];
    if (other.id === car.id) continue;
    let ds = other.s - car.s;
    if (ds < 0) ds += CIRCUIT.totalLength;
    if (ds > 0.5 && ds < 26.0) {
      const dLat = other.lateral - car.lateral;
      if (Math.abs(dLat) < 3.4 && ds < nearestAheadDist) {
        nearestAheadDist = ds;
        nearestAheadSpeed = other.speed;
        // Pick wider clear side within safe road half-width
        const roomLeft = car.lateral + (CIRCUIT.roadHalfWidth - 2.0);
        const roomRight = (CIRCUIT.roadHalfWidth - 2.0) - car.lateral;
        if (dLat >= 0) {
          overtakeOffset = roomLeft > 2.8 ? -3.4 : 3.2;
        } else {
          overtakeOffset = roomRight > 2.8 ? 3.4 : -3.2;
        }
      }
    }
  }

  // 2. Lookahead target point along racing line
  const lookDist = Math.max(13.5, Math.min(34, 11.0 + car.speed * 0.42));
  const targetSample = CIRCUIT.sampleAtS(car.s + lookDist);
  const desiredLat = Math.max(
    -CIRCUIT.roadHalfWidth + 1.8,
    Math.min(
      CIRCUIT.roadHalfWidth - 1.8,
      targetSample.racingOffset * profile.lineAggression + overtakeOffset
    )
  );

  const tx = targetSample.x + targetSample.rx * desiredLat;
  const tz = targetSample.z + targetSample.rz * desiredLat;

  const dx = tx - car.x;
  const dz = tz - car.z;
  const desiredYaw = Math.atan2(dx, dz);

  let yawErr = desiredYaw - car.yaw;
  while (yawErr > Math.PI) yawErr -= Math.PI * 2;
  while (yawErr < -Math.PI) yawErr += Math.PI * 2;

  // Positive steer = turn right (which reduces yaw), so negative yawErr needs positive steer!
  let steer = Math.max(-1, Math.min(1, (-yawErr * 2.1) + profile.mistakeSteerBias));

  // 3. Corner braking lookahead (scan 18m..88m ahead for peak curvature)
  let maxCurvature = Math.abs(CIRCUIT.sampleAtS(car.s + 10).curvature);
  for (let d = 18; d <= 88; d += 10) {
    const smp = CIRCUIT.sampleAtS(car.s + d);
    // Weight closer corners higher so car brakes on entry and accelerates out of apex
    const weight = d < 45 ? 1.0 : 0.85;
    maxCurvature = Math.max(maxCurvature, Math.abs(smp.curvature) * weight);
  }

  // Max safe cornering speed from lateral acceleration envelope (~23.5 m/s^2 arcade GT grip)
  const lateralAccelBudget = (23.5 / profile.cornerBrakeCaution) * (isAutopilot ? 1.04 : 1.0);
  const cornerMaxSpeed =
    maxCurvature > 0.0025
      ? Math.sqrt(lateralAccelBudget / maxCurvature)
      : car.spec.topSpeed;

  let targetSpeed = Math.min(car.spec.topSpeed * profile.skillSpeedFactor, cornerMaxSpeed);
  if (nearestAheadDist < 7.5 && Math.abs(overtakeOffset) < 1.0) {
    targetSpeed = Math.min(targetSpeed, Math.max(12, nearestAheadSpeed * 0.92));
  }

  // Keep car safely away from outer barriers if lateral drift gets high
  if (Math.abs(car.lateral) > CIRCUIT.roadHalfWidth - 0.5) {
    targetSpeed = Math.min(targetSpeed, 32);
    const centerBias = car.lateral > 0 ? -0.35 : 0.35;
    steer = Math.max(-1, Math.min(1, steer + centerBias));
  }

  let throttle = 0;
  let brake = 0;
  if (car.speed > targetSpeed + 2.8) {
    brake = Math.min(1, (car.speed - targetSpeed) / 14.0);
  } else if (car.speed < targetSpeed) {
    throttle = Math.min(1, 0.35 + (targetSpeed - car.speed) / 8.0) * profile.mistakeThrottleScale;
  } else {
    throttle = 0.4 * profile.mistakeThrottleScale;
  }

  // Finished cars cruise gently at steady pace
  if (car.finished) {
    targetSpeed = 24;
    throttle = car.speed < targetSpeed ? 0.35 : 0;
    brake = car.speed > targetSpeed + 4 ? 0.3 : 0;
  }

  return {
    throttle,
    brake,
    steer,
    handbrake: false,
  };
}
