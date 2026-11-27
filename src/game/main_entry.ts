import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RaceAudio } from './audio';
import { DriftEffectsPool } from './effects';
import { MinimapRenderer } from './minimap';
import { buildCarRig, buildCircuitEnvironment, CarRig, CircuitVisuals, GantryRig } from './models';
import { SeededRNG } from './prng';
import { createRaceState, FIXED_DT, runHeadlessRace, stepRace } from './race';
import { CircuitTrack } from './track';
import { BenchResult, CarState, InputState, RaceState } from './types';

declare global {
  interface Window {
    bench: {
      race: (seed: number, seconds: number) => BenchResult;
    };
  }
}

interface GameSettings {
  racingLine: boolean;
  cameraShake: boolean;
  visualEffects: boolean;
  touchControls: 'auto' | 'on' | 'off';
  muted: boolean;
}

const SETTINGS_STORAGE_KEY = 'turbovex2_settings';

function loadSettings(): GameSettings {
  const defaults: GameSettings = {
    racingLine: true,
    cameraShake: true,
    visualEffects: true,
    touchControls: 'auto',
    muted: false,
  };
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      racingLine: typeof parsed.racingLine === 'boolean' ? parsed.racingLine : defaults.racingLine,
      cameraShake: typeof parsed.cameraShake === 'boolean' ? parsed.cameraShake : defaults.cameraShake,
      visualEffects: typeof parsed.visualEffects === 'boolean' ? parsed.visualEffects : defaults.visualEffects,
      touchControls:
        parsed.touchControls === 'on' || parsed.touchControls === 'off' || parsed.touchControls === 'auto'
          ? parsed.touchControls
          : defaults.touchControls,
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : defaults.muted,
    };
  } catch {
    return defaults;
  }
}

function saveSettings(settings: GameSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors in sandboxed frames
  }
}

function formatTime(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return '--:--.--';
  const totalMs = Math.max(0, Math.round(sec * 1000));
  const mins = Math.floor(totalMs / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const cs = Math.floor((totalMs % 1000) / 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function ordinal(pos: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const v = pos % 100;
  return pos + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
}

function detectSoftwareGl(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

function isTouchDevice(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

interface ConfettiPiece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vRot: number;
  color: string;
  life: number;
}

export function initRacingGame(): void {
  const params = new URLSearchParams(window.location.search);
  const isDemoMode = params.get('demo') === '1';
  const isAutostart = params.get('autostart') === '1' || isDemoMode;
  const seedParam = params.get('seed');
  const parseSeed = (): number => {
    if (seedParam !== null && seedParam.trim() !== '') {
      const n = parseInt(seedParam, 10);
      if (Number.isFinite(n)) return (Math.abs(n) >>> 0) || 1;
    }
    return ((Date.now() & 0xffffff) >>> 0) || 42;
  };

  let currentSeed = parseSeed();
  const track = new CircuitTrack();
  const settings = loadSettings();

  // Expose synchronous headless benchmark API immediately
  window.bench = {
    race: (seed: number, seconds: number): BenchResult => {
      return runHeadlessRace(seed, seconds, track);
    },
  };

  // DOM References
  const canvasHost = document.getElementById('canvas-host') as HTMLElement;
  const titleOverlay = document.getElementById('title-overlay') as HTMLElement;
  const hudOverlay = document.getElementById('hud-overlay') as HTMLElement;
  const pauseOverlay = document.getElementById('pause-overlay') as HTMLElement;
  const resultsOverlay = document.getElementById('results-overlay') as HTMLElement;
  const controlsOverlay = document.getElementById('controls-overlay') as HTMLElement;
  const settingsOverlay = document.getElementById('settings-overlay') as HTMLElement;
  const howtoOverlay = document.getElementById('howto-overlay') as HTMLElement;
  const countdownEl = document.getElementById('countdown-banner') as HTMLElement;

  // HUD Top-Left
  const posEl = document.getElementById('hud-pos') as HTMLElement;
  const lapEl = document.getElementById('hud-lap') as HTMLElement;
  const progressPctEl = document.getElementById('hud-progress-pct') as HTMLElement;
  const progressBarEl = document.getElementById('hud-progress-bar') as HTMLElement;
  const sectorSplitEl = document.getElementById('hud-sector-split') as HTMLElement;
  const demoBadge = document.getElementById('hud-demo-badge') as HTMLElement;

  // HUD Top-Right
  const curLapEl = document.getElementById('hud-cur-lap') as HTMLElement;
  const bestLapEl = document.getElementById('hud-best-lap') as HTMLElement;
  const totalTimeEl = document.getElementById('hud-total-time') as HTMLElement;

  // HUD Bottom-Center
  const speedEl = document.getElementById('hud-speed') as HTMLElement;
  const gearEl = document.getElementById('hud-gear') as HTMLElement;
  const throttleBarEl = document.getElementById('hud-throttle-bar') as HTMLElement;
  const brakeBarEl = document.getElementById('hud-brake-bar') as HTMLElement;
  const nitroBarEl = document.getElementById('hud-nitro-bar') as HTMLElement;
  const nitroPctEl = document.getElementById('hud-nitro-pct') as HTMLElement;
  const nitroStatusEl = document.getElementById('hud-nitro-status') as HTMLElement;
  const driftBoxEl = document.getElementById('hud-drift-box') as HTMLElement;
  const driftAngleEl = document.getElementById('hud-drift-angle') as HTMLElement;
  const driftScoreEl = document.getElementById('hud-drift-score') as HTMLElement;
  const driftComboEl = document.getElementById('hud-drift-combo') as HTMLElement;
  const camBadge = document.getElementById('hud-cam') as HTMLElement;

  // HUD Alerts & Hints
  const rivalToastEl = document.getElementById('hud-rival-toast') as HTMLElement;
  const eventToastEl = document.getElementById('hud-event-toast') as HTMLElement;
  const hintPillEl = document.getElementById('hud-hint-pill') as HTMLElement;

  // Minimap & Touch
  const minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
  const touchControlsEl = document.getElementById('touch-controls') as HTMLElement;

  // Results & Confetti
  const seedHintEl = document.getElementById('title-seed-hint') as HTMLElement;
  const resultsSub = document.getElementById('results-subtitle') as HTMLElement;
  const resultsPodiumEl = document.getElementById('results-podium') as HTMLElement;
  const resultsStatsEl = document.getElementById('results-player-stats') as HTMLElement;
  const resultsLapsEl = document.getElementById('results-lap-splits') as HTMLElement;
  const resultsBody = document.getElementById('results-tbody') as HTMLElement;
  const confettiCanvas = document.getElementById('confetti-canvas') as HTMLCanvasElement;

  // Buttons
  const startBtn = document.getElementById('btn-start') as HTMLButtonElement;
  const menuControlsBtn = document.getElementById('btn-menu-controls') as HTMLButtonElement;
  const menuSettingsBtn = document.getElementById('btn-menu-settings') as HTMLButtonElement;
  const menuHowtoBtn = document.getElementById('btn-menu-howto') as HTMLButtonElement;

  const resumeBtn = document.getElementById('btn-resume') as HTMLButtonElement;
  const restartPauseBtn = document.getElementById('btn-restart-pause') as HTMLButtonElement;
  const pauseControlsBtn = document.getElementById('btn-pause-controls') as HTMLButtonElement;
  const pauseSettingsBtn = document.getElementById('btn-pause-settings') as HTMLButtonElement;
  const menuPauseBtn = document.getElementById('btn-menu-pause') as HTMLButtonElement;

  const raceAgainBtn = document.getElementById('btn-race-again') as HTMLButtonElement;
  const resultsMenuBtn = document.getElementById('btn-results-menu') as HTMLButtonElement;

  const camBtn = document.getElementById('btn-cam') as HTMLButtonElement;
  const lineBtn = document.getElementById('btn-line') as HTMLButtonElement;
  const resetBtn = document.getElementById('btn-reset') as HTMLButtonElement;
  const muteBtn = document.getElementById('btn-mute') as HTMLButtonElement;
  const pauseBtn = document.getElementById('btn-pause') as HTMLButtonElement;

  const closeControlsBtn = document.getElementById('btn-close-controls') as HTMLButtonElement;
  const closeSettingsBtn = document.getElementById('btn-close-settings') as HTMLButtonElement;
  const closeHowtoBtn = document.getElementById('btn-close-howto') as HTMLButtonElement;

  // Settings Inputs
  const setRacingLineChk = document.getElementById('set-racing-line') as HTMLInputElement;
  const setCameraShakeChk = document.getElementById('set-camera-shake') as HTMLInputElement;
  const setVisualEffectsChk = document.getElementById('set-visual-effects') as HTMLInputElement;
  const setAudioChk = document.getElementById('set-audio') as HTMLInputElement;
  const setTouchSelect = document.getElementById('set-touch-controls') as HTMLSelectElement;

  if (seedParam !== null) {
    seedHintEl.textContent = `SEED #${currentSeed}`;
  }
  demoBadge.style.display = isDemoMode ? 'inline-block' : 'none';

  // Three.js Renderer Setup (Software-WebGL Safe)
  const isSoftwareGl = detectSoftwareGl();
  const renderer = new THREE.WebGLRenderer({
    antialias: !isSoftwareGl,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasHost.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const skyColor = new THREE.Color(0xc8e1f8);
  scene.background = skyColor;
  scene.fog = new THREE.Fog(0xc8e1f8, 175, 580);

  // Studio PBR Environment Map
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  // Warm / Cool Lighting Rig
  const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x3f6212, 0.85);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfff1d6, 2.25);
  sunLight.position.set(80, 110, 60);
  sunLight.castShadow = !isSoftwareGl;
  sunLight.shadow.mapSize.width = 1024;
  sunLight.shadow.mapSize.height = 1024;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 260;
  const shadowExtent = 62;
  sunLight.shadow.camera.left = -shadowExtent;
  sunLight.shadow.camera.right = shadowExtent;
  sunLight.shadow.camera.top = shadowExtent;
  sunLight.shadow.camera.bottom = -shadowExtent;
  sunLight.shadow.bias = -0.0005;
  sunLight.shadow.normalBias = 0.02;
  scene.add(sunLight);
  scene.add(sunLight.target);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.2, 850);

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const visuals: CircuitVisuals = buildCircuitEnvironment(scene, track, maxAniso, isSoftwareGl);
  const gantry: GantryRig = visuals.gantry;
  const crowdBaseY = visuals.crowdDecks.map((m) => m.position.y);
  const effects = new DriftEffectsPool(scene);
  const minimap = new MinimapRenderer(minimapCanvas, track);
  const audio = new RaceAudio();

  // Build 6 Car Rigs
  let raceRng = new SeededRNG(currentSeed);
  let raceState: RaceState = createRaceState(currentSeed, track, isDemoMode);
  const carRigs: CarRig[] = raceState.cars.map((c) => {
    const rig = buildCarRig(c.spec, maxAniso, isSoftwareGl);
    scene.add(rig.root);
    return rig;
  });

  if (!isSoftwareGl) {
    renderer.compile(scene, camera);
  }

  // Game UI State
  type AppMode = 'title' | 'playing' | 'paused' | 'gameover';
  type ModalKind = 'none' | 'controls' | 'settings' | 'howto';
  let appMode: AppMode = isAutostart ? 'playing' : 'title';
  let activeModal: ModalKind = 'none';
  let modalReturnMode: AppMode = 'title';
  let cameraMode: 'chase' | 'cockpit' = 'chase';
  let accumulator = 0;
  let trauma = 0;
  let demoRestartTimer = 0;
  let lastCountdownDisplayed = -1;
  let titleTime = 0;
  let nitroTrailAccum = 0;
  let crowdCheerPhase = 0;
  let crowdBoostCheer = 0;

  // Toast & Hint State
  let eventToastTimer = 0;
  let rivalToastTimer = 0;
  let lastRivalAlertCar = -1;
  let rivalAlertCooldown = 0;
  let lastSectorText = 'SECTOR --';
  let hasDriftedInRace = false;
  let hasBoostedInRace = false;

  // Confetti State
  const confettiPieces: ConfettiPiece[] = [];
  const confettiCtx = confettiCanvas.getContext('2d');

  // Input State
  const keys = new Set<string>();
  const touchActive = {
    left: false,
    right: false,
    up: false,
    down: false,
    drift: false,
    nitro: false,
  };
  let resetQueued = false;

  const clearInputs = () => {
    keys.clear();
    touchActive.left = false;
    touchActive.right = false;
    touchActive.up = false;
    touchActive.down = false;
    touchActive.drift = false;
    touchActive.nitro = false;
    resetQueued = false;
  };

  function applySettingsToRuntime(): void {
    visuals.racingLineMesh.visible = settings.racingLine;
    effects.setExtraEffectsEnabled(settings.visualEffects);
    audio.setMuted(settings.muted);
    muteBtn.textContent = settings.muted ? '🔇' : '🔊';
    lineBtn.textContent = settings.racingLine ? 'LINE ON' : 'LINE OFF';
    lineBtn.classList.toggle('is-off', !settings.racingLine);

    const showTouch =
      !isDemoMode &&
      (settings.touchControls === 'on' || (settings.touchControls === 'auto' && isTouchDevice()));
    touchControlsEl.style.display = showTouch ? 'flex' : 'none';

    setRacingLineChk.checked = settings.racingLine;
    setCameraShakeChk.checked = settings.cameraShake;
    setVisualEffectsChk.checked = settings.visualEffects;
    setAudioChk.checked = !settings.muted;
    setTouchSelect.value = settings.touchControls;
  }

  function syncOverlayVisibility(): void {
    document.body.dataset.state = appMode;
    titleOverlay.style.display = appMode === 'title' && activeModal === 'none' ? 'flex' : 'none';
    hudOverlay.style.display = appMode === 'playing' ? 'block' : 'none';
    pauseOverlay.style.display = appMode === 'paused' && activeModal === 'none' ? 'flex' : 'none';
    resultsOverlay.style.display = appMode === 'gameover' ? 'flex' : 'none';

    controlsOverlay.style.display = activeModal === 'controls' ? 'flex' : 'none';
    settingsOverlay.style.display = activeModal === 'settings' ? 'flex' : 'none';
    howtoOverlay.style.display = activeModal === 'howto' ? 'flex' : 'none';
  }

  function openSubModal(kind: Exclude<ModalKind, 'none'>): void {
    modalReturnMode = appMode;
    activeModal = kind;
    syncOverlayVisibility();
  }

  function closeSubModal(): void {
    activeModal = 'none';
    appMode = modalReturnMode;
    syncOverlayVisibility();
  }

  function setAppMode(next: AppMode): void {
    appMode = next;
    activeModal = 'none';
    syncOverlayVisibility();

    if (next === 'playing') {
      clearInputs();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      carRigs[0].nameplate.visible = false;
    } else {
      audio.silenceLoops();
      if (next === 'title') {
        carRigs[0].nameplate.visible = true;
      }
    }
  }

  function showEventToast(message: string, variant: 'gold' | 'cyan' | 'green' | 'red', duration = 2.4): void {
    eventToastEl.textContent = message;
    eventToastEl.className = `hud-toast event-${variant}`;
    eventToastEl.style.display = 'block';
    eventToastTimer = duration;
  }

  function showRivalToast(label: string, accentHex: string, duration = 2.1): void {
    rivalToastEl.innerHTML = `<span class="rival-dot" style="background:${accentHex}"></span>${label}`;
    rivalToastEl.style.borderColor = accentHex;
    rivalToastEl.style.display = 'flex';
    rivalToastTimer = duration;
  }

  function updateGantryLights(step: number, isRacing: boolean): void {
    const numPods = gantry.lightMats.length;
    for (let i = 0; i < numPods; i++) {
      const mat = gantry.lightMats[i];
      if (!isRacing && step > 0) {
        const litCount = step === 3 ? 2 : step === 2 ? 4 : 5;
        if (i < litCount) {
          mat.color.setHex(0xef4444);
          mat.emissive.setHex(0xef4444);
          mat.emissiveIntensity = 2.8;
        } else {
          mat.color.setHex(0x1e293b);
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0;
        }
      } else {
        mat.color.setHex(0x22c55e);
        mat.emissive.setHex(0x22c55e);
        mat.emissiveIntensity = 2.6;
      }
    }
  }

  function spawnConfetti(count: number): void {
    confettiPieces.length = 0;
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
    const palette = ['#06b6d4', '#ef4444', '#facc15', '#22c55e', '#a855f7', '#fb923c', '#ffffff'];
    for (let i = 0; i < count; i++) {
      confettiPieces.push({
        x: Math.random() * confettiCanvas.width,
        y: -20 - Math.random() * 240,
        vx: (Math.random() - 0.5) * 180,
        vy: 140 + Math.random() * 220,
        size: 6 + Math.random() * 7,
        rot: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 9,
        color: palette[i % palette.length],
        life: 6.5,
      });
    }
  }

  function updateConfetti(dt: number): void {
    if (!confettiCtx) return;
    if (appMode !== 'gameover' || confettiPieces.length === 0) {
      if (confettiCanvas.width > 0) {
        confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
      }
      return;
    }
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    for (let i = confettiPieces.length - 1; i >= 0; i--) {
      const p = confettiPieces[i];
      p.life -= dt;
      if (p.life <= 0 || p.y > confettiCanvas.height + 30) {
        confettiPieces.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.992;
      p.vy += 45 * dt;
      p.rot += p.vRot * dt;

      confettiCtx.save();
      confettiCtx.translate(p.x, p.y);
      confettiCtx.rotate(p.rot);
      confettiCtx.fillStyle = p.color;
      confettiCtx.globalAlpha = Math.min(1, p.life);
      confettiCtx.fillRect(-p.size * 0.5, -p.size * 0.28, p.size, p.size * 0.56);
      confettiCtx.restore();
    }
  }

  function startNewRace(fromUserGesture = false): void {
    if (fromUserGesture) audio.init();
    if (seedParam === null && appMode === 'gameover') {
      currentSeed = ((currentSeed + 1) >>> 0) || 1;
    }
    raceRng = new SeededRNG(currentSeed);
    raceState = createRaceState(currentSeed, track, isDemoMode);
    effects.clear();
    confettiPieces.length = 0;
    accumulator = 0;
    trauma = 0;
    demoRestartTimer = 0;
    lastCountdownDisplayed = -1;
    eventToastTimer = 0;
    rivalToastTimer = 0;
    rivalAlertCooldown = 0;
    lastRivalAlertCar = -1;
    lastSectorText = 'SECTOR --';
    hasDriftedInRace = false;
    hasBoostedInRace = false;
    crowdBoostCheer = 0;
    eventToastEl.style.display = 'none';
    rivalToastEl.style.display = 'none';
    sectorSplitEl.textContent = lastSectorText;
    sectorSplitEl.className = 'hud-sector-pill tabular';

    updateGantryLights(3, false);
    countdownEl.style.display = 'block';
    countdownEl.textContent = '3';
    countdownEl.style.color = '#ef4444';
    if (fromUserGesture) audio.playCountdownBeep(false);
    syncCarMeshes();
    snapChaseCamera();
    setAppMode('playing');
  }

  function toggleCamera(): void {
    cameraMode = cameraMode === 'chase' ? 'cockpit' : 'chase';
    camBadge.textContent = cameraMode === 'chase' ? '[C] CHASE' : '[C] COCKPIT';
    const showExterior = cameraMode !== 'cockpit';
    carRigs[0].canopy.visible = showExterior;
    carRigs[0].nameplate.visible = false;
    if (carRigs[0].playerOutline) {
      carRigs[0].playerOutline.visible = showExterior;
    }
  }

  function populateResults(): void {
    const pCar = raceState.cars[0];
    const pPos = raceState.order.indexOf(0) + 1;
    const totalRaceTime = pCar.finishTime ?? raceState.raceTime;

    resultsSub.textContent = isDemoMode
      ? `DEMO COMPLETE · FINISHED ${ordinal(pPos)} OF 6 · RESTARTING...`
      : pPos === 1
        ? `VICTORY! FINISHED 1ST OF 6 · ${formatTime(totalRaceTime)}`
        : `FINISHED ${ordinal(pPos)} OF 6 · TOTAL TIME ${formatTime(totalRaceTime)}`;

    // Top-3 Podium Presentation (2nd | 1st | 3rd layout)
    resultsPodiumEl.innerHTML = '';
    const podiumOrder = [1, 0, 2]; // rank indices: 2nd, 1st, 3rd
    for (const rIdx of podiumOrder) {
      const carIdx = raceState.order[rIdx];
      if (carIdx === undefined) continue;
      const car = raceState.cars[carIdx];
      const slot = document.createElement('div');
      slot.className = `podium-slot rank-${rIdx + 1}${car.spec.isPlayer ? ' is-player' : ''}`;
      slot.innerHTML = `
        <div class="podium-rank">#${rIdx + 1}</div>
        <div class="podium-num" style="border-color:${car.spec.colorHex};color:${car.spec.colorHex}">${car.spec.number}</div>
        <div class="podium-name">${car.spec.name}</div>
        <div class="podium-time tabular">${car.finishTime !== null ? formatTime(car.finishTime) : 'FINISHED'}</div>
      `;
      resultsPodiumEl.appendChild(slot);
    }

    // Player Race Statistics Grid
    resultsStatsEl.innerHTML = `
      <div class="stat-cell"><span>Position</span><strong class="tabular">${ordinal(pPos)} / 6</strong></div>
      <div class="stat-cell"><span>Best Lap</span><strong class="tabular">${formatTime(pCar.bestLapTime)}</strong></div>
      <div class="stat-cell"><span>Overtakes</span><strong class="tabular">${pCar.overtakes}</strong></div>
      <div class="stat-cell"><span>Drift Score</span><strong class="tabular">${pCar.totalDriftScore.toLocaleString()}</strong></div>
      <div class="stat-cell"><span>Best Combo</span><strong class="tabular">${pCar.bestDriftCombo}x</strong></div>
      <div class="stat-cell"><span>Boost Used</span><strong class="tabular">${pCar.boostSecondsUsed.toFixed(1)}s</strong></div>
      <div class="stat-cell"><span>Collisions</span><strong class="tabular">${pCar.collisions}</strong></div>
      <div class="stat-cell"><span>Total Time</span><strong class="tabular">${formatTime(totalRaceTime)}</strong></div>
    `;

    // Lap-by-Lap Breakdown
    if (pCar.lapTimes.length > 0) {
      resultsLapsEl.innerHTML = pCar.lapTimes
        .map(
          (lt, idx) =>
            `<span class="lap-chip tabular${pCar.bestLapTime !== null && Math.abs(lt - pCar.bestLapTime) < 0.005 ? ' best' : ''}">LAP ${idx + 1}: ${formatTime(lt)}</span>`
        )
        .join('');
    } else {
      resultsLapsEl.innerHTML = '<span class="lap-chip">No completed laps recorded</span>';
    }

    // Full 6-Car Standings Table
    resultsBody.innerHTML = '';
    raceState.order.forEach((carIdx, rankIdx) => {
      const car = raceState.cars[carIdx];
      const tr = document.createElement('tr');
      if (car.spec.isPlayer) tr.className = 'player-row';

      const posTd = document.createElement('td');
      posTd.className = 'num-col';
      posTd.textContent = ordinal(rankIdx + 1);

      const nameTd = document.createElement('td');
      nameTd.innerHTML = `<span class="swatch" style="background:${car.spec.colorHex}"></span><span class="car-num-tag">#${car.spec.number}</span> ${car.spec.name}${car.spec.isPlayer ? ' <span class="you-tag">YOU</span>' : ''}`;

      const lapsTd = document.createElement('td');
      lapsTd.className = 'num-col';
      lapsTd.textContent = `${Math.min(car.completedLaps, raceState.totalLaps)} / ${raceState.totalLaps}`;

      const bestTd = document.createElement('td');
      bestTd.className = 'num-col';
      bestTd.textContent = formatTime(car.bestLapTime);

      const totalTd = document.createElement('td');
      totalTd.className = 'num-col';
      totalTd.textContent =
        car.finished && car.finishTime !== null ? formatTime(car.finishTime) : 'RACING';

      tr.append(posTd, nameTd, lapsTd, bestTd, totalTd);
      resultsBody.appendChild(tr);
    });

    // Confetti celebration on win or podium!
    if (pPos === 1) {
      spawnConfetti(140);
    } else if (pPos <= 3) {
      spawnConfetti(70);
    }
  }

  // Keyboard Listeners
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    if (e.repeat) {
      keys.add(e.code);
      return;
    }

    if (activeModal !== 'none') {
      if (e.code === 'Escape') closeSubModal();
      return;
    }

    if (appMode === 'title') {
      if (e.code === 'Enter' || e.code === 'Space') {
        startNewRace(true);
      }
      return;
    }

    if (appMode === 'gameover') {
      if (e.code === 'Enter') {
        startNewRace(true);
      }
      return;
    }

    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (appMode === 'playing') setAppMode('paused');
      else if (appMode === 'paused') setAppMode('playing');
      return;
    }

    if (e.code === 'KeyM') {
      audio.init();
      settings.muted = !settings.muted;
      saveSettings(settings);
      applySettingsToRuntime();
      return;
    }

    if (e.code === 'KeyL' && appMode === 'playing') {
      settings.racingLine = !settings.racingLine;
      saveSettings(settings);
      applySettingsToRuntime();
      return;
    }

    if (appMode === 'playing') {
      audio.init();
      if (e.code === 'KeyC') {
        toggleCamera();
      } else if (e.code === 'KeyR') {
        resetQueued = true;
      }
      keys.add(e.code);
    }
  });

  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
  });
  window.addEventListener('blur', clearInputs);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInputs();
  });

  // Main Menu & Modal Buttons
  startBtn.addEventListener('click', () => startNewRace(true));
  menuControlsBtn.addEventListener('click', () => openSubModal('controls'));
  menuSettingsBtn.addEventListener('click', () => openSubModal('settings'));
  menuHowtoBtn.addEventListener('click', () => openSubModal('howto'));

  resumeBtn.addEventListener('click', () => setAppMode('playing'));
  restartPauseBtn.addEventListener('click', () => startNewRace(true));
  pauseControlsBtn.addEventListener('click', () => openSubModal('controls'));
  pauseSettingsBtn.addEventListener('click', () => openSubModal('settings'));
  menuPauseBtn.addEventListener('click', () => {
    raceState = createRaceState(currentSeed, track, isDemoMode);
    effects.clear();
    syncCarMeshes();
    setAppMode('title');
  });

  raceAgainBtn.addEventListener('click', () => startNewRace(true));
  resultsMenuBtn.addEventListener('click', () => {
    raceState = createRaceState(currentSeed, track, isDemoMode);
    effects.clear();
    confettiPieces.length = 0;
    syncCarMeshes();
    setAppMode('title');
  });

  closeControlsBtn.addEventListener('click', closeSubModal);
  closeSettingsBtn.addEventListener('click', closeSubModal);
  closeHowtoBtn.addEventListener('click', closeSubModal);

  // Settings Input Wiring
  setRacingLineChk.addEventListener('change', () => {
    settings.racingLine = setRacingLineChk.checked;
    saveSettings(settings);
    applySettingsToRuntime();
  });
  setCameraShakeChk.addEventListener('change', () => {
    settings.cameraShake = setCameraShakeChk.checked;
    saveSettings(settings);
    applySettingsToRuntime();
  });
  setVisualEffectsChk.addEventListener('change', () => {
    settings.visualEffects = setVisualEffectsChk.checked;
    saveSettings(settings);
    applySettingsToRuntime();
  });
  setAudioChk.addEventListener('change', () => {
    audio.init();
    settings.muted = !setAudioChk.checked;
    saveSettings(settings);
    applySettingsToRuntime();
  });
  setTouchSelect.addEventListener('change', () => {
    settings.touchControls = setTouchSelect.value as GameSettings['touchControls'];
    saveSettings(settings);
    applySettingsToRuntime();
  });

  // HUD Utility Buttons
  camBtn.addEventListener('click', (e) => {
    if (e.currentTarget instanceof HTMLElement) e.currentTarget.blur();
    toggleCamera();
  });
  lineBtn.addEventListener('click', (e) => {
    if (e.currentTarget instanceof HTMLElement) e.currentTarget.blur();
    settings.racingLine = !settings.racingLine;
    saveSettings(settings);
    applySettingsToRuntime();
  });
  resetBtn.addEventListener('click', (e) => {
    if (e.currentTarget instanceof HTMLElement) e.currentTarget.blur();
    if (appMode === 'playing') resetQueued = true;
  });
  muteBtn.addEventListener('click', (e) => {
    if (e.currentTarget instanceof HTMLElement) e.currentTarget.blur();
    audio.init();
    settings.muted = !settings.muted;
    saveSettings(settings);
    applySettingsToRuntime();
  });
  pauseBtn.addEventListener('click', (e) => {
    if (e.currentTarget instanceof HTMLElement) e.currentTarget.blur();
    if (appMode === 'playing') setAppMode('paused');
  });

  // Touch Controls Wiring
  function bindTouchHold(elId: string, key: keyof typeof touchActive): void {
    const el = document.getElementById(elId);
    if (!el) return;
    const setDown = (e: Event) => {
      e.preventDefault();
      audio.init();
      touchActive[key] = true;
      el.classList.add('pressed');
    };
    const setUp = (e: Event) => {
      e.preventDefault();
      touchActive[key] = false;
      el.classList.remove('pressed');
    };
    el.addEventListener('pointerdown', setDown);
    el.addEventListener('pointerup', setUp);
    el.addEventListener('pointercancel', setUp);
    el.addEventListener('pointerleave', setUp);
  }
  bindTouchHold('tbtn-left', 'left');
  bindTouchHold('tbtn-right', 'right');
  bindTouchHold('tbtn-gas', 'up');
  bindTouchHold('tbtn-brake', 'down');
  bindTouchHold('tbtn-drift', 'drift');
  bindTouchHold('tbtn-nitro', 'nitro');

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (appMode === 'gameover') {
      confettiCanvas.width = window.innerWidth;
      confettiCanvas.height = window.innerHeight;
    }
  });

  function readPlayerInput(): InputState {
    const up = keys.has('ArrowUp') || keys.has('KeyW') || touchActive.up;
    const down = keys.has('ArrowDown') || keys.has('KeyS') || touchActive.down;
    const left = keys.has('ArrowLeft') || keys.has('KeyA') || touchActive.left;
    const right = keys.has('ArrowRight') || keys.has('KeyD') || touchActive.right;
    const handbrake = keys.has('Space') || touchActive.drift;
    const nitro = keys.has('ShiftLeft') || keys.has('ShiftRight') || touchActive.nitro;
    const rPressed = resetQueued;
    resetQueued = false;

    return {
      throttle: up ? 1 : 0,
      brake: down ? 1 : 0,
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      handbrake,
      nitro,
      resetPressed: rPressed,
    };
  }

  function syncCarMeshes(): void {
    const flickerClock = performance.now() * 0.055;
    for (let i = 0; i < raceState.cars.length; i++) {
      const car = raceState.cars[i];
      const rig = carRigs[i];
      rig.root.position.set(car.x, 0, car.z);
      rig.root.rotation.y = -car.heading;
      rig.chassis.rotation.x = car.bodyRoll;
      rig.chassis.rotation.z = car.bodyPitch;

      rig.frontLeftPivot.rotation.y = -car.steerAngle;
      rig.frontRightPivot.rotation.y = -car.steerAngle;
      rig.steeringWheel.rotation.x = -car.steerAngle * 2.1;

      for (let w = 0; w < 4; w++) {
        rig.wheelSpinGroups[w].rotation.z = -car.wheelSpin;
      }

      rig.tailMat.emissiveIntensity = car.isBraking ? 3.2 : 0.65;

      // Dual nitro exhaust flame animation
      if (car.isBoosting && settings.visualEffects) {
        const pulse = 0.85 + Math.sin(flickerClock + i * 1.7) * 0.25;
        rig.flameL.visible = true;
        rig.flameR.visible = true;
        rig.flameL.scale.set(pulse * 1.25, 0.85 + pulse * 0.2, 0.85 + pulse * 0.2);
        rig.flameR.scale.set(pulse * 1.25, 0.85 + pulse * 0.2, 0.85 + pulse * 0.2);
      } else {
        rig.flameL.visible = false;
        rig.flameR.visible = false;
      }

      if (appMode === 'title') {
        rig.nameplate.visible = true;
      } else if (car.spec.isPlayer) {
        rig.nameplate.visible = false;
      } else {
        const dxCam = rig.root.position.x - camera.position.x;
        const dzCam = rig.root.position.z - camera.position.z;
        const distCamSq = dxCam * dxCam + dzCam * dzCam;
        rig.nameplate.visible = distCamSq > 49 && distCamSq < 12100;
      }
    }
  }

  const _camTargetPos = new THREE.Vector3();
  const _camLookTarget = new THREE.Vector3();

  function snapChaseCamera(): void {
    const p = raceState.cars[0];
    const fx = Math.cos(p.heading);
    const fz = Math.sin(p.heading);
    camera.position.set(p.x - fx * 7.8, 3.05, p.z - fz * 7.8);
    camera.lookAt(p.x + fx * 10, 1.15, p.z + fz * 10);
  }

  function updateCameras(dt: number): void {
    const p = raceState.cars[0];
    const fx = Math.cos(p.heading);
    const fz = Math.sin(p.heading);

    sunLight.position.set(p.x + 55, 78, p.z + 45);
    sunLight.target.position.set(p.x, 0, p.z);

    if (appMode === 'title') {
      titleTime += dt;
      const angle = titleTime * 0.22;
      const cx = -16 + Math.cos(angle) * 24;
      const cz = 8 + Math.sin(angle) * 18;
      camera.position.set(cx, 8.2 + Math.sin(titleTime * 0.45) * 1.2, cz);
      camera.lookAt(-18, 1.3, 0);
      if (camera.fov !== 56) {
        camera.fov = 56;
        camera.updateProjectionMatrix();
      }
      return;
    }

    const boostFovKick = p.isBoosting ? 7.0 : 0;

    if (cameraMode === 'cockpit') {
      const eyeForward = -0.05;
      const eyeY = 1.11;
      camera.position.set(p.x + fx * eyeForward, eyeY, p.z + fz * eyeForward);
      _camLookTarget.set(p.x + fx * 24, 0.98 - p.bodyPitch * 4, p.z + fz * 24);
      camera.lookAt(_camLookTarget);

      const targetFov = 68 + boostFovKick * 0.7;
      if (Math.abs(camera.fov - targetFov) > 0.15) {
        camera.fov += (targetFov - camera.fov) * Math.min(1, 10 * dt);
        camera.updateProjectionMatrix();
      }
    } else {
      const speedRatio = Math.min(1, Math.abs(p.forwardSpeed) / 72);
      const backDist = 7.4 + speedRatio * 1.1 + (p.isBoosting ? 0.55 : 0);
      const height = 2.95 + speedRatio * 0.25;
      _camTargetPos.set(p.x - fx * backDist, height, p.z - fz * backDist);
      _camLookTarget.set(p.x + fx * 11, 1.1, p.z + fz * 11);

      const damp = 1 - Math.exp(-9.5 * dt);
      camera.position.lerp(_camTargetPos, damp);

      if (trauma > 0.001) {
        if (settings.cameraShake) {
          const shake = trauma * trauma;
          camera.position.x += (Math.random() - 0.5) * shake * 0.85;
          camera.position.y += (Math.random() - 0.5) * shake * 0.55;
        }
        trauma = Math.max(0, trauma - dt * 2.2);
      }

      camera.lookAt(_camLookTarget);

      const targetFov = 60 + speedRatio * 11 + boostFovKick;
      if (Math.abs(camera.fov - targetFov) > 0.1) {
        camera.fov += (targetFov - camera.fov) * damp;
        camera.updateProjectionMatrix();
      }
    }
  }

  function checkRivalProximity(): void {
    if (raceState.phase !== 'racing' || rivalAlertCooldown > 0) return;
    const pCar = raceState.cars[0];
    let nearestCar: CarState | null = null;
    let nearestDist = 17.5;

    for (let i = 1; i < raceState.cars.length; i++) {
      const opp = raceState.cars[i];
      const dist = Math.hypot(opp.x - pCar.x, opp.z - pCar.z);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestCar = opp;
      }
    }

    if (nearestCar && nearestCar.index !== lastRivalAlertCar) {
      lastRivalAlertCar = nearestCar.index;
      rivalAlertCooldown = 4.2;
      const oppRank = raceState.order.indexOf(nearestCar.index) + 1;
      const pRank = raceState.order.indexOf(0) + 1;
      const rel = oppRank < pRank ? 'AHEAD' : 'CLOSING';
      showRivalToast(
        `#${nearestCar.spec.number} ${nearestCar.spec.name} · ${ordinal(oppRank)} (${rel})`,
        nearestCar.spec.colorHex,
        2.1
      );
    } else if (!nearestCar) {
      lastRivalAlertCar = -1;
    }
  }

  function updateContextualHints(): void {
    if (isDemoMode || raceState.phase !== 'racing') {
      hintPillEl.style.display = 'none';
      return;
    }
    const pCar = raceState.cars[0];
    if (pCar.isDrifting) hasDriftedInRace = true;
    if (pCar.isBoosting) hasBoostedInRace = true;

    if (pCar.completedLaps >= 1 || (hasDriftedInRace && hasBoostedInRace)) {
      hintPillEl.style.display = 'none';
      return;
    }

    if (raceState.raceTime < 6) {
      hintPillEl.textContent = 'Follow the dynamic racing line: GREEN = Gas · YELLOW = Setup · RED = Brake';
      hintPillEl.style.display = 'block';
    } else if (!hasBoostedInRace && pCar.nitro >= 25) {
      hintPillEl.textContent = 'Nitro ready! Press SHIFT for a high-speed boost burst';
      hintPillEl.style.display = 'block';
    } else if (!hasDriftedInRace) {
      hintPillEl.textContent = 'Hold SPACE while turning into corners to drift & charge Nitro';
      hintPillEl.style.display = 'block';
    } else {
      hintPillEl.style.display = 'none';
    }
  }

  function updateHUD(pInput: InputState): void {
    const pCar = raceState.cars[0];
    const rank = raceState.order.indexOf(0) + 1;
    posEl.textContent = ordinal(rank);

    const displayLap = Math.min(raceState.totalLaps, pCar.completedLaps + 1);
    lapEl.textContent = `${displayLap} / ${raceState.totalLaps}`;

    const totalRaceDist = raceState.totalLaps * track.totalLength;
    const pct = Math.max(0, Math.min(100, (pCar.totalProgress / totalRaceDist) * 100));
    progressPctEl.textContent = `${Math.round(pct)}%`;
    progressBarEl.style.width = `${pct.toFixed(1)}%`;

    const curLapTime =
      raceState.phase === 'countdown' ? 0 : Math.max(0, raceState.raceTime - pCar.currentLapStart);
    curLapEl.textContent = formatTime(curLapTime);
    bestLapEl.textContent = formatTime(pCar.bestLapTime);
    totalTimeEl.textContent = formatTime(raceState.raceTime);

    const kmh = Math.round(Math.abs(pCar.forwardSpeed) * 3.6);
    speedEl.textContent = String(kmh);

    let gearLabel = 'N';
    if (pCar.forwardSpeed < -1.2) {
      gearLabel = 'R';
    } else if (kmh > 2) {
      gearLabel = String(Math.min(6, 1 + Math.floor(kmh / 45)));
    }
    gearEl.textContent = gearLabel;

    const effThrottle = raceState.playerAutopilot ? (pCar.isBraking ? 0 : 0.85) : pInput.throttle;
    const effBrake = raceState.playerAutopilot ? (pCar.isBraking ? 1 : 0) : pInput.brake;
    throttleBarEl.style.width = `${Math.round(effThrottle * 100)}%`;
    brakeBarEl.style.width = `${Math.round(effBrake * 100)}%`;

    // Nitro Boost Meter
    const nitroRounded = Math.round(pCar.nitro);
    nitroBarEl.style.width = `${nitroRounded}%`;
    nitroPctEl.textContent = `${nitroRounded}%`;
    nitroBarEl.classList.toggle('is-boosting', pCar.isBoosting);
    nitroBarEl.classList.toggle('is-locked', pCar.nitroLockedUntilRecharge);

    if (pCar.isBoosting) {
      nitroStatusEl.textContent = 'BOOSTING!';
      nitroStatusEl.className = 'nitro-status boosting';
    } else if (pCar.nitroLockedUntilRecharge) {
      nitroStatusEl.textContent = 'RECHARGING (<15%)';
      nitroStatusEl.className = 'nitro-status locked';
    } else if (pCar.nitro >= 15) {
      nitroStatusEl.textContent = 'NITRO READY [SHIFT]';
      nitroStatusEl.className = 'nitro-status ready';
    } else {
      nitroStatusEl.textContent = 'DRIFT TO CHARGE';
      nitroStatusEl.className = 'nitro-status';
    }

    // Drift Score & Combo Readout
    const showDrift = pCar.isDrifting || pCar.currentDriftScore >= 12;
    driftBoxEl.classList.toggle('active', showDrift);
    driftAngleEl.textContent = `${pCar.driftAngleDeg}°`;
    driftScoreEl.textContent = `+${Math.round(pCar.currentDriftScore)}`;
    driftComboEl.textContent = `${pCar.driftCombo}x`;

    minimap.render(raceState.cars);
  }

  // Initialize starting state
  applySettingsToRuntime();
  syncCarMeshes();
  updateGantryLights(3, false);
  snapChaseCamera();
  if (isAutostart) {
    startNewRace();
  } else {
    setAppMode('title');
  }

  // Main Loop with Software-WebGL Pacing
  let frameId = 0;
  let lastNow = performance.now();

  function afterDraw(cb: () => void): void {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        frameId = window.setTimeout(cb, 80);
      }
    };
    frameId = window.setTimeout(poll, 5);
  }

  function tick(): void {
    const now = performance.now();
    const rawDt = (now - lastNow) / 1000;
    lastNow = now;
    const dt = Math.min(Math.max(rawDt, 0.001), isSoftwareGl ? 0.22 : 0.05);

    if (appMode === 'playing') {
      const pInput = readPlayerInput();
      accumulator += dt;
      while (accumulator >= FIXED_DT) {
        stepRace(raceState, track, raceRng, pInput, FIXED_DT);

        for (let i = 0; i < raceState.events.length; i++) {
          const ev = raceState.events[i];
          if (ev.type === 'skid' && ev.x !== undefined && ev.z !== undefined) {
            effects.emitSkid(ev.x, ev.z, ev.heading || 0, ev.intensity || 0.5);
          } else if (ev.type === 'smoke' && ev.x !== undefined && ev.z !== undefined) {
            effects.emitSmoke(ev.x, ev.z, ev.heading || 0, ev.intensity || 0.5);
          } else if (ev.type === 'dust' && ev.x !== undefined && ev.z !== undefined) {
            effects.emitDust(ev.x, ev.z, ev.heading || 0, ev.intensity || 0.5);
          } else if (ev.type === 'sparks' && ev.x !== undefined && ev.z !== undefined) {
            effects.emitSparks(ev.x, ev.z, ev.intensity || 0.6);
          } else if (ev.type === 'barrier' || ev.type === 'car_hit') {
            if (ev.carIndex === 0 || ev.otherIndex === 0) {
              trauma = Math.min(1, trauma + 0.32 + (ev.intensity || 0.3) * 0.42);
              audio.playImpact(ev.intensity || 0.4);
            }
          } else if (ev.type === 'nitro_start' && ev.carIndex === 0) {
            audio.playNitroIgnite();
          } else if (ev.type === 'drift_bank' && ev.carIndex === 0) {
            const pts = ev.value ?? 0;
            const combo = ev.extra ?? 1;
            audio.playDriftBank(combo);
            showEventToast(`DRIFT BANKED +${pts} (${combo}x)`, 'gold', 1.9);
          } else if (ev.type === 'drift_break' && ev.carIndex === 0) {
            showEventToast('DRIFT COMBO LOST!', 'red', 1.4);
          } else if (ev.type === 'overtake') {
            const passedByPlayer = ev.carIndex === 0 && ev.otherIndex !== undefined;
            const playerPassed = ev.otherIndex === 0;
            if (passedByPlayer && ev.otherIndex !== undefined) {
              const rival = raceState.cars[ev.otherIndex];
              audio.playOvertake();
              showRivalToast(
                `OVERTAKEN #${rival.spec.number} ${rival.spec.name} · +22% NITRO`,
                rival.spec.colorHex,
                2.2
              );
              crowdBoostCheer = 2.0;
            } else if (playerPassed) {
              const attacker = raceState.cars[ev.carIndex];
              showRivalToast(
                `PASSED BY #${attacker.spec.number} ${attacker.spec.name}`,
                attacker.spec.colorHex,
                1.9
              );
            }
          } else if (ev.type === 'sector' && ev.carIndex === 0) {
            const secNum = ev.value ?? 1;
            const delta = ev.extra ?? 0;
            const sign = delta > 0.005 ? '+' : '';
            const deltaStr = Math.abs(delta) < 0.005 ? 'BEST' : `${sign}${delta.toFixed(2)}s`;
            lastSectorText = `S${secNum} ${deltaStr}`;
            sectorSplitEl.textContent = lastSectorText;
            sectorSplitEl.className = `hud-sector-pill tabular ${delta <= 0 ? 'ahead' : 'behind'}`;
          } else if (ev.type === 'best_lap' && ev.carIndex === 0) {
            showEventToast(`NEW LAP RECORD! ${formatTime(ev.value ?? null)}`, 'green', 2.8);
          } else if (ev.type === 'countdown') {
            const stepVal = ev.value ?? 0;
            if (stepVal !== lastCountdownDisplayed) {
              lastCountdownDisplayed = stepVal;
              if (stepVal > 0) {
                countdownEl.style.display = 'block';
                countdownEl.textContent = String(stepVal);
                countdownEl.style.color = '#ef4444';
                updateGantryLights(stepVal, false);
                audio.playCountdownBeep(false);
              } else {
                countdownEl.style.display = 'block';
                countdownEl.textContent = 'GO!';
                countdownEl.style.color = '#22c55e';
                updateGantryLights(0, true);
                audio.playCountdownBeep(true);
              }
            }
          } else if (ev.type === 'lap' && ev.carIndex === 0) {
            audio.playLapChime(false);
            crowdBoostCheer = 2.5;
            if ((ev.value ?? 0) < raceState.totalLaps) {
              showEventToast(`LAP ${ev.value} COMPLETE · ${formatTime(ev.extra ?? null)}`, 'cyan', 2.2);
            }
          } else if (ev.type === 'finish' && ev.carIndex === 0) {
            audio.playLapChime(true);
            crowdBoostCheer = 4.0;
          }
        }

        accumulator -= FIXED_DT;
      }

      if (raceState.phase === 'racing' && raceState.raceTime > 1.2) {
        countdownEl.style.display = 'none';
      }

      // Emit Nitro exhaust trails at fixed cadence while any car boosts
      nitroTrailAccum += dt;
      if (nitroTrailAccum >= 0.035) {
        nitroTrailAccum = 0;
        for (let i = 0; i < raceState.cars.length; i++) {
          const c = raceState.cars[i];
          if (c.isBoosting) {
            effects.emitNitroTrail(c.x, c.z, c.heading);
          }
        }
      }

      // Timer decay for toasts
      if (eventToastTimer > 0) {
        eventToastTimer -= dt;
        if (eventToastTimer <= 0) eventToastEl.style.display = 'none';
      }
      if (rivalToastTimer > 0) {
        rivalToastTimer -= dt;
        if (rivalToastTimer <= 0) rivalToastEl.style.display = 'none';
      }
      if (rivalAlertCooldown > 0) {
        rivalAlertCooldown -= dt;
      }

      checkRivalProximity();
      updateContextualHints();

      effects.update(dt);
      syncCarMeshes();
      updateHUD(pInput);

      const pCar = raceState.cars[0];
      const throttleAmt = raceState.playerAutopilot ? 0.8 : pInput.throttle;
      const driftInt = pCar.isDrifting ? Math.min(1, Math.abs(pCar.lateralSpeed) / 14) : 0;
      audio.updateEngine(
        pCar.forwardSpeed,
        throttleAmt,
        driftInt,
        pCar.isBoosting,
        raceState.phase === 'racing'
      );

      if (pCar.finished) {
        populateResults();
        setAppMode('gameover');
        demoRestartTimer = 4.5;
      }
    } else if (appMode === 'gameover') {
      effects.update(dt);
      updateConfetti(dt);
      if (isDemoMode) {
        demoRestartTimer -= dt;
        if (demoRestartTimer <= 0) {
          startNewRace();
        }
      }
    }

    // Subtle grandstand cheering wave animation during racing / finish
    if (appMode === 'playing' || appMode === 'gameover') {
      if (crowdBoostCheer > 0) crowdBoostCheer = Math.max(0, crowdBoostCheer - dt);
      const speed = crowdBoostCheer > 0 ? 11 : 4.2;
      const amp = crowdBoostCheer > 0 ? 0.22 : 0.08;
      crowdCheerPhase += dt * speed;
      for (let i = 0; i < visuals.crowdDecks.length; i++) {
        visuals.crowdDecks[i].position.y = crowdBaseY[i] + Math.sin(crowdCheerPhase + i * 1.4) * amp;
      }
    }

    updateCameras(dt);
    renderer.render(scene, camera);

    if (isSoftwareGl) {
      afterDraw(tick);
    } else {
      frameId = requestAnimationFrame(tick);
    }
  }

  // Render first frame immediately so first paint is crisp
  updateCameras(0.016);
  renderer.render(scene, camera);
  if (isSoftwareGl) {
    afterDraw(tick);
  } else {
    frameId = requestAnimationFrame(tick);
  }

  window.addEventListener('beforeunload', () => {
    cancelAnimationFrame(frameId);
    clearTimeout(frameId);
    audio.dispose();
    renderer.dispose();
  });
}

// Auto-initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRacingGame);
} else {
  initRacingGame();
}
