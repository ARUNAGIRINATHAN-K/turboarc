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

export interface BenchRaceResult {
  laps: number[];
  order: number[];
  barrierHits: number;
  stuck: number;
}

export interface RaceEventBanner {
  type: 'overtake' | 'overtaken' | 'lap_record' | 'sector' | 'drift_ok' | 'drift_fail' | 'lap_complete' | 'approach';
  text: string;
  subtext?: string;
  positive: boolean;
}

export class RaceSimulation {
  readonly seed: number;
  readonly rng: SeededRNG;
  readonly cars: CarState[];
  readonly aiProfiles: AIDriverProfile[];
  readonly playerAutopilot: boolean;

  phase: 'countdown' | 'racing' | 'finished' = 'countdown';
  elapsedTotal = 0;
  raceTime = 0;
  barrierHits = 0;
  order: number[] = [1, 2, 3, 4, 5, 0];
  overallBestLap: number | null = null;
  events: RaceEventBanner[] = [];

  private prevS: number[] = [];
  private prevRanks: number[] = [];
  private crossedStartLine: boolean[] = [];
  private approachCooldown = 0;

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
    this.prevRanks = this.computeRankByCar();
  }

  private computeRankByCar(): number[] {
    const ranks = new Array<number>(6);
    for (let pos = 0; pos < this.order.length; pos++) {
      ranks[this.order[pos]] = pos + 1;
    }
    return ranks;
  }

  step(dt: number, playerManualInput?: ControlInput): void {
    this.events.length = 0;
    this.elapsedTotal += dt;
    if (this.approachCooldown > 0) {
      this.approachCooldown = Math.max(0, this.approachCooldown - dt);
    }

    if (this.phase === 'countdown') {
      if (this.elapsedTotal >= COUNTDOWN_SECONDS) {
        this.phase = 'racing';
        this.raceTime = this.elapsedTotal - COUNTDOWN_SECONDS;
      } else {
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
        input = playerManualInput ?? { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
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

    // 2. Car-to-car collisions (2 passes)
    resolveCarCollisions(this.cars);
    resolveCarCollisions(this.cars);

    // 3. Car-to-barrier collisions, sectors, clean corners, & laps
    const L = CIRCUIT.totalLength;
    const [sec1End, sec2End] = CIRCUIT.sectorLengths;

    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const { projection, hitBarrier } = resolveBarrierCollision(car);
      if (hitBarrier) {
        this.barrierHits++;
      }

      // Clean corner tracking & boost reward
      const absC = Math.abs(projection.curvature);
      if (absC > 0.0085 && car.speed > 20) {
        if (!car.inCleanCorner) {
          car.inCleanCorner = true;
          car.cornerDirty = car.offTrack;
        }
      } else if (car.inCleanCorner && absC < 0.0045) {
        if (!car.cornerDirty && !car.offTrack) {
          car.boost = Math.min(100, car.boost + 12);
        }
        car.inCleanCorner = false;
        car.cornerDirty = false;
      }

      const oldS = this.prevS[i];
      const newS = car.s;

      if (!this.crossedStartLine[i]) {
        if (oldS > L * 0.75 && newS < L * 0.25) {
          this.crossedStartLine[i] = true;
        }
      }

      if (newS > L * 0.35 && newS < L * 0.65) {
        car.passedHalfway = true;
      }

      // Sector splits (S1 at L/3, S2 at 2L/3)
      if (this.crossedStartLine[i] && !car.finished) {
        const curSec = newS < sec1End ? 0 : newS < sec2End ? 1 : 2;
        if (curSec === (car.sectorIndex + 1) % 3 && curSec !== 0) {
          const completedSec = car.sectorIndex;
          const secTime = this.raceTime - car.sectorStartTime;
          const prevBest = car.bestSectorTimes[completedSec];
          car.lastSectorTime = secTime;
          car.lastSectorDelta = prevBest !== null ? secTime - prevBest : null;
          car.lastSectorIdxCompleted = completedSec;
          if (prevBest === null || secTime < prevBest) {
            car.bestSectorTimes[completedSec] = secTime;
          }
          car.sectorIndex = curSec;
          car.sectorStartTime = this.raceTime;

          if (i === 0) {
            const deltaStr =
              car.lastSectorDelta !== null
                ? ` (${car.lastSectorDelta <= 0 ? '' : '+'}${car.lastSectorDelta.toFixed(2)}s)`
                : '';
            this.events.push({
              type: 'sector',
              text: `SECTOR ${completedSec + 1} · ${secTime.toFixed(2)}s${deltaStr}`,
              positive: car.lastSectorDelta === null || car.lastSectorDelta <= 0,
            });
          }
        }
      }

      // Finish line crossing (Lap completion + Sector 3)
      if (oldS > L * 0.78 && newS < L * 0.22 && car.passedHalfway) {
        if (!car.finished) {
          if (car.sectorIndex === 2) {
            const secTime = this.raceTime - car.sectorStartTime;
            const prevBest = car.bestSectorTimes[2];
            car.lastSectorTime = secTime;
            car.lastSectorDelta = prevBest !== null ? secTime - prevBest : null;
            car.lastSectorIdxCompleted = 2;
            if (prevBest === null || secTime < prevBest) {
              car.bestSectorTimes[2] = secTime;
            }
          }
          car.sectorIndex = 0;
          car.sectorStartTime = this.raceTime;

          const lapTime = this.raceTime - car.currentLapStartTime;
          car.lapTimes.push(lapTime);
          car.lastLapTime = lapTime;
          const isNewPersonalBest = car.bestLapTime === null || lapTime < car.bestLapTime;
          if (isNewPersonalBest) {
            car.bestLapTime = lapTime;
          }
          const isNewOverallBest = this.overallBestLap === null || lapTime < this.overallBestLap;
          if (isNewOverallBest) {
            this.overallBestLap = lapTime;
          }

          car.currentLapStartTime = this.raceTime;
          car.lapsCompleted++;
          car.passedHalfway = false;

          if (i === 0) {
            if (isNewPersonalBest && car.lapsCompleted >= 1) {
              this.events.push({
                type: 'lap_record',
                text: isNewOverallBest ? 'FASTEST RACE LAP' : 'NEW PERSONAL BEST',
                subtext: `${lapTime.toFixed(2)}s`,
                positive: true,
              });
            } else {
              this.events.push({
                type: 'lap_complete',
                text: `LAP ${car.lapsCompleted} / ${TOTAL_LAPS} COMPLETE`,
                subtext: `${lapTime.toFixed(2)}s`,
                positive: true,
              });
            }
          }

          if (car.lapsCompleted >= TOTAL_LAPS) {
            car.finished = true;
            car.finishTime = this.raceTime;
          }
        }
      }

      this.prevS[i] = newS;

      if (!this.crossedStartLine[i] && car.lapsCompleted === 0 && newS > L * 0.75) {
        car.totalProgress = newS - L;
      } else {
        car.totalProgress = car.lapsCompleted * L + newS;
      }

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

    // Drift feedback events for player
    const player = this.cars[0];
    if (player.lastDriftBanked > 0) {
      this.events.push({
        type: 'drift_ok',
        text: `DRIFT COMPLETE +${player.lastDriftBanked}`,
        positive: true,
      });
    } else if (player.lastDriftBroken) {
      this.events.push({
        type: 'drift_fail',
        text: 'DRIFT COMBO LOST',
        positive: false,
      });
    }

    // 4. Standings, overtakes, and approaching rival notifications
    this.updateStandings();
    const newRanks = this.computeRankByCar();

    if (this.phase === 'racing' && this.raceTime > 1.5) {
      for (let i = 0; i < 6; i++) {
        const oldR = this.prevRanks[i];
        const newR = newRanks[i];
        if (newR < oldR && !this.cars[i].finished) {
          const gained = oldR - newR;
          this.cars[i].overtakes += gained;
          this.cars[i].boost = Math.min(100, this.cars[i].boost + 18 * gained);

          if (i === 0) {
            const passedId = this.order[newR]; // car now immediately behind player
            const rival = passedId !== undefined ? this.cars[passedId] : null;
            this.events.push({
              type: 'overtake',
              text: rival ? `OVERTAKE · ${rival.spec.number} ${rival.spec.name}` : 'OVERTAKE',
              subtext: `P${newR}`,
              positive: true,
            });
          }
        } else if (i === 0 && newR > oldR && !this.cars[0].finished) {
          const passerId = this.order[newR - 2];
          const rival = passerId !== undefined ? this.cars[passerId] : null;
          if (rival) {
            this.events.push({
              type: 'overtaken',
              text: `PASSED BY ${rival.spec.number} ${rival.spec.name}`,
              subtext: `P${newR}`,
              positive: false,
            });
          }
        }
      }
    }
    this.prevRanks = newRanks;

    // Approaching opponent alert (when rival is closing within 14m ahead or behind)
    if (this.phase === 'racing' && this.approachCooldown <= 0 && !player.finished) {
      for (let i = 1; i < 6; i++) {
        const rival = this.cars[i];
        let ds = rival.s - player.s;
        if (ds > L * 0.5) ds -= L;
        if (ds < -L * 0.5) ds += L;
        if (Math.abs(ds) < 13 && Math.abs(ds) > 2.5) {
          const relPos = newRanks[i];
          const relation = ds > 0 ? 'AHEAD' : 'CLOSING IN';
          this.events.push({
            type: 'approach',
            text: `${rival.spec.number} ${rival.spec.name} · P${relPos}`,
            subtext: relation,
            positive: ds > 0,
          });
          this.approachCooldown = 4.2;
          break;
        }
      }
    }

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

  getPlayerRaceProgress(): number {
    const player = this.cars[0];
    const totalRaceLen = CIRCUIT.totalLength * TOTAL_LAPS;
    return Math.max(0, Math.min(1, player.totalProgress / totalRaceLen));
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
