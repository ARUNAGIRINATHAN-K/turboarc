import { SeededRNG } from './prng';
import { normalizeAngle } from './physics';
import { CircuitTrack, ROAD_HALF_WIDTH } from './track';
import { CarState, InputState } from './types';

/**
 * AI / Autopilot with 6 distinct driving personalities:
 * - balanced (00 PLAYER autopilot)
 * - aggressive (07 RAZOR): widens overtake search & dives earlier
 * - speedster (12 BLAZE): maximizes straight-line nitro & high exit speed
 * - defensive (18 MOSS): protects inside line when trailed closely & brakes cautiously
 * - cornering (23 NOVA): smooth apex hugging & higher cornering speed
 * - opportunistic (31 COMET): tries alternate outside/inside passing lines
 */
export function computeAIInput(
  car: CarState,
  allCars: CarState[],
  track: CircuitTrack,
  rng: SeededRNG,
  dt: number,
  raceActive: boolean
): InputState {
  if (!raceActive) {
    return {
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: false,
      nitro: false,
      resetPressed: false,
    };
  }

  const speed = Math.hypot(car.vx, car.vz);

  // 1. Stuck recovery check
  if (speed < 2.4) {
    car.aiRecoveryTimer += dt;
  } else {
    car.aiRecoveryTimer = Math.max(0, car.aiRecoveryTimer - dt * 2.5);
  }

  if (car.aiRecoveryTimer > 1.35) {
    const proj = track.project(car.x, car.z, car.trackIdx);
    const trackHeading = Math.atan2(proj.tz, proj.tx);
    const headingErr = normalizeAngle(trackHeading - car.heading);

    if (car.aiRecoveryTimer < 2.25) {
      const steerDir = proj.d > 0 ? 1 : -1;
      return {
        throttle: 0,
        brake: 1.0,
        steer: headingErr > 0 ? -steerDir : steerDir,
        handbrake: false,
        nitro: false,
        resetPressed: false,
      };
    } else if (car.aiRecoveryTimer > 3.6) {
      car.aiRecoveryTimer = 0;
      return {
        throttle: 0,
        brake: 0,
        steer: 0,
        handbrake: false,
        nitro: false,
        resetPressed: true,
      };
    }
  }

  // 2. Small periodic AI mistakes (disabled for player autopilot)
  if (car.spec.mistakeRate > 0) {
    car.aiNextMistakeCheck -= dt;
    if (car.aiMistakeTimer > 0) {
      car.aiMistakeTimer -= dt;
    } else if (car.aiNextMistakeCheck <= 0) {
      car.aiNextMistakeCheck = rng.range(4.8, 10.0);
      if (rng.next() < car.spec.mistakeRate * 0.42) {
        car.aiMistakeTimer = rng.range(0.32, 0.72);
        car.aiMistakeSteer = rng.range(-0.20, 0.20);
        car.aiMistakeBrake = rng.next() < 0.5 ? rng.range(0.15, 0.32) : 0;
      } else {
        car.aiMistakeSteer = 0;
        car.aiMistakeBrake = 0;
      }
    }
  }

  // Opportunistic COMET occasionally explores alternate wide/inside line
  if (car.spec.personality === 'opportunistic') {
    car.aiAltLineTimer -= dt;
    if (car.aiAltLineTimer <= 0) {
      car.aiAltLineTimer = rng.range(3.5, 6.5);
      car.aiAltLineBias = rng.next() < 0.45 ? rng.range(-3.2, 3.2) : 0;
    }
  }

  // 3. Overtaking, Defensive Blocking & Traffic Avoidance
  const overtakeScanDist = car.spec.personality === 'aggressive' ? 35 : 27;
  let overtakeOffset = 0;
  let nearestAheadGap = Infinity;
  let blockingCarSpeed = 999;
  let defensiveBlockOffset: number | null = null;

  for (let i = 0; i < allCars.length; i++) {
    if (i === car.index) continue;
    const other = allCars[i];

    let ds = other.trackS - car.trackS;
    if (ds < -track.totalLength * 0.5) ds += track.totalLength;
    if (ds > track.totalLength * 0.5) ds -= track.totalLength;

    // Car ahead
    if (ds > 1.5 && ds < overtakeScanDist) {
      const dd = other.trackD - car.trackD;
      const laneCheck = car.spec.personality === 'aggressive' ? 4.1 : 3.6;
      if (Math.abs(dd) < laneCheck && ds < nearestAheadGap) {
        nearestAheadGap = ds;
        blockingCarSpeed = Math.hypot(other.vx, other.vz);
        const spaceRight = ROAD_HALF_WIDTH - 2.0 - other.trackD;
        const spaceLeft = other.trackD - (-ROAD_HALF_WIDTH + 2.0);
        const stepOut = car.spec.personality === 'aggressive' ? 4.2 : 3.8;
        if (spaceRight > spaceLeft) {
          overtakeOffset = Math.min(ROAD_HALF_WIDTH - 2.1, other.trackD + stepOut);
        } else {
          overtakeOffset = Math.max(-ROAD_HALF_WIDTH + 2.1, other.trackD - stepOut);
        }
      }
    }
    // Defensive MOSS protects inside/middle line if a rival is closing from behind
    else if (
      car.spec.personality === 'defensive' &&
      ds < -2.0 &&
      ds > -16 &&
      nearestAheadGap >= overtakeScanDist
    ) {
      // Shift gently toward the side the trailing car is on (bounded cleanly)
      defensiveBlockOffset = Math.max(-4.5, Math.min(4.5, other.trackD * 0.7));
    }
    // Side-by-side separation nudge
    else if (Math.abs(ds) <= 4.2) {
      const dd = other.trackD - car.trackD;
      if (Math.abs(dd) < 2.8) {
        overtakeOffset += dd > 0 ? -1.4 : 1.4;
      }
    }
  }

  const baseSample = track.sampleAtS(car.trackS + 16 + speed * 0.32);
  let desiredLane = baseSample.racingOffset + car.aiAltLineBias;
  if (nearestAheadGap < overtakeScanDist) {
    desiredLane = overtakeOffset;
  } else if (defensiveBlockOffset !== null) {
    desiredLane = defensiveBlockOffset;
  }

  desiredLane = Math.max(-ROAD_HALF_WIDTH + 1.8, Math.min(ROAD_HALF_WIDTH - 1.8, desiredLane));
  car.aiTargetOffset = desiredLane;
  const laneBlendRate = car.spec.personality === 'aggressive' ? 4.6 : 3.8;
  car.aiLaneOffset += (car.aiTargetOffset - car.aiLaneOffset) * Math.min(1, laneBlendRate * dt);

  // 4. Lookahead Steering Target
  const lookAheadDist = Math.max(12, Math.min(34, 11 + speed * 0.36));
  const targetSample = track.sampleAtS(car.trackS + lookAheadDist);
  const targetX = targetSample.x + targetSample.nx * car.aiLaneOffset;
  const targetZ = targetSample.z + targetSample.nz * car.aiLaneOffset;

  const desiredHeading = Math.atan2(targetZ - car.z, targetX - car.x);
  let headingError = normalizeAngle(desiredHeading - car.heading);

  if (car.aiMistakeTimer > 0) {
    headingError += car.aiMistakeSteer;
  }

  const steer = Math.max(-1, Math.min(1, headingError * 2.25));

  // 5. Curvature Lookahead Speed Planning
  let maxSafeSpeed = 74;
  let minStraightAheadKappa = 0;
  const scanDistances = [12, 24, 38, 54, 72, 92];
  for (let i = 0; i < scanDistances.length; i++) {
    const dist = scanDistances[i];
    const ahead = track.sampleAtS(car.trackS + dist);
    const absKappa = Math.abs(ahead.kappa);
    if (absKappa > minStraightAheadKappa) minStraightAheadKappa = absKappa;
    if (absKappa > 0.004) {
      const latAccelBudget = (absKappa > 0.022 ? 15.8 : 19.5) * car.spec.cornerGripSkill / car.spec.cornerCaution;
      const cornerSpeed = Math.sqrt(latAccelBudget / absKappa) * car.spec.baseSkill;
      const brakeDecel = 24.0 / car.spec.cornerCaution;
      const entrySpeed = Math.sqrt(cornerSpeed * cornerSpeed + 2 * brakeDecel * dist);
      if (entrySpeed < maxSafeSpeed) {
        maxSafeSpeed = entrySpeed;
      }
    }
  }

  if (nearestAheadGap < 8.5 && Math.abs(car.trackD - car.aiTargetOffset) < 1.2) {
    maxSafeSpeed = Math.min(maxSafeSpeed, blockingCarSpeed + 3);
  }

  let throttle = 1.0;
  let brake = 0.0;

  const speedDiff = speed - maxSafeSpeed;
  if (speedDiff > 3.5) {
    throttle = 0;
    brake = Math.min(1, (speedDiff - 2.0) / 12.0);
  } else if (speedDiff > 0.5) {
    throttle = 0.25;
  }

  if (Math.abs(headingError) > 0.48 && speed > 28) {
    throttle = Math.min(throttle, 0.3);
  }

  if (car.aiMistakeTimer > 0 && car.aiMistakeBrake > 0) {
    brake = Math.max(brake, car.aiMistakeBrake);
    throttle *= 0.4;
  }

  // 6. Smart Nitro Usage on straights when clear & not braking
  const straightClear = minStraightAheadKappa < 0.011 && Math.abs(headingError) < 0.16 && brake === 0;
  const nitroThreshold = car.spec.personality === 'speedster' ? 28 : 45;
  const wantNitro =
    straightClear &&
    speed > 26 &&
    (car.isBoosting ? car.nitro > 4 : car.nitro >= nitroThreshold);

  return {
    throttle,
    brake,
    steer,
    handbrake: false,
    nitro: wantNitro,
    resetPressed: false,
  };
}
