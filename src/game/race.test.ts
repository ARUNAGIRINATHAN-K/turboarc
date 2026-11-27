import test from 'node:test';
import assert from 'node:assert/strict';
import { BARRIER_HALF_WIDTH, CircuitTrack, DEFAULT_CAR_SPECS } from './track';
import { CAR_RADIUS, CIRCLE_RADIUS, stepCarPhysics } from './physics';
import { createRaceState, FIXED_DT, runHeadlessRace, stepRace } from './race';
import { SeededRNG } from './prng';
import { InputState, SimEvent } from './types';

test('CircuitTrack is closed, non-self-intersecting, and includes straights, sweepers, hairpin, and corner markers', () => {
  const track = new CircuitTrack();
  assert.ok(track.totalLength > 900);

  const first = track.samples[0];
  const last = track.samples[track.samples.length - 1];
  assert.ok(Math.hypot(first.x - last.x, first.z - last.z) < 5);

  const minClearance = BARRIER_HALF_WIDTH * 2;
  for (let i = 0; i < track.count; i++) {
    for (let j = i + 22; j < track.count; j++) {
      if (track.count - j + i < 22) continue;
      const a = track.samples[i];
      const b = track.samples[j];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > minClearance);
    }
  }

  let maxAbsKappa = 0;
  let hasBrakingZone = false;
  let hasGreenZone = false;
  for (const s of track.samples) {
    if (Math.abs(s.kappa) > maxAbsKappa) maxAbsKappa = Math.abs(s.kappa);
    if (s.brakeIntensity > 0.65) hasBrakingZone = true;
    if (s.brakeIntensity < 0.1) hasGreenZone = true;
  }
  assert.ok(maxAbsKappa > 0.025, 'Track must include a tight hairpin');
  assert.ok(hasBrakingZone && hasGreenZone, 'Dynamic racing line must include green and red braking zones');
  assert.ok(track.corners.length >= 4, 'Track should detect numbered corner markers');
});

test('Six unique Turbovex 2.0 cars have distinct numbers, names, colors, and personalities', () => {
  assert.equal(DEFAULT_CAR_SPECS.length, 6);
  const numbers = new Set(DEFAULT_CAR_SPECS.map((c) => c.number));
  const names = new Set(DEFAULT_CAR_SPECS.map((c) => c.name));
  const symbols = new Set(DEFAULT_CAR_SPECS.map((c) => c.symbol));
  assert.equal(numbers.size, 6);
  assert.equal(names.size, 6);
  assert.equal(symbols.size, 6);
  assert.equal(DEFAULT_CAR_SPECS[0].name, 'PLAYER');
  assert.equal(DEFAULT_CAR_SPECS[0].number, '00');
});

test('Drift combo scoring, nitro boost activation/lockout, barrier clamping, and reset work', () => {
  const track = new CircuitTrack();
  const state = createRaceState(1, track, false);
  const car = state.cars[0];
  const events: SimEvent[] = [];

  // Position car at beginning of the long main straight (s=10..240)
  const startSp = track.sampleAtS(10);
  car.x = startSp.x;
  car.z = startSp.z;
  car.heading = Math.atan2(startSp.tz, startSp.tx);
  car.trackIdx = Math.floor((10 / track.totalLength) * track.count);

  // Accelerate straight
  const gas: InputState = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false, resetPressed: false };
  for (let i = 0; i < 110; i++) {
    stepCarPhysics(car, gas, track, FIXED_DT, events, true);
  }
  const baseSpeed = car.forwardSpeed;
  assert.ok(baseSpeed > 35);

  // Activate Nitro boost
  const initialNitro = car.nitro;
  const boostInput: InputState = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: true, resetPressed: false };
  for (let i = 0; i < 45; i++) {
    stepCarPhysics(car, boostInput, track, FIXED_DT, events, true);
  }
  assert.ok(car.forwardSpeed > baseSpeed + 8, `Nitro should boost speed (${baseSpeed.toFixed(1)} -> ${car.forwardSpeed.toFixed(1)})`);
  assert.ok(car.nitro < initialNitro, 'Nitro should drain while boosting');
  assert.ok(car.boostActivations >= 1);

  // Drain nitro completely and verify lockout prevents instant flutter until recharged >= 15%
  for (let i = 0; i < 180; i++) {
    stepCarPhysics(car, boostInput, track, FIXED_DT, events, true);
  }
  assert.equal(car.nitro, 0);
  assert.equal(car.nitroLockedUntilRecharge, true);
  stepCarPhysics(car, boostInput, track, FIXED_DT, events, true);
  assert.equal(car.isBoosting, false, 'Cannot boost when nitro depleted below recharge threshold');

  // Re-center onto asphalt straight at 42 m/s before testing drift score & combo banking
  const driftSp = track.sampleAtS(10);
  car.x = driftSp.x;
  car.z = driftSp.z;
  car.heading = Math.atan2(driftSp.tz, driftSp.tx);
  car.vx = driftSp.tx * 42;
  car.vz = driftSp.tz * 42;
  car.trackIdx = Math.floor((10 / track.totalLength) * track.count);
  car.trackD = 0;
  car.isOffTrack = false;

  // Drift with Space + steer, then release cleanly to bank score & refill nitro
  events.length = 0;
  const driftInput: InputState = { throttle: 1, brake: 0, steer: 0.7, handbrake: true, nitro: false, resetPressed: false };
  for (let i = 0; i < 40; i++) {
    stepCarPhysics(car, driftInput, track, FIXED_DT, events, true);
  }
  assert.ok(car.currentDriftScore > 25, `Drifting should accumulate score, got ${car.currentDriftScore}`);
  assert.ok(car.nitro > 0, 'Drifting should recharge nitro');
  assert.ok(events.some((e) => e.type === 'skid'));
  assert.ok(events.some((e) => e.type === 'smoke'));

  // Release handbrake cleanly to bank drift score
  for (let i = 0; i < 30; i++) {
    stepCarPhysics(car, gas, track, FIXED_DT, events, true);
  }
  assert.ok(car.totalDriftScore > 0, 'Clean drift exit should bank drift score');
  assert.ok(events.some((e) => e.type === 'drift_bank'));

  // Barrier clamp
  for (let i = 0; i < 180; i++) {
    stepCarPhysics(car, { throttle: 1, brake: 0, steer: 0.5, handbrake: false, nitro: false, resetPressed: false }, track, FIXED_DT, events, true);
    assert.ok(Math.abs(car.trackD) <= BARRIER_HALF_WIDTH - CAR_RADIUS + 0.01);
  }

  // Reset
  stepCarPhysics(car, { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, resetPressed: true }, track, FIXED_DT, events, true);
  assert.ok(Math.abs(car.trackD) < 0.01);
  assert.equal(car.forwardSpeed, 0);
});

test('Cars collide with each other and never pass through', () => {
  const track = new CircuitTrack();
  const rng = new SeededRNG(7);
  const state = createRaceState(7, track, true);
  for (let s = 0; s < 25 * 60; s++) {
    stepRace(state, track, rng, { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, resetPressed: false }, FIXED_DT);
    for (let i = 0; i < state.cars.length; i++) {
      for (let j = i + 1; j < state.cars.length; j++) {
        const a = state.cars[i];
        const b = state.cars[j];
        assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > CIRCLE_RADIUS * 1.5);
      }
    }
  }
});

test('runHeadlessRace is deterministic across seeds, completes 3 laps, and has 0 stuck cars', () => {
  const r1 = runHeadlessRace(42, 160);
  const r2 = runHeadlessRace(42, 160);
  assert.deepEqual(r1, r2);
  assert.equal(r1.laps.length, 6);
  assert.equal(r1.order.length, 6);
  assert.equal(new Set(r1.order).size, 6);
  assert.equal(r1.stuck, 0);
  for (let i = 0; i < 6; i++) {
    assert.ok(r1.laps[i] >= 3, `Car ${i} completed ${r1.laps[i]} laps`);
  }

  const rSeed99 = runHeadlessRace(99, 160);
  assert.equal(rSeed99.stuck, 0);
});
