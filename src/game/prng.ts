/**
 * Deterministic Mulberry32 PRNG for repeatable races (?seed=N and window.bench.race).
 */
export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    // Normalize seed to unsigned 32-bit integer
    this.state = (Math.floor(seed) >>> 0) || 1;
  }

  /** Returns float in [0, 1) */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns float in [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Returns signed float in [-1, 1) */
  signed(): number {
    return this.next() * 2 - 1;
  }
}
