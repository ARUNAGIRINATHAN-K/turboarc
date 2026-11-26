import { RacingAudio } from './audio';
import { ControlInput } from './physics';
import { CameraMode, RacingRenderer3D } from './renderer3d';
import { BenchRaceResult, FIXED_DT, RaceSimulation, runBenchRace } from './sim';
import { GameScreenState, RACING_STYLES, RacingUI } from './ui';

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

  // Inject self-contained stylesheet once
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

  const keysHeld = new Set<string>();

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
    audio.setMuted(!audio.isMuted());
    ui.setMutedLabel(audio.isMuted());
  };

  const ui = new RacingUI(shell, {
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
  });

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
      if ((code === 'Enter' || code === 'Space') && !e.repeat) {
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
    }

    keysHeld.add(code);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    keysHeld.delete(e.code);
  };

  const clearKeys = () => {
    keysHeld.clear();
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
    const up = keysHeld.has('ArrowUp') || keysHeld.has('KeyW');
    const down = keysHeld.has('ArrowDown') || keysHeld.has('KeyS');
    const left = keysHeld.has('ArrowLeft') || keysHeld.has('KeyA');
    const right = keysHeld.has('ArrowRight') || keysHeld.has('KeyD');
    const handbrake = keysHeld.has('Space');
    return {
      throttle: up ? 1 : 0,
      brake: down ? 1 : 0,
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      handbrake,
    };
  };

  const tick = () => {
    if (disposed) return;

    const now = performance.now();
    // Clamp frame dt to 0.05s on GPU, or allow steady steps up to 0.12s in software WebGL so demo progresses crisply
    const maxStep = renderer3d.isSoftwareGl ? 0.12 : 0.05;
    const rawDt = Math.min(maxStep, Math.max(0.001, (now - lastTimestamp) / 1000));
    lastTimestamp = now;

    if (screenState === 'playing') {
      accumulator += rawDt;
      const manualInput = isDemo ? undefined : readManualInput();
      let steps = 0;
      while (accumulator >= FIXED_DT && steps < 10) {
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

        if (sim.cars[0].lastImpactIntensity > 0.12) {
          audio.playImpact(sim.cars[0].lastImpactIntensity);
        }
      }

      if (goFlashTimer > 0) {
        goFlashTimer = Math.max(0, goFlashTimer - rawDt);
      }

      renderer3d.updateGantryLights(sim.phase, sim.getCountdownDisplay());
      ui.updateHUD(
        sim.cars,
        sim.order,
        sim.phase,
        sim.getCountdownDisplay(),
        goFlashTimer,
        sim.raceTime
      );

      const player = sim.cars[0];
      audio.update(player.speedKmh, player.throttle, player.driftIntensity, sim.phase === 'racing');

      if (sim.phase === 'finished') {
        screenState = 'gameover';
        audio.silenceLoops();
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

  // Start initial countdown sound if autostarting
  if (screenState === 'playing') {
    renderer3d.updateGantryLights(sim.phase, sim.getCountdownDisplay());
    ui.updateHUD(sim.cars, sim.order, sim.phase, sim.getCountdownDisplay(), 0, 0);
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
