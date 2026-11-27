import { RacingAudio } from './audio';
import { ControlInput } from './physics';
import { CameraMode, RacingRenderer3D } from './renderer3d';
import { BenchRaceResult, FIXED_DT, RaceSimulation, runBenchRace } from './sim';
import { GameScreenState, GameSettings, RACING_STYLES, RacingUI } from './ui';
import { CIRCUIT } from './track';

declare global {
  interface Window {
    bench?: {
      race: (seed: number, seconds: number) => BenchRaceResult;
    };
  }
}

export function installBenchGlobal(): void {
  window.bench = {
    race: runBenchRace,
  };
}

export function mountRacingGame(hostElement: HTMLElement): () => void {
  installBenchGlobal();

  let styleEl = document.getElementById('apex-racing-styles') as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'apex-racing-styles';
    styleEl.textContent = RACING_STYLES;
    document.head.appendChild(styleEl);
  }

  const params = new URLSearchParams(window.location.search);
  const isDemo = params.get('demo') === '1' || params.get('demo') === 'true';
  const isAutostart = params.get('autostart') === '1' || isDemo;
  const seedParam = params.get('seed');
  const parsedSeed = seedParam !== null && seedParam.trim() !== '' ? Number(seedParam) : NaN;
  const baseSeed = Number.isFinite(parsedSeed) ? Math.floor(parsedSeed) : 42;

  const settings: GameSettings = {
    racingLine: true,
    cameraShake: true,
    visualEffects: true,
    touchControls: 'auto',
    muted: false,
  };

  const shell = document.createElement('div');
  shell.className = 'race-shell';
  const canvasMount = document.createElement('div');
  canvasMount.className = 'canvas-mount';
  canvasMount.setAttribute('data-testid', 'race-canvas');
  shell.appendChild(canvasMount);
  hostElement.appendChild(shell);

  const renderer3d = new RacingRenderer3D(canvasMount);
  const audio = new RacingAudio();

  let screenState: GameScreenState = isAutostart ? 'playing' : 'title';
  let sim = new RaceSimulation(baseSeed, isDemo);
  let accumulator = 0;
  let lastCountdownNum = sim.getCountdownDisplay();
  let goFlashTimer = 0;
  let demoRestartTimer = 0;
  let lastTimestamp = performance.now();
  let disposed = false;

  // Contextual first-race hints
  let shownBrakeHint = false;
  let shownDriftHint = false;
  let shownNitroHint = false;

  const keysHeld = new Set<string>();

  const applySettingsToSubsystems = (next: GameSettings) => {
    settings.racingLine = next.racingLine;
    settings.cameraShake = next.cameraShake;
    settings.visualEffects = next.visualEffects;
    settings.touchControls = next.touchControls;
    settings.muted = next.muted;
    renderer3d.setRacingLineVisible(next.racingLine);
    renderer3d.cameraShakeEnabled = next.cameraShake;
    renderer3d.fxEnabled = next.visualEffects;
    audio.setMuted(next.muted);
  };

  const startRace = (newSeed?: number) => {
    audio.unlock();
    const raceSeed = newSeed !== undefined ? newSeed : baseSeed;
    sim = new RaceSimulation(raceSeed, isDemo);
    accumulator = 0;
    lastCountdownNum = sim.getCountdownDisplay();
    goFlashTimer = 0;
    demoRestartTimer = 0;
    renderer3d.clearSkidsAndSmoke();
    if (isDemo) {
      renderer3d.cameraMode = 'chase';
    }
    ui.setCameraLabel(renderer3d.cameraMode);
    ui.setContextHint('');
    screenState = 'playing';
    ui.setScreenState(screenState, isDemo);
    keysHeld.clear();
  };

  const toggleCamera = () => {
    const next: CameraMode = renderer3d.cameraMode === 'chase' ? 'cockpit' : 'chase';
    renderer3d.cameraMode = next;
    ui.setCameraLabel(next);
  };

  const togglePause = () => {
    if (ui.hasSubModalOpen()) {
      ui.closeSubModals();
      return;
    }
    if (screenState === 'playing') {
      screenState = 'paused';
      audio.silenceLoops();
      keysHeld.clear();
      ui.setScreenState('paused', isDemo);
    } else if (screenState === 'paused') {
      screenState = 'playing';
      lastTimestamp = performance.now();
      ui.setScreenState('playing', isDemo);
    }
  };

  const toggleMute = () => {
    audio.unlock();
    const muted = !audio.isMuted();
    audio.setMuted(muted);
    settings.muted = muted;
    ui.setMutedLabel(muted);
  };

  const ui = new RacingUI(shell, settings, {
    onStartRace: () => startRace(baseSeed),
    onResume: () => {
      if (screenState === 'paused') togglePause();
    },
    onRestart: () => startRace(baseSeed),
    onMainMenu: () => {
      screenState = 'title';
      audio.silenceLoops();
      sim = new RaceSimulation(baseSeed, isDemo);
      renderer3d.clearSkidsAndSmoke();
      ui.setContextHint('');
      ui.setScreenState('title', isDemo);
    },
    onToggleCamera: toggleCamera,
    onResetCar: () => {
      if (screenState === 'playing' && !isDemo) {
        sim.resetPlayer();
      }
    },
    onToggleMute: toggleMute,
    onTogglePause: togglePause,
    onSettingsChange: applySettingsToSubsystems,
  });

  applySettingsToSubsystems(settings);
  ui.setScreenState(screenState, isDemo);
  ui.setCameraLabel(renderer3d.cameraMode);
  ui.setMutedLabel(audio.isMuted());

  const onKeyDown = (e: KeyboardEvent) => {
    const code = e.code;
    if (
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'Space'
    ) {
      e.preventDefault();
    }

    if (screenState === 'title') {
      if (code === 'Escape' && ui.hasSubModalOpen()) {
        ui.closeSubModals();
        return;
      }
      if ((code === 'Enter' || code === 'Space') && !e.repeat && !ui.hasSubModalOpen()) {
        startRace(baseSeed);
      }
      return;
    }

    if (screenState === 'gameover') {
      if (code === 'Enter' && !e.repeat) {
        startRace(baseSeed);
      }
      return;
    }

    if (!e.repeat) {
      if (code === 'KeyP' || code === 'Escape') {
        togglePause();
        return;
      }
      if (code === 'KeyC' && screenState === 'playing') {
        toggleCamera();
      }
      if (code === 'KeyR' && screenState === 'playing') {
        sim.resetPlayer();
      }
      if (code === 'KeyM') {
        toggleMute();
      }
      if (code === 'KeyL') {
        settings.racingLine = !settings.racingLine;
        applySettingsToSubsystems(settings);
        ui.syncSettings(settings);
      }
    }

    keysHeld.add(code);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    keysHeld.delete(e.code);
  };

  const clearKeys = () => {
    keysHeld.clear();
    ui.touchState.left = false;
    ui.touchState.right = false;
    ui.touchState.throttle = false;
    ui.touchState.brake = false;
    ui.touchState.handbrake = false;
    ui.touchState.boost = false;
  };

  const onResize = () => {
    renderer3d.resize(shell.clientWidth || window.innerWidth, shell.clientHeight || window.innerHeight);
  };

  const resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(shell);

  window.addEventListener('keydown', onKeyDown, { passive: false });
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clearKeys);
  document.addEventListener('visibilitychange', clearKeys);

  const readManualInput = (): ControlInput => {
    const t = ui.touchState;
    const up = keysHeld.has('ArrowUp') || keysHeld.has('KeyW') || t.throttle;
    const down = keysHeld.has('ArrowDown') || keysHeld.has('KeyS') || t.brake;
    const left = keysHeld.has('ArrowLeft') || keysHeld.has('KeyA') || t.left;
    const right = keysHeld.has('ArrowRight') || keysHeld.has('KeyD') || t.right;
    const handbrake = keysHeld.has('Space') || t.handbrake;
    const boost = keysHeld.has('ShiftLeft') || keysHeld.has('ShiftRight') || t.boost;
    return {
      throttle: up ? 1 : 0,
      brake: down ? 1 : 0,
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      handbrake,
      boost,
    };
  };

  const updateContextualHints = () => {
    if (isDemo || sim.phase !== 'racing' || sim.cars[0].lapsCompleted >= 1) {
      ui.setContextHint('');
      return;
    }
    const player = sim.cars[0];
    const smp = CIRCUIT.sampleAtS(player.s);
    if (!shownBrakeHint && smp.brakingZone > 0.55) {
      shownBrakeHint = true;
      ui.setContextHint('Brake before the red racing line');
      return;
    }
    if (!shownDriftHint && Math.abs(smp.curvature) > 0.01 && player.speedKmh > 75) {
      shownDriftHint = true;
      ui.setContextHint('Hold SPACE through the corner to drift');
      return;
    }
    if (!shownNitroHint && player.boost >= 35 && Math.abs(smp.curvature) < 0.004 && sim.raceTime > 5) {
      shownNitroHint = true;
      ui.setContextHint('Press SHIFT to activate nitro boost');
      return;
    }
    if (sim.raceTime > 24) {
      ui.setContextHint('');
    }
  };

  const tick = () => {
    if (disposed) return;

    const now = performance.now();
    const maxStep = renderer3d.isSoftwareGl ? 0.25 : 0.05;
    const rawDt = Math.min(maxStep, Math.max(0.001, (now - lastTimestamp) / 1000));
    lastTimestamp = now;

    if (screenState === 'playing') {
      accumulator += rawDt;
      const manualInput = isDemo ? undefined : readManualInput();
      let steps = 0;
      while (accumulator >= FIXED_DT && steps < 16) {
        const prevPhase = sim.phase;
        sim.step(FIXED_DT, manualInput);
        accumulator -= FIXED_DT;
        steps++;

        if (sim.phase === 'countdown') {
          const cd = sim.getCountdownDisplay();
          if (cd !== lastCountdownNum) {
            lastCountdownNum = cd;
            audio.playBeep(false);
          }
        } else if (prevPhase === 'countdown' && sim.phase === 'racing') {
          goFlashTimer = 0.85;
          audio.playBeep(true);
        }

        if (sim.events.length > 0) {
          const priority = sim.events[0];
          ui.pushEvent(priority);
          if (priority.type === 'overtake' || priority.type === 'lap_record' || priority.type === 'drift_ok') {
            audio.playChime(true);
          } else if (priority.type === 'drift_fail') {
            audio.playChime(false);
          }
        }

        if (sim.cars[0].lastImpactIntensity > 0.12) {
          audio.playImpact(sim.cars[0].lastImpactIntensity);
        }
      }

      if (goFlashTimer > 0) {
        goFlashTimer = Math.max(0, goFlashTimer - rawDt);
      }

      updateContextualHints();
      renderer3d.updateGantryLights(sim.phase, sim.getCountdownDisplay());
      ui.updateHUD(
        sim.cars,
        sim.order,
        sim.phase,
        sim.getCountdownDisplay(),
        goFlashTimer,
        sim.raceTime,
        sim.getPlayerRaceProgress(),
        rawDt
      );

      const player = sim.cars[0];
      audio.update(player.speedKmh, player.throttle, player.driftIntensity, player.boosting, sim.phase === 'racing');

      if (sim.phase === 'finished') {
        screenState = 'gameover';
        audio.silenceLoops();
        ui.setContextHint('');
        if (sim.getPlayerPosition() <= 3) {
          renderer3d.triggerPodiumConfetti();
        }
        ui.showResults(sim.cars, sim.order, isDemo);
        ui.setScreenState('gameover', isDemo);
        demoRestartTimer = isDemo ? 4.5 : 0;
      }
    } else if (screenState === 'gameover') {
      if (isDemo) {
        demoRestartTimer -= rawDt;
        if (demoRestartTimer <= 0) {
          startRace(baseSeed);
        }
      }
    }

    renderer3d.syncAndRender(sim.cars, rawDt, screenState);
    renderer3d.scheduleNextFrame(tick);
  };

  if (screenState === 'playing') {
    renderer3d.updateGantryLights(sim.phase, sim.getCountdownDisplay());
    ui.updateHUD(sim.cars, sim.order, sim.phase, sim.getCountdownDisplay(), 0, 0, 0, FIXED_DT);
  }

  renderer3d.syncAndRender(sim.cars, FIXED_DT, screenState);
  renderer3d.scheduleNextFrame(tick);

  return () => {
    disposed = true;
    resizeObserver.disconnect();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', clearKeys);
    document.removeEventListener('visibilitychange', clearKeys);
    audio.dispose();
    ui.dispose();
    renderer3d.dispose();
    if (shell.parentNode === hostElement) {
      hostElement.removeChild(shell);
    }
  };
}
