import { computeAIInput } from './ai';
import { resolveCarCollisions, stepCarPhysics } from './physics';
import { SeededRNG } from './prng';
import { CircuitTrack, DEFAULT_CAR_SPECS } from './track';
import { BenchResult, CarState, InputState, RaceState } from './types';

export const FIXED_DT = 1 / 60;
export const TOTAL_LAPS = 3;
export const COUNTDOWN_DURATION = 3.0;

export function createRaceState(
  seed: number,
  track: CircuitTrack,
  playerAutopilot = false
): RaceState {
  const rng = new SeededRNG(seed);
  const cars: CarState[] = [];

  const gridSlots = [
    { backDist: 40, lateral: 3.1 },  // 00 PLAYER starts P6
    { backDist: 14, lateral: -3.1 }, // 07 RAZOR P1
    { backDist: 19, lateral: 3.1 },  // 12 BLAZE P2
    { backDist: 25, lateral: -3.1 }, // 18 MOSS P3
    { backDist: 30, lateral: 3.1 },  // 23 NOVA P4
    { backDist: 35, lateral: -3.1 }, // 31 COMET P5
  ];

  for (let i = 0; i < DEFAULT_CAR_SPECS.length; i++) {
    const baseSpec = DEFAULT_CAR_SPECS[i];
    const spec = baseSpec.isPlayer
      ? baseSpec
      : {
          ...baseSpec,
          baseSkill: Math.max(0.90, Math.min(1.01, baseSpec.baseSkill + rng.range(-0.02, 0.018))),
        };
    const slot = gridSlots[i];
    const s = track.totalLength - slot.backDist;
    const sample = track.sampleAtS(s);
    const x = sample.x + sample.nx * slot.lateral;
    const z = sample.z + sample.nz * slot.lateral;
    const heading = Math.atan2(sample.tz, sample.tx);

    cars.push({
      index: i,
      spec,
      x,
      z,
      vx: 0,
      vz: 0,
      heading,
      angularVel: 0,
      steerAngle: 0,
      wheelSpin: 0,
      bodyRoll: 0,
      bodyPitch: 0,
      forwardSpeed: 0,
      lateralSpeed: 0,
      isDrifting: false,
      isBraking: false,
      isOffTrack: false,
      driftAngleDeg: 0,
      driftTime: 0,
      currentDriftScore: 0,
      driftCombo: 1,
      totalDriftScore: 0,
      bestDriftCombo: 1,
      cleanDriftCooldown: 0,
      nitro: 40, // Initial nitro charge so players can boost early, recharge via drifting/overtakes/corners
      isBoosting: false,
      nitroLockedUntilRecharge: false,
      boostSecondsUsed: 0,
      boostActivations: 0,
      trackIdx: Math.floor((s / track.totalLength) * track.count) % track.count,
      trackS: s,
      trackD: slot.lateral,
      inCornerZone: false,
      cornerClean: true,
      sector: 3,
      maxSectorReached: -1,
      completedLaps: 0,
      finished: false,
      finishTime: null,
      currentLapStart: 0,
      currentSectorStart: 0,
      lastSectorSplits: [],
      bestLapTime: null,
      lapTimes: [],
      totalProgress: -slot.backDist,
      overtakes: 0,
      collisions: 0,
      lastRank: i === 0 ? 6 : i,
      barrierHitCooldown: 0,
      carHitCooldown: 0,
      stuckTimer: 0,
      wasStuck: false,
      anchorX: x,
      anchorZ: z,
      anchorTimer: 0,
      aiLaneOffset: slot.lateral,
      aiTargetOffset: slot.lateral,
      aiAltLineTimer: rng.range(2.0, 5.0),
      aiAltLineBias: 0,
      aiMistakeTimer: 0,
      aiMistakeSteer: 0,
      aiMistakeBrake: 0,
      aiNextMistakeCheck: rng.range(3.5, 8.5),
      aiRecoveryTimer: 0,
      aiRecoveryDir: 1,
    });
  }

  const state: RaceState = {
    seed,
    totalLaps: TOTAL_LAPS,
    phase: 'countdown',
    countdownTimer: COUNTDOWN_DURATION,
    countdownStep: 3,
    raceTime: 0,
    totalSimTime: 0,
    cars,
    order: [1, 2, 3, 4, 5, 0],
    barrierHits: 0,
    playerAutopilot,
    bestSectorsOverall: [null, null, null, null],
    overallBestLap: null,
    events: [],
  };

  sortRaceOrder(state);
  state.order.forEach((cIdx, rank) => {
    state.cars[cIdx].lastRank = rank + 1;
  });
  return state;
}

function updateCarLapProgress(car: CarState, state: RaceState, track: CircuitTrack): void {
  const normS = car.trackS / track.totalLength;
  const newSector = Math.min(3, Math.floor(normS * 4));

  if (car.maxSectorReached === -1) {
    if (newSector === 0) {
      car.maxSectorReached = 0;
      car.sector = 0;
      car.currentLapStart = state.raceTime;
      car.currentSectorStart = state.raceTime;
      car.totalProgress = car.trackS;
    } else {
      car.totalProgress = car.trackS - track.totalLength;
    }
    return;
  }

  // Sector split tracking
  if (newSector === car.maxSectorReached + 1) {
    const sectorTime = state.raceTime - car.currentSectorStart;
    const prevBest = state.bestSectorsOverall[car.maxSectorReached];
    const delta = prevBest !== null ? sectorTime - prevBest : 0;
    if (prevBest === null || sectorTime < prevBest) {
      state.bestSectorsOverall[car.maxSectorReached] = sectorTime;
    }
    car.lastSectorSplits[car.maxSectorReached] = sectorTime;
    car.currentSectorStart = state.raceTime;
    car.maxSectorReached = newSector;
    state.events.push({
      type: 'sector',
      carIndex: car.index,
      value: car.maxSectorReached,
      extra: delta,
    });
  } else if (car.maxSectorReached === 3 && newSector === 0 && car.sector === 3) {
    // Sector 4 split + Completed Lap!
    const sectorTime = state.raceTime - car.currentSectorStart;
    const prevBestS4 = state.bestSectorsOverall[3];
    if (prevBestS4 === null || sectorTime < prevBestS4) {
      state.bestSectorsOverall[3] = sectorTime;
    }
    car.lastSectorSplits[3] = sectorTime;
    car.currentSectorStart = state.raceTime;

    const lapTime = state.raceTime - car.currentLapStart;
    car.lapTimes.push(lapTime);

    const isPersonalBest = car.bestLapTime === null || lapTime < car.bestLapTime;
    if (isPersonalBest) {
      car.bestLapTime = lapTime;
    }
    const isOverallBest = state.overallBestLap === null || lapTime < state.overallBestLap;
    if (isOverallBest) {
      state.overallBestLap = lapTime;
      state.events.push({
        type: 'best_lap',
        carIndex: car.index,
        value: lapTime,
      });
    }

    car.completedLaps += 1;
    car.currentLapStart = state.raceTime;
    car.maxSectorReached = 0;

    state.events.push({
      type: 'lap',
      carIndex: car.index,
      value: car.completedLaps,
      extra: lapTime,
    });

    if (!car.finished && car.completedLaps >= state.totalLaps) {
      car.finished = true;
      car.finishTime = state.raceTime;
      state.events.push({
        type: 'finish',
        carIndex: car.index,
        value: state.raceTime,
      });
    }
  }

  car.sector = newSector;

  let sInLap = car.trackS;
  if (car.maxSectorReached === 0 && newSector === 3) {
    sInLap = car.trackS - track.totalLength;
  }
  car.totalProgress = car.completedLaps * track.totalLength + sInLap;
}

function sortRaceOrder(state: RaceState): void {
  state.order = state.cars
    .map((c) => c.index)
    .sort((idxA, idxB) => {
      const a = state.cars[idxA];
      const b = state.cars[idxB];
      if (a.finished && b.finished) {
        return (a.finishTime ?? 0) - (b.finishTime ?? 0);
      }
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.totalProgress - a.totalProgress;
    });
}

export function stepRace(
  state: RaceState,
  track: CircuitTrack,
  rng: SeededRNG,
  playerInput: InputState,
  dt: number
): void {
  state.events.length = 0;
  state.totalSimTime += dt;

  if (state.phase === 'countdown') {
    const prevStep = state.countdownStep;
    state.countdownTimer -= dt;
    const newStep = Math.max(0, Math.ceil(state.countdownTimer));
    if (newStep !== prevStep) {
      state.countdownStep = newStep;
      state.events.push({
        type: 'countdown',
        carIndex: 0,
        value: newStep,
      });
    }
    if (state.countdownTimer <= 0) {
      state.phase = 'racing';
      state.countdownTimer = 0;
      state.countdownStep = 0;
      state.events.push({
        type: 'countdown',
        carIndex: 0,
        value: 0,
      });
    }
  } else if (state.phase === 'racing') {
    state.raceTime += dt;
  }

  const canMove = state.phase !== 'countdown';

  for (let i = 0; i < state.cars.length; i++) {
    const car = state.cars[i];
    let input: InputState;
    if (car.spec.isPlayer && !state.playerAutopilot && !car.finished) {
      input = playerInput;
    } else {
      input = computeAIInput(car, state.cars, track, rng, dt, canMove);
    }

    const res = stepCarPhysics(car, input, track, dt, state.events, canMove);
    if (res.barrierHit) {
      state.barrierHits += 1;
    }
  }

  if (canMove) {
    resolveCarCollisions(state.cars, track, state.events);
  }

  const prevOrder = state.order.slice();

  for (let i = 0; i < state.cars.length; i++) {
    const car = state.cars[i];
    updateCarLapProgress(car, state, track);

    if (canMove && !car.finished) {
      const movedDist = Math.hypot(car.x - car.anchorX, car.z - car.anchorZ);
      if (movedDist > 2.2) {
        car.anchorX = car.x;
        car.anchorZ = car.z;
        car.anchorTimer = 0;
      } else {
        car.anchorTimer += dt;
        if (car.anchorTimer > 5.0) {
          car.wasStuck = true;
        }
      }
    }
  }

  sortRaceOrder(state);

  // Detect clean overtakes after initial 2s launch settle
  if (state.raceTime > 2.0) {
    for (let rankIdx = 0; rankIdx < state.order.length; rankIdx++) {
      const carIdx = state.order[rankIdx];
      const newRank = rankIdx + 1;
      const car = state.cars[carIdx];
      if (newRank < car.lastRank && car.totalProgress > 0) {
        // Passed someone! Find who was at this rank previously
        const passedCarIdx = prevOrder[rankIdx];
        car.overtakes += 1;
        car.nitro = Math.min(100, car.nitro + 22);
        if (car.index === 0 || passedCarIdx === 0) {
          state.events.push({
            type: 'overtake',
            carIndex: carIdx,
            otherIndex: passedCarIdx,
            value: newRank,
          });
        }
      }
      car.lastRank = newRank;
    }
  } else {
    for (let rankIdx = 0; rankIdx < state.order.length; rankIdx++) {
      state.cars[state.order[rankIdx]].lastRank = rankIdx + 1;
    }
  }

  const allFinished = state.cars.every((c) => c.finished);
  if (allFinished) {
    state.phase = 'finished';
  }
}

export function runHeadlessRace(seed: number, seconds: number, track?: CircuitTrack): BenchResult {
  const circuit = track ?? new CircuitTrack();
  const rng = new SeededRNG(seed);
  const state = createRaceState(seed, circuit, true);
  const dummyInput: InputState = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    nitro: false,
    resetPressed: false,
  };

  const totalSteps = Math.max(0, Math.round(seconds / FIXED_DT));
  for (let step = 0; step < totalSteps; step++) {
    stepRace(state, circuit, rng, dummyInput, FIXED_DT);
  }

  return {
    laps: state.cars.map((c) => c.completedLaps),
    order: state.order.slice(),
    barrierHits: state.barrierHits,
    stuck: state.cars.filter((c) => c.wasStuck).length,
  };
}
