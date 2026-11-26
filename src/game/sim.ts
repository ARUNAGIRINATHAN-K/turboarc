import { AIDriverProfile, computeAIControl, createAIProfile } from './ai';
import {
  CarState,
  ControlInput,
  createCarAtGrid,
  resetCarToTrack,
  resolveBarrierCollision,
  resolveCarCollisions,
  stepCarPhysics,
} from './physics';
import { SeededRNG } from './rng';
import { CIRCUIT } from './track';

export const TOTAL_LAPS = 3;
export const COUNTDOWN_SECONDS = 3.0;
export const FIXED_DT = 1 / 60;

export interface RaceSnapshot {
  phase: 'countdown' | 'racing' | 'finished';
  countdownValue: number; // 3, 2, 1, or 0 (GO)
  raceTime: number;       // seconds since green flag (negative during countdown)
  cars: CarState[];
  order: number[];        // car indices [0..5] sorted 1st to 6th
  barrierHits: number;
}

export interface BenchRaceResult {
  laps: number[];
  order: number[];
  barrierHits: number;
  stuck: number;
}

export class RaceSimulation {
  readonly seed: number;
  readonly rng: SeededRNG;
  readonly cars: CarState[];
  readonly aiProfiles: AIDriverProfile[];
  readonly playerAutopilot: boolean;

  phase: 'countdown' | 'racing' | 'finished' = 'countdown';
  elapsedTotal = 0; // includes countdown
  raceTime = 0;     // green-flag racing clock
  barrierHits = 0;
  order: number[] = [1, 2, 3, 4, 5, 0];
  private prevS: number[] = [];
  private crossedStartLine: boolean[] = [];

  constructor(seed: number, playerAutopilot: boolean) {
    this.seed = seed;
    this.playerAutopilot = playerAutopilot;
    this.rng = new SeededRNG(seed);
    this.cars = [];
    this.aiProfiles = [];
    this.prevS = [];
    this.crossedStartLine = [];

    for (let i = 0; i < 6; i++) {
      const car = createCarAtGrid(i);
      this.cars.push(car);
      const profile = createAIProfile(i, this.rng, playerAutopilot);
      profile.prevX = car.x;
      profile.prevZ = car.z;
      this.aiProfiles.push(profile);
      this.prevS.push(car.s);
      this.crossedStartLine.push(false);
    }

    this.updateStandings();
  }

  step(dt: number, playerManualInput?: ControlInput): void {
    this.elapsedTotal += dt;

    if (this.phase === 'countdown') {
      if (this.elapsedTotal >= COUNTDOWN_SECONDS) {
        this.phase = 'racing';
        this.raceTime = this.elapsedTotal - COUNTDOWN_SECONDS;
      } else {
        // Cars sit on starting grid during 3, 2, 1 countdown (player can rev throttle visually)
        if (playerManualInput && !this.playerAutopilot) {
          this.cars[0].throttle = playerManualInput.throttle;
        }
        return;
      }
    } else {
      this.raceTime += dt;
    }

    const raceActive = this.phase === 'racing' || this.phase === 'finished';

    // 1. Compute inputs and step physics per car
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      let input: ControlInput;
      if (i === 0 && !this.playerAutopilot && !car.finished) {
        input = playerManualInput ?? { throttle: 0, brake: 0, steer: 0, handbrake: false };
      } else {
        input = computeAIControl(
          car,
          this.cars,
          this.aiProfiles[i],
          this.rng,
          dt,
          i === 0 && this.playerAutopilot,
          raceActive
        );
      }
      stepCarPhysics(car, input, dt);
    }

    // 2. Car-to-car collisions (2 passes for solid multi-car pack separation)
    resolveCarCollisions(this.cars);
    resolveCarCollisions(this.cars);

    // 3. Car-to-barrier collisions & lap/progress updates
    const L = CIRCUIT.totalLength;
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const { hitBarrier } = resolveBarrierCollision(car);
      if (hitBarrier) {
        this.barrierHits++;
      }

      const oldS = this.prevS[i];
      const newS = car.s;

      // Detect initial crossing of start line after launch
      if (!this.crossedStartLine[i]) {
        if (oldS > L * 0.75 && newS < L * 0.25) {
          this.crossedStartLine[i] = true;
        }
      }

      // Halfway checkpoint validation prevents reverse-crossing lap exploits
      if (newS > L * 0.35 && newS < L * 0.65) {
        car.passedHalfway = true;
      }

      // Detect forward finish line crossing
      if (oldS > L * 0.78 && newS < L * 0.22 && car.passedHalfway) {
        if (!car.finished) {
          const lapTime = this.raceTime - car.currentLapStartTime;
          car.lapTimes.push(lapTime);
          car.lastLapTime = lapTime;
          if (car.bestLapTime === null || lapTime < car.bestLapTime) {
            car.bestLapTime = lapTime;
          }
          car.currentLapStartTime = this.raceTime;
          car.lapsCompleted++;
          car.passedHalfway = false;

          if (car.lapsCompleted >= TOTAL_LAPS) {
            car.finished = true;
            car.finishTime = this.raceTime;
          }
        }
      }

      this.prevS[i] = newS;

      // Monotonic race progress
      if (!this.crossedStartLine[i] && car.lapsCompleted === 0 && newS > L * 0.75) {
        car.totalProgress = newS - L;
      } else {
        car.totalProgress = car.lapsCompleted * L + newS;
      }

      // Track stuck telemetry while actively racing
      if (!car.finished && this.phase === 'racing') {
        const moved = Math.hypot(car.x - car.stuckAnchorX, car.z - car.stuckAnchorZ);
        if (moved > 2.0) {
          car.stuckAnchorX = car.x;
          car.stuckAnchorZ = car.z;
          car.stuckWindowTimer = 0;
        } else {
          car.stuckWindowTimer += dt;
          if (car.stuckWindowTimer > 5.0) {
            car.hasBeenStuckOver5s = true;
          }
        }
      }
    }

    this.updateStandings();

    // Race finishes when player finishes (or all cars finish in demo/autopilot)
    if (this.phase === 'racing') {
      if (this.playerAutopilot) {
        if (this.cars.every((c) => c.finished)) {
          this.phase = 'finished';
        }
      } else if (this.cars[0].finished) {
        this.phase = 'finished';
      }
    }
  }

  resetPlayer(): void {
    const player = this.cars[0];
    if (player.finished) return;
    resetCarToTrack(player);
    this.prevS[0] = player.s;
  }

  getCountdownDisplay(): number {
    if (this.phase !== 'countdown') return 0;
    return Math.max(1, Math.ceil(COUNTDOWN_SECONDS - this.elapsedTotal - 1e-5));
  }

  getPlayerPosition(): number {
    return this.order.indexOf(0) + 1;
  }

  private updateStandings(): void {
    const indices = [0, 1, 2, 3, 4, 5];
    indices.sort((a, b) => {
      const ca = this.cars[a];
      const cb = this.cars[b];
      if (ca.finished && cb.finished) {
        return (ca.finishTime ?? 0) - (cb.finishTime ?? 0);
      }
      if (ca.finished) return -1;
      if (cb.finished) return 1;
      return cb.totalProgress - ca.totalProgress;
    });
    this.order = indices;
  }
}

/**
 * Synchronous headless race runner exposed at window.bench.race(seed, seconds).
 */
export function runBenchRace(seed: number, seconds: number): BenchRaceResult {
  const sim = new RaceSimulation(Number.isFinite(seed) ? seed : 1, true);
  const clampedSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const steps = Math.round(clampedSeconds / FIXED_DT);

  for (let s = 0; s < steps; s++) {
    sim.step(FIXED_DT);
  }

  const laps = sim.cars.map((c) => c.lapsCompleted);
  const stuck = sim.cars.filter((c) => c.hasBeenStuckOver5s).length;

  return {
    laps,
    order: sim.order.slice(),
    barrierHits: sim.barrierHits,
    stuck,
  };
}
