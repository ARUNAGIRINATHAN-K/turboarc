import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCarAtGrid,
  resetCarToTrack,
  resolveBarrierCollision,
  resolveCarCollisions,
  stepCarPhysics,
} from './physics';
import { FIXED_DT, RaceSimulation, runBenchRace, TOTAL_LAPS } from './sim';
import { CIRCUIT } from './track';

test('circuit geometry is closed, non-self-intersecting, and has a tight hairpin', () => {
  const n = CIRCUIT.samples.length;
  assert.ok(n >= 400, 'Circuit should have dense samples');
  assert.ok(CIRCUIT.totalLength > 900 && CIRCUIT.totalLength < 3000, `Unexpected length: ${CIRCUIT.totalLength}`);

  // Check closure
  const first = CIRCUIT.samples[0];
  const last = CIRCUIT.samples[n - 1];
  const closureDist = Math.hypot(first.x - last.x, first.z - last.z);
  assert.ok(closureDist < 5.0, `Closure gap too large: ${closureDist}`);

  // Check non-adjacent centerline separation (> 34m so barriers & stands never overlap)
  let minNonAdjDist = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i + 45; j < n - 45; j++) {
      const a = CIRCUIT.samples[i];
      const b = CIRCUIT.samples[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < minNonAdjDist) minNonAdjDist = d;
    }
  }
  assert.ok(
    minNonAdjDist > 34,
    `Track segments too close (potential self-intersection): minNonAdjDist=${minNonAdjDist.toFixed(2)}`
  );

  // Check tightest hairpin exists and radius of curvature >= 16m (safe for ±11.2m barriers)
  let maxAbsCurv = 0;
  for (const s of CIRCUIT.samples) {
    maxAbsCurv = Math.max(maxAbsCurv, Math.abs(s.curvature));
  }
  const minRadius = 1 / maxAbsCurv;
  assert.ok(maxAbsCurv > 0.02, `Track needs at least one tight hairpin; maxCurv=${maxAbsCurv}`);
  assert.ok(minRadius > 15.5, `Corner radius too tight for barriers: minRadius=${minRadius.toFixed(2)}`);
});

test('car physics accelerates, brakes, drifts on Space, and resets cleanly', () => {
  const car = createCarAtGrid(0);
  // Accelerate for 3 seconds
  for (let i = 0; i < 180; i++) {
    stepCarPhysics(car, { throttle: 1, brake: 0, steer: 0, handbrake: false }, FIXED_DT);
  }
  assert.ok(car.speedKmh > 120, `Expected high speed after 3s accel, got ${car.speedKmh}`);

  // Enter corner holding Space (handbrake drift)
  for (let i = 0; i < 45; i++) {
    stepCarPhysics(car, { throttle: 0.7, brake: 0, steer: 1, handbrake: true }, FIXED_DT);
  }
  assert.equal(car.isDrifting, true, 'Car should enter drift state when steering with handbrake at speed');
  assert.ok(car.driftIntensity > 0.2, 'Drift intensity should build up');

  // Brake to slow down
  const speedBeforeBrake = car.speed;
  for (let i = 0; i < 60; i++) {
    stepCarPhysics(car, { throttle: 0, brake: 1, steer: 0, handbrake: false }, FIXED_DT);
  }
  assert.ok(car.speed < speedBeforeBrake - 15, 'Braking should strongly reduce forward speed');

  // Reset to track centerline
  resetCarToTrack(car);
  assert.equal(car.speed, 0);
  assert.equal(car.lateral, 0);
});

test('barrier collision keeps car strictly inside track bounds and counts hits', () => {
  const car = createCarAtGrid(0);
  const smp = CIRCUIT.sampleAtS(100);
  // Place car far outside barrier moving outward
  car.x = smp.x + smp.rx * 25;
  car.z = smp.z + smp.rz * 25;
  car.vx = smp.rx * 20;
  car.vz = smp.rz * 20;
  car.sampleIndex = smp.index;

  const { projection, hitBarrier } = resolveBarrierCollision(car);
  assert.equal(hitBarrier, true, 'Should register barrier hit');
  assert.ok(
    Math.abs(projection.lateral) <= CIRCUIT.barrierHalfWidth,
    `Car escaped barrier: lateral=${projection.lateral}`
  );
});

test('car-to-car collision separates overlapping cars', () => {
  const a = createCarAtGrid(0);
  const b = createCarAtGrid(1);
  b.x = a.x + 0.5;
  b.z = a.z + 0.2;
  a.vx = 10;
  b.vx = -10;

  for (let pass = 0; pass < 4; pass++) {
    resolveCarCollisions([a, b]);
  }
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  assert.ok(dist >= 1.85, `Cars remained overlapping after collision: dist=${dist}`);
});

test('window.bench.race is deterministic by seed and completes 3-lap race with zero stuck cars', () => {
  const r1 = runBenchRace(42, 135);
  const r2 = runBenchRace(42, 135);

  assert.deepEqual(r1, r2, 'Same seed must produce identical bench results');
  assert.equal(r1.laps.length, 6);
  assert.equal(r1.order.length, 6);
  assert.deepEqual([...r1.order].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
  assert.equal(r1.stuck, 0, `No cars should be stuck > 5s, got stuck=${r1.stuck}`);

  for (let i = 0; i < 6; i++) {
    assert.equal(r1.laps[i], TOTAL_LAPS, `Car ${i} should complete ${TOTAL_LAPS} laps in 135s, got ${r1.laps[i]}`);
  }

  // Different seeds should produce different race outcomes/timings
  const r3 = runBenchRace(1234, 60);
  assert.equal(r3.stuck, 0, 'Zero stuck cars on alternate seed');
  assert.ok(r3.laps.every((l) => l >= 1), `All cars should complete >= 1 lap in 60s, got ${r3.laps}`);
});

test('RaceSimulation countdown transitions cleanly into racing', () => {
  const sim = new RaceSimulation(7, true);
  assert.equal(sim.phase, 'countdown');
  assert.equal(sim.getCountdownDisplay(), 3);

  for (let i = 0; i < 120; i++) sim.step(FIXED_DT); // 2.0s elapsed
  assert.equal(sim.phase, 'countdown');
  assert.equal(sim.getCountdownDisplay(), 1);

  for (let i = 0; i < 65; i++) sim.step(FIXED_DT); // 3.08s elapsed
  assert.equal(sim.phase, 'racing');
  assert.ok(sim.cars[0].speed > 1, 'Cars should launch once countdown finishes');
});
