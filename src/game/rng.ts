/**
 * Deterministic seeded PRNG (Mulberry32) for repeatable races (?seed=N and window.bench.race).
 */
export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    // Normalize seed into an unsigned 32-bit integer
    this.state = (Math.floor(seed) | 0) >>> 0;
    if (this.state === 0) {
      this.state = 0x6d2b79f5;
    }
  }

  /** Returns a float in [0, 1). */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns a float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Returns an integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }
}
