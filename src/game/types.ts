export type RoofSymbol = 'diamond' | 'chevron' | 'bolt' | 'shield' | 'star' | 'comet';

export type AIPersonality =
  | 'balanced'
  | 'aggressive'
  | 'speedster'
  | 'defensive'
  | 'cornering'
  | 'opportunistic';

export interface CarSpec {
  index: number;
  number: string; // '00', '07', '12', '18', '23', '31'
  name: string;
  colorHex: string;
  secondaryHex: string;
  colorNum: number;
  accentNum: number;
  symbol: RoofSymbol;
  personality: AIPersonality;
  isPlayer: boolean;
  baseSkill: number;
  aggression: number;
  mistakeRate: number;
  straightBoost: number;
  cornerGripSkill: number;
  cornerCaution: number;
}

export interface InputState {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. +1 (right)
  handbrake: boolean;
  nitro: boolean;
  resetPressed: boolean;
}

export interface CarState {
  index: number;
  spec: CarSpec;
  x: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  angularVel: number;
  steerAngle: number;
  wheelSpin: number;
  bodyRoll: number;
  bodyPitch: number;
  forwardSpeed: number;
  lateralSpeed: number;
  isDrifting: boolean;
  isBraking: boolean;
  isOffTrack: boolean;
  /** Drift scoring & combo */
  driftAngleDeg: number;
  driftTime: number;
  currentDriftScore: number;
  driftCombo: number;
  totalDriftScore: number;
  bestDriftCombo: number;
  cleanDriftCooldown: number;
  /** Nitro Boost (0..100) */
  nitro: number;
  isBoosting: boolean;
  nitroLockedUntilRecharge: boolean;
  boostSecondsUsed: number;
  boostActivations: number;
  /** Track projection state */
  trackIdx: number;
  trackS: number;
  trackD: number;
  /** Corner reward tracking */
  inCornerZone: boolean;
  cornerClean: boolean;
  /** Race progress & stats */
  sector: number;
  maxSectorReached: number;
  completedLaps: number;
  finished: boolean;
  finishTime: number | null;
  currentLapStart: number;
  currentSectorStart: number;
  lastSectorSplits: number[];
  bestLapTime: number | null;
  lapTimes: number[];
  totalProgress: number;
  overtakes: number;
  collisions: number;
  lastRank: number;
  /** Collision & stuck tracking */
  barrierHitCooldown: number;
  carHitCooldown: number;
  stuckTimer: number;
  wasStuck: boolean;
  anchorX: number;
  anchorZ: number;
  anchorTimer: number;
  /** AI state */
  aiLaneOffset: number;
  aiTargetOffset: number;
  aiAltLineTimer: number;
  aiAltLineBias: number;
  aiMistakeTimer: number;
  aiMistakeSteer: number;
  aiMistakeBrake: number;
  aiNextMistakeCheck: number;
  aiRecoveryTimer: number;
  aiRecoveryDir: number;
}

export interface SimEvent {
  type:
    | 'skid'
    | 'smoke'
    | 'dust'
    | 'sparks'
    | 'barrier'
    | 'car_hit'
    | 'lap'
    | 'best_lap'
    | 'sector'
    | 'countdown'
    | 'finish'
    | 'drift_bank'
    | 'drift_break'
    | 'overtake'
    | 'nitro_start';
  carIndex: number;
  otherIndex?: number;
  x?: number;
  z?: number;
  heading?: number;
  intensity?: number;
  value?: number;
  extra?: number;
}

export interface RaceState {
  seed: number;
  totalLaps: number;
  phase: 'countdown' | 'racing' | 'finished';
  countdownTimer: number;
  countdownStep: number;
  raceTime: number;
  totalSimTime: number;
  cars: CarState[];
  order: number[];
  barrierHits: number;
  playerAutopilot: boolean;
  bestSectorsOverall: Array<number | null>;
  overallBestLap: number | null;
  events: SimEvent[];
}

export interface BenchResult {
  laps: number[];
  order: number[];
  barrierHits: number;
  stuck: number;
}
