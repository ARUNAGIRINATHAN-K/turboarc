import { CAR_SPECS, CarState } from './physics';
import { CameraMode } from './renderer3d';
import { RaceEventBanner, TOTAL_LAPS } from './sim';
import { CIRCUIT } from './track';

export type GameScreenState = 'title' | 'playing' | 'paused' | 'gameover';

export interface GameSettings {
  racingLine: boolean;
  cameraShake: boolean;
  visualEffects: boolean;
  touchControls: 'auto' | 'on' | 'off';
  muted: boolean;
}

export interface TouchInputState {
  left: boolean;
  right: boolean;
  throttle: boolean;
  brake: boolean;
  handbrake: boolean;
  boost: boolean;
}

export interface UIHandlers {
  onStartRace: () => void;
  onResume: () => void;
  onRestart: () => void;
  onMainMenu: () => void;
  onToggleCamera: () => void;
  onResetCar: () => void;
  onToggleMute: () => void;
  onTogglePause: () => void;
  onSettingsChange: (next: GameSettings) => void;
}

export function formatRaceTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '--:--.--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const hundredths = Math.floor((seconds - Math.floor(seconds)) * 100);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}.${hundredths < 10 ? '0' : ''}${hundredths}`;
}

function ordinalSuffix(pos: number): string {
  if (pos === 1) return 'ST';
  if (pos === 2) return 'ND';
  if (pos === 3) return 'RD';
  return 'TH';
}

export class RacingUI {
  private root: HTMLElement;
  private handlers: UIHandlers;
  private settings: GameSettings;
  readonly touchState: TouchInputState = {
    left: false,
    right: false,
    throttle: false,
    brake: false,
    handbrake: false,
    boost: false,
  };

  private titleOverlay: HTMLElement;
  private hudOverlay: HTMLElement;
  private pauseModal: HTMLElement;
  private controlsModal: HTMLElement;
  private settingsModal: HTMLElement;
  private howToModal: HTMLElement;
  private resultsModal: HTMLElement;
  private subModalReturnTo: 'title' | 'paused' = 'title';

  private countdownWrap: HTMLElement;
  private countdownBanner: HTMLElement;
  private hudLights: HTMLElement[];

  // HUD live elements
  private posNumEl: HTMLElement;
  private posOrdEl: HTMLElement;
  private lapValEl: HTMLElement;
  private progressFillEl: HTMLElement;
  private curLapEl: HTMLElement;
  private bestLapEl: HTMLElement;
  private totalTimeEl: HTMLElement;

  private speedEl: HTMLElement;
  private gearEl: HTMLElement;
  private throttleFillEl: HTMLElement;
  private brakeFillEl: HTMLElement;
  private boostFillEl: HTMLElement;
  private boostPctEl: HTMLElement;
  private boostBoxEl: HTMLElement;
  private driftBoxEl: HTMLElement;
  private driftScoreEl: HTMLElement;
  private driftAngleEl: HTMLElement;
  private driftComboEl: HTMLElement;

  private eventToastEl: HTMLElement;
  private hintToastEl: HTMLElement;
  private touchLayerEl: HTMLElement;
  private camBtnEl: HTMLButtonElement;
  private muteBtnEl: HTMLButtonElement;
  private demoTagEl: HTMLElement;

  private minimapCanvas: HTMLCanvasElement;
  private minimapCtx: CanvasRenderingContext2D;
  private minimapTrackPoints: Array<[number, number]> = [];

  // Results elements
  private podiumEl: HTMLElement;
  private summaryGridEl: HTMLElement;
  private resultsBodyEl: HTMLElement;
  private resultsTitleEl: HTMLElement;
  private resultsSubEl: HTMLElement;

  // Settings form controls
  private setLineBtn: HTMLButtonElement;
  private setShakeBtn: HTMLButtonElement;
  private setFxBtn: HTMLButtonElement;
  private setTouchBtn: HTMLButtonElement;
  private setMuteBtn: HTMLButtonElement;

  private eventTimer = 0;
  private hintText = '';

  constructor(container: HTMLElement, initialSettings: GameSettings, handlers: UIHandlers) {
    this.handlers = handlers;
    this.settings = { ...initialSettings };
    this.root = document.createElement('div');
    this.root.className = 'race-ui-root';
    this.root.innerHTML = this.buildMarkup();
    container.appendChild(this.root);

    this.titleOverlay = this.root.querySelector('[data-el="title"]')!;
    this.hudOverlay = this.root.querySelector('[data-el="hud"]')!;
    this.pauseModal = this.root.querySelector('[data-el="pause"]')!;
    this.controlsModal = this.root.querySelector('[data-el="controls-modal"]')!;
    this.settingsModal = this.root.querySelector('[data-el="settings-modal"]')!;
    this.howToModal = this.root.querySelector('[data-el="howto-modal"]')!;
    this.resultsModal = this.root.querySelector('[data-el="results"]')!;

    this.countdownWrap = this.root.querySelector('[data-el="countdown-wrap"]')!;
    this.countdownBanner = this.root.querySelector('[data-el="countdown"]')!;
    this.hudLights = Array.from(this.root.querySelectorAll('[data-el="hud-light"]'));

    this.posNumEl = this.root.querySelector('[data-el="pos-num"]')!;
    this.posOrdEl = this.root.querySelector('[data-el="pos-ord"]')!;
    this.lapValEl = this.root.querySelector('[data-el="lap-val"]')!;
    this.progressFillEl = this.root.querySelector('[data-el="progress-fill"]')!;
    this.curLapEl = this.root.querySelector('[data-el="cur-lap"]')!;
    this.bestLapEl = this.root.querySelector('[data-el="best-lap"]')!;
    this.totalTimeEl = this.root.querySelector('[data-el="total-time"]')!;

    this.speedEl = this.root.querySelector('[data-el="speed-val"]')!;
    this.gearEl = this.root.querySelector('[data-el="gear-val"]')!;
    this.throttleFillEl = this.root.querySelector('[data-el="throttle-fill"]')!;
    this.brakeFillEl = this.root.querySelector('[data-el="brake-fill"]')!;
    this.boostFillEl = this.root.querySelector('[data-el="boost-fill"]')!;
    this.boostPctEl = this.root.querySelector('[data-el="boost-pct"]')!;
    this.boostBoxEl = this.root.querySelector('[data-el="boost-box"]')!;
    this.driftBoxEl = this.root.querySelector('[data-el="drift-box"]')!;
    this.driftScoreEl = this.root.querySelector('[data-el="drift-score"]')!;
    this.driftAngleEl = this.root.querySelector('[data-el="drift-angle"]')!;
    this.driftComboEl = this.root.querySelector('[data-el="drift-combo"]')!;

    this.eventToastEl = this.root.querySelector('[data-el="event-toast"]')!;
    this.hintToastEl = this.root.querySelector('[data-el="hint-toast"]')!;
    this.touchLayerEl = this.root.querySelector('[data-el="touch-layer"]')!;
    this.camBtnEl = this.root.querySelector('[data-action="camera"]')!;
    this.muteBtnEl = this.root.querySelector('[data-action="mute"]')!;
    this.demoTagEl = this.root.querySelector('[data-el="demo-tag"]')!;

    this.minimapCanvas = this.root.querySelector('[data-el="minimap"]')!;
    this.minimapCtx = this.minimapCanvas.getContext('2d')!;

    this.podiumEl = this.root.querySelector('[data-el="podium"]')!;
    this.summaryGridEl = this.root.querySelector('[data-el="summary-grid"]')!;
    this.resultsBodyEl = this.root.querySelector('[data-el="results-body"]')!;
    this.resultsTitleEl = this.root.querySelector('[data-el="results-title"]')!;
    this.resultsSubEl = this.root.querySelector('[data-el="results-sub"]')!;

    this.setLineBtn = this.root.querySelector('[data-setting="racingLine"]')!;
    this.setShakeBtn = this.root.querySelector('[data-setting="cameraShake"]')!;
    this.setFxBtn = this.root.querySelector('[data-setting="visualEffects"]')!;
    this.setTouchBtn = this.root.querySelector('[data-setting="touchControls"]')!;
    this.setMuteBtn = this.root.querySelector('[data-setting="muted"]')!;

    this.precomputeMinimap();
    this.bindEvents();
    this.syncSettingsButtons();
    this.updateTouchVisibility();
  }

  private precomputeMinimap(): void {
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    const pad = 18;
    const spanX = CIRCUIT.maxX - CIRCUIT.minX;
    const spanZ = CIRCUIT.maxZ - CIRCUIT.minZ;
    const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanZ);
    const offsetX = (w - spanX * scale) * 0.5 - CIRCUIT.minX * scale;
    const offsetZ = (h - spanZ * scale) * 0.5 - CIRCUIT.minZ * scale;

    this.minimapTrackPoints = [];
    for (let i = 0; i < CIRCUIT.samples.length; i += 3) {
      const s = CIRCUIT.samples[i];
      this.minimapTrackPoints.push([w - (s.x * scale + offsetX), h - (s.z * scale + offsetZ)]);
    }
  }

  private worldToMinimap(x: number, z: number): [number, number] {
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    const pad = 18;
    const spanX = CIRCUIT.maxX - CIRCUIT.minX;
    const spanZ = CIRCUIT.maxZ - CIRCUIT.minZ;
    const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanZ);
    const offsetX = (w - spanX * scale) * 0.5 - CIRCUIT.minX * scale;
    const offsetZ = (h - spanZ * scale) * 0.5 - CIRCUIT.minZ * scale;
    return [w - (x * scale + offsetX), h - (z * scale + offsetZ)];
  }

  private bindEvents(): void {
    const wire = (selector: string, fn: () => void) => {
      this.root.querySelectorAll<HTMLButtonElement>(selector).forEach((btn) => {
        btn.addEventListener('click', (e) => {
          (e.currentTarget as HTMLButtonElement | null)?.blur();
          fn();
        });
      });
    };

    wire('[data-action="start"]', () => this.handlers.onStartRace());
    wire('[data-action="resume"]', () => this.handlers.onResume());
    wire('[data-action="restart"]', () => this.handlers.onRestart());
    wire('[data-action="menu"]', () => this.handlers.onMainMenu());
    wire('[data-action="camera"]', () => this.handlers.onToggleCamera());
    wire('[data-action="reset"]', () => this.handlers.onResetCar());
    wire('[data-action="mute"]', () => this.handlers.onToggleMute());
    wire('[data-action="pause"]', () => this.handlers.onTogglePause());

    wire('[data-action="open-controls"]', () => this.openSubModal('controls'));
    wire('[data-action="open-settings"]', () => this.openSubModal('settings'));
    wire('[data-action="open-howto"]', () => this.openSubModal('howto'));
    wire('[data-action="close-submodal"]', () => this.closeSubModals());

    this.setLineBtn.addEventListener('click', () => {
      this.settings.racingLine = !this.settings.racingLine;
      this.applySettingsUpdate();
    });
    this.setShakeBtn.addEventListener('click', () => {
      this.settings.cameraShake = !this.settings.cameraShake;
      this.applySettingsUpdate();
    });
    this.setFxBtn.addEventListener('click', () => {
      this.settings.visualEffects = !this.settings.visualEffects;
      this.applySettingsUpdate();
    });
    this.setTouchBtn.addEventListener('click', () => {
      this.settings.touchControls =
        this.settings.touchControls === 'auto'
          ? 'on'
          : this.settings.touchControls === 'on'
            ? 'off'
            : 'auto';
      this.applySettingsUpdate();
    });
    this.setMuteBtn.addEventListener('click', () => {
      this.handlers.onToggleMute();
    });

    // Touch controls binding
    const bindTouch = (key: keyof TouchInputState) => {
      const btn = this.root.querySelector<HTMLElement>(`[data-touch="${key}"]`);
      if (!btn) return;
      const setOn = (e: Event) => {
        e.preventDefault();
        this.touchState[key] = true;
        btn.classList.add('active');
      };
      const setOff = (e: Event) => {
        e.preventDefault();
        this.touchState[key] = false;
        btn.classList.remove('active');
      };
      btn.addEventListener('pointerdown', setOn);
      btn.addEventListener('pointerup', setOff);
      btn.addEventListener('pointercancel', setOff);
      btn.addEventListener('pointerleave', setOff);
    };
    bindTouch('left');
    bindTouch('right');
    bindTouch('throttle');
    bindTouch('brake');
    bindTouch('handbrake');
    bindTouch('boost');
  }

  private applySettingsUpdate(): void {
    this.syncSettingsButtons();
    this.updateTouchVisibility();
    this.handlers.onSettingsChange({ ...this.settings });
  }

  syncSettings(next: GameSettings): void {
    this.settings = { ...next };
    this.syncSettingsButtons();
    this.updateTouchVisibility();
  }

  private syncSettingsButtons(): void {
    const labelBool = (btn: HTMLButtonElement, on: boolean) => {
      btn.textContent = on ? 'ON' : 'OFF';
      btn.dataset.on = on ? '1' : '0';
    };
    labelBool(this.setLineBtn, this.settings.racingLine);
    labelBool(this.setShakeBtn, this.settings.cameraShake);
    labelBool(this.setFxBtn, this.settings.visualEffects);
    labelBool(this.setMuteBtn, this.settings.muted);

    this.setTouchBtn.textContent =
      this.settings.touchControls === 'auto'
        ? 'AUTO'
        : this.settings.touchControls === 'on'
          ? 'ON'
          : 'OFF';
    this.setTouchBtn.dataset.on = this.settings.touchControls !== 'off' ? '1' : '0';
  }

  private updateTouchVisibility(): void {
    const isCoarse =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);
    const show =
      this.settings.touchControls === 'on' || (this.settings.touchControls === 'auto' && isCoarse);
    this.touchLayerEl.hidden = !show;
  }

  private openSubModal(which: 'controls' | 'settings' | 'howto'): void {
    this.subModalReturnTo = document.body.dataset.state === 'paused' ? 'paused' : 'title';
    this.titleOverlay.hidden = true;
    this.pauseModal.hidden = true;
    this.controlsModal.hidden = which !== 'controls';
    this.settingsModal.hidden = which !== 'settings';
    this.howToModal.hidden = which !== 'howto';
  }

  closeSubModals(): void {
    this.controlsModal.hidden = true;
    this.settingsModal.hidden = true;
    this.howToModal.hidden = true;
    if (this.subModalReturnTo === 'paused') {
      this.pauseModal.hidden = false;
    } else if (document.body.dataset.state === 'title') {
      this.titleOverlay.hidden = false;
    }
  }

  hasSubModalOpen(): boolean {
    return !this.controlsModal.hidden || !this.settingsModal.hidden || !this.howToModal.hidden;
  }

  setScreenState(state: GameScreenState, isDemo: boolean): void {
    document.body.dataset.state = state;
    this.controlsModal.hidden = true;
    this.settingsModal.hidden = true;
    this.howToModal.hidden = true;
    this.titleOverlay.hidden = state !== 'title';
    this.hudOverlay.hidden = state !== 'playing' && state !== 'paused';
    this.pauseModal.hidden = state !== 'paused';
    this.resultsModal.hidden = state !== 'gameover';
    this.demoTagEl.hidden = !isDemo;
  }

  setCameraLabel(mode: CameraMode): void {
    this.camBtnEl.title = `Switch Camera [C] (${mode === 'chase' ? 'Chase' : 'Cockpit'})`;
    this.camBtnEl.setAttribute('aria-label', `Camera view: ${mode} (press C to switch)`);
    this.camBtnEl.dataset.mode = mode;
  }

  setMutedLabel(muted: boolean): void {
    this.settings.muted = muted;
    this.muteBtnEl.dataset.muted = muted ? '1' : '0';
    this.muteBtnEl.setAttribute('aria-label', muted ? 'Unmute audio (M)' : 'Mute audio (M)');
    this.syncSettingsButtons();
  }

  pushEvent(ev: RaceEventBanner): void {
    this.eventTimer = 2.6;
    this.eventToastEl.hidden = false;
    this.eventToastEl.dataset.positive = ev.positive ? '1' : '0';
    this.eventToastEl.textContent = ev.subtext ? `${ev.text} · ${ev.subtext}` : ev.text;
  }

  setContextHint(hint: string): void {
    if (hint === this.hintText) return;
    this.hintText = hint;
    if (!hint) {
      this.hintToastEl.hidden = true;
    } else {
      this.hintToastEl.hidden = false;
      this.hintToastEl.textContent = hint;
    }
  }

  updateHUD(
    cars: ReadonlyArray<CarState>,
    order: ReadonlyArray<number>,
    phase: 'countdown' | 'racing' | 'finished',
    countdownDisplay: number,
    goFlashTimer: number,
    raceTime: number,
    progressRatio: number,
    dt: number
  ): void {
    const player = cars[0];
    const pos = order.indexOf(0) + 1;

    this.posNumEl.textContent = String(pos);
    this.posOrdEl.textContent = ordinalSuffix(pos);

    const displayLap = Math.min(TOTAL_LAPS, player.lapsCompleted + 1);
    this.lapValEl.textContent = `${displayLap} / ${TOTAL_LAPS}`;
    this.progressFillEl.style.width = `${Math.round(progressRatio * 100)}%`;

    const curLapSec = phase === 'countdown' ? 0 : Math.max(0, raceTime - player.currentLapStartTime);
    this.curLapEl.textContent = formatRaceTime(curLapSec);
    this.bestLapEl.textContent = formatRaceTime(player.bestLapTime);
    this.totalTimeEl.textContent = formatRaceTime(phase === 'countdown' ? 0 : raceTime);

    this.speedEl.textContent = String(Math.round(player.speedKmh));
    this.gearEl.textContent = player.gear;
    this.throttleFillEl.style.width = `${Math.round(player.throttle * 100)}%`;
    this.brakeFillEl.style.width = `${Math.round(player.brakeInput * 100)}%`;

    const boostPct = Math.round(player.boost);
    this.boostFillEl.style.width = `${boostPct}%`;
    this.boostPctEl.textContent = `${boostPct}%`;
    this.boostBoxEl.dataset.active = player.boosting ? '1' : player.boost >= 15 ? 'ready' : '0';

    // Drift live feedback
    const driftingNow = player.isDrifting || player.driftScoreCurrent > 10;
    this.driftBoxEl.dataset.drifting = driftingNow ? '1' : '0';
    this.driftAngleEl.textContent = `${Math.round(Math.abs(player.driftAngleDeg))}°`;
    this.driftComboEl.textContent = `${player.driftCombo}x`;
    this.driftScoreEl.textContent = String(
      driftingNow ? Math.round(player.driftScoreCurrent) : player.driftScoreTotal
    );

    if (this.eventTimer > 0) {
      this.eventTimer -= dt;
      if (this.eventTimer <= 0) {
        this.eventToastEl.hidden = true;
      }
    }

    // Countdown & animated start lights
    if (phase === 'countdown') {
      this.countdownWrap.hidden = false;
      this.countdownBanner.textContent = String(countdownDisplay);
      this.countdownBanner.dataset.go = '0';
      const lit = 4 - countdownDisplay;
      this.hudLights.forEach((el, idx) => {
        el.dataset.state = idx < lit ? 'red' : 'off';
      });
    } else if (goFlashTimer > 0) {
      this.countdownWrap.hidden = false;
      this.countdownBanner.textContent = 'GO!';
      this.countdownBanner.dataset.go = '1';
      this.hudLights.forEach((el) => {
        el.dataset.state = 'green';
      });
    } else {
      this.countdownWrap.hidden = true;
    }

    this.drawMinimap(cars);
  }

  private drawMinimap(cars: ReadonlyArray<CarState>): void {
    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < this.minimapTrackPoints.length; i++) {
      const [mx, my] = this.minimapTrackPoints[i];
      if (i === 0) ctx.moveTo(mx, my);
      else ctx.lineTo(mx, my);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 7;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(248,250,252,0.82)';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    const s0 = CIRCUIT.sampleAtS(0);
    const [sx, sy] = this.worldToMinimap(s0.x, s0.z);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx - 3, sy - 1.5, 6, 3);

    // Draw opponents then player on top with car numbers
    ctx.font = 'bold 8px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 5; i >= 0; i--) {
      const car = cars[i];
      const spec = CAR_SPECS[i];
      const [cx, cy] = this.worldToMinimap(car.x, car.z);
      const r = i === 0 ? 7.5 : 6.0;

      if (i === 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, r + 3.0, 0, Math.PI * 2);
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = spec.color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = i === 0 ? '#ffffff' : '#0f172a';
      ctx.stroke();

      ctx.fillStyle = i === 2 || i === 3 ? '#0f172a' : '#ffffff';
      ctx.fillText(spec.number, cx, cy + 0.5);
    }
  }

  showResults(cars: ReadonlyArray<CarState>, order: ReadonlyArray<number>, isDemo: boolean): void {
    const player = cars[0];
    const playerRank = order.indexOf(0) + 1;
    this.resultsTitleEl.textContent =
      playerRank <= 3
        ? `Podium Finish — ${playerRank}${ordinalSuffix(playerRank).toLowerCase()} Place`
        : `Finished ${playerRank}${ordinalSuffix(playerRank).toLowerCase()} of 6`;
    this.resultsSubEl.textContent = isDemo
      ? 'Demo race complete — starting next race automatically'
      : '3-Lap Grand Prix Classification & Telemetry';

    // Top 3 Podium visual presentation (order: 2nd | 1st | 3rd)
    const podiumOrder = [1, 0, 2];
    this.podiumEl.innerHTML = podiumOrder
      .map((rankIdx) => {
        const carId = order[rankIdx];
        const car = cars[carId];
        const pos = rankIdx + 1;
        return `
          <div class="podium-slot place-${pos}">
            <div class="podium-badge" style="border-color:${car.spec.color}">
              <span class="podium-num" style="background:${car.spec.color};color:${carId === 2 || carId === 3 ? '#0f172a' : '#ffffff'}">${car.spec.number}</span>
              <span class="podium-name">${car.spec.symbol} ${car.spec.name}</span>
              <span class="podium-time">${car.finishTime !== null ? formatRaceTime(car.finishTime) : 'Fin'}</span>
            </div>
            <div class="podium-step">${pos}${ordinalSuffix(pos)}</div>
          </div>
        `;
      })
      .join('');

    // Player detailed stats summary
    const lapStr =
      player.lapTimes.length > 0
        ? player.lapTimes.map((t, idx) => `L${idx + 1} ${formatRaceTime(t)}`).join(' · ')
        : '--';
    this.summaryGridEl.innerHTML = `
      <div class="stat-tile"><span class="stat-k">Final Pos</span><span class="stat-v">${playerRank} / 6</span></div>
      <div class="stat-tile"><span class="stat-k">Total Time</span><span class="stat-v">${formatRaceTime(player.finishTime)}</span></div>
      <div class="stat-tile"><span class="stat-k">Best Lap</span><span class="stat-v">${formatRaceTime(player.bestLapTime)}</span></div>
      <div class="stat-tile"><span class="stat-k">Overtakes</span><span class="stat-v">${player.overtakes}</span></div>
      <div class="stat-tile"><span class="stat-k">Drift Score</span><span class="stat-v">${player.driftScoreTotal}</span></div>
      <div class="stat-tile"><span class="stat-k">Best Combo</span><span class="stat-v">${player.bestDriftCombo}x</span></div>
      <div class="stat-tile"><span class="stat-k">Nitro Uses</span><span class="stat-v">${player.boostUsedCount} (${player.boostTimeUsed.toFixed(1)}s)</span></div>
      <div class="stat-tile"><span class="stat-k">Collisions</span><span class="stat-v">${player.collisionCount}</span></div>
      <div class="stat-tile wide"><span class="stat-k">Lap-by-Lap Splits</span><span class="stat-v">${lapStr}</span></div>
    `;

    const leaderTime = cars[order[0]].finishTime;
    this.resultsBodyEl.innerHTML = order
      .map((carId, idx) => {
        const car = cars[carId];
        const pos = idx + 1;
        const isPlayer = carId === 0;
        const totalStr = car.finishTime !== null ? formatRaceTime(car.finishTime) : 'Running';
        const gapStr =
          idx === 0
            ? 'Leader'
            : car.finishTime !== null && leaderTime !== null
              ? `+${(car.finishTime - leaderTime).toFixed(2)}s`
              : `${car.lapsCompleted}/${TOTAL_LAPS} Laps`;
        const bestStr = formatRaceTime(car.bestLapTime);

        return `
          <tr class="${isPlayer ? 'is-player' : ''}">
            <td class="num">${pos}</td>
            <td>
              <span class="num-pill" style="background:${car.spec.color};color:${carId === 2 || carId === 3 ? '#0f172a' : '#ffffff'}">${car.spec.number}</span>
              <span class="driver-name">${car.spec.symbol} ${car.spec.name}</span>
            </td>
            <td class="num">${bestStr}</td>
            <td class="num">${totalStr}</td>
            <td class="num muted">${gapStr}</td>
            <td class="num">${car.overtakes}</td>
            <td class="num">${car.driftScoreTotal}</td>
          </tr>
        `;
      })
      .join('');
  }

  private buildMarkup(): string {
    return `
      <!-- Title / Main Menu -->
      <div class="screen-overlay title-screen" data-el="title">
        <div class="title-panel">
          <svg class="title-emblem" viewBox="0 0 420 96" aria-label="Apex Circuit GP 2.0">
            <rect x="0" y="8" width="10" height="80" fill="#06b6d4" />
            <rect x="16" y="8" width="4" height="80" fill="#f8fafc" opacity="0.65" />
            <text x="34" y="48" fill="#f8fafc" font-size="38" font-weight="800" letter-spacing="2" font-family="system-ui, -apple-system, sans-serif">APEX CIRCUIT</text>
            <text x="36" y="78" fill="#cbd5e1" font-size="16" font-weight="600" letter-spacing="4" font-family="system-ui, -apple-system, sans-serif">3-LAP GRAND PRIX · 6 RIVALS</text>
          </svg>
          <div class="title-actions">
            <button type="button" class="btn-primary" data-action="start" data-start="true">Start Race</button>
            <button type="button" class="btn-secondary" data-action="open-controls">Controls</button>
            <button type="button" class="btn-secondary" data-action="open-settings">Settings</button>
            <button type="button" class="btn-secondary" data-action="open-howto">How to Play</button>
          </div>
          <p class="control-strip">Arrows / WASD Drive · Space Drift · Shift Nitro · C Camera · R Reset</p>
        </div>
      </div>

      <!-- Live Race HUD -->
      <div class="hud-overlay" data-el="hud" hidden>
        <!-- TOP LEFT: Position, Lap & Progress -->
        <div class="hud-card hud-tl">
          <div class="pos-block">
            <span class="pos-num" data-el="pos-num">6</span>
            <span class="pos-meta">
              <span class="pos-ord" data-el="pos-ord">TH</span>
              <span class="pos-total">/ 6</span>
            </span>
          </div>
          <div class="hud-divider"></div>
          <div class="lap-progress-col">
            <div class="lap-row">
              <span class="hud-kicker">Lap</span>
              <span class="hud-val" data-el="lap-val">1 / 3</span>
            </div>
            <div class="progress-track" aria-label="Race progress">
              <div class="progress-fill" data-el="progress-fill" style="width:0%"></div>
            </div>
          </div>
        </div>

        <!-- TOP RIGHT: Lap Times & Utility Buttons -->
        <div class="hud-tr-stack">
          <div class="hud-card hud-times">
            <div class="time-col">
              <span class="hud-kicker">Current</span>
              <span class="time-val" data-el="cur-lap">0:00.00</span>
            </div>
            <div class="time-col">
              <span class="hud-kicker">Best</span>
              <span class="time-val accent" data-el="best-lap">--:--.--</span>
            </div>
            <div class="time-col">
              <span class="hud-kicker">Total</span>
              <span class="time-val" data-el="total-time">0:00.00</span>
            </div>
          </div>
          <div class="hud-tr-btns">
            <span class="demo-label" data-el="demo-tag" hidden>Auto Demo</span>
            <button type="button" class="icon-btn" data-action="camera" title="Switch Camera [C]" aria-label="Switch Camera (C)" tabindex="-1">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            </button>
            <button type="button" class="icon-btn" data-action="reset" title="Reset to Track [R]" aria-label="Reset to Track (R)" tabindex="-1">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8"/>
                <path d="M3 3v5h5"/>
              </svg>
            </button>
            <button type="button" class="icon-btn" data-action="mute" title="Mute Audio [M]" aria-label="Mute Audio (M)" tabindex="-1">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              </svg>
            </button>
            <button type="button" class="icon-btn" data-action="pause" title="Pause [P]" aria-label="Pause (P)" tabindex="-1">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <rect x="6" y="4" width="4" height="16"/>
                <rect x="14" y="4" width="4" height="16"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- TOP CENTER: Countdown + Animated Start Lights + Event / Hint Banners -->
        <div class="countdown-wrap" data-el="countdown-wrap" hidden>
          <div class="start-lights" aria-hidden="true">
            <span class="light-pod" data-el="hud-light" data-state="off"></span>
            <span class="light-pod" data-el="hud-light" data-state="off"></span>
            <span class="light-pod" data-el="hud-light" data-state="off"></span>
          </div>
          <div class="countdown-banner" data-el="countdown">3</div>
        </div>

        <div class="event-toast" data-el="event-toast" hidden></div>
        <div class="hint-toast" data-el="hint-toast" hidden></div>

        <!-- BOTTOM LEFT: Minimap -->
        <div class="hud-card hud-bl">
          <canvas width="188" height="140" data-el="minimap" aria-label="Circuit minimap"></canvas>
        </div>

        <!-- BOTTOM CENTER: Speed, Gear, Pedals, Nitro Boost & Drift Combo -->
        <div class="hud-card hud-bc">
          <div class="bc-drift" data-el="drift-box" data-drifting="0">
            <span class="hud-kicker">Drift</span>
            <div class="drift-nums">
              <span class="drift-score" data-el="drift-score">0</span>
              <span class="drift-combo" data-el="drift-combo">1x</span>
            </div>
            <span class="drift-angle" data-el="drift-angle">0°</span>
          </div>

          <div class="hud-divider"></div>

          <div class="bc-speed-cluster">
            <div class="gear-badge" data-el="gear-val">1</div>
            <div class="speed-readout">
              <span class="speed-num" data-el="speed-val">0</span>
              <span class="speed-unit">KM/H</span>
            </div>
          </div>

          <div class="hud-divider"></div>

          <div class="bc-meters">
            <div class="pedal-row">
              <span class="pedal-lbl">GAS</span>
              <div class="bar-track"><div class="bar-fill gas" data-el="throttle-fill" style="width:0%"></div></div>
              <span class="pedal-lbl">BRK</span>
              <div class="bar-track"><div class="bar-fill brk" data-el="brake-fill" style="width:0%"></div></div>
            </div>
            <div class="boost-row" data-el="boost-box" data-active="0">
              <span class="boost-lbl">NITRO</span>
              <div class="boost-track"><div class="boost-fill" data-el="boost-fill" style="width:35%"></div></div>
              <span class="boost-pct" data-el="boost-pct">35%</span>
            </div>
          </div>
        </div>

        <!-- Optional Touch Controls (Mobile / Touch setting) -->
        <div class="touch-layer" data-el="touch-layer" hidden>
          <div class="touch-left">
            <button type="button" class="touch-btn" data-touch="left" aria-label="Steer Left">◀</button>
            <button type="button" class="touch-btn" data-touch="right" aria-label="Steer Right">▶</button>
          </div>
          <div class="touch-right">
            <button type="button" class="touch-btn accent-nitro" data-touch="boost" aria-label="Nitro Boost">NITRO</button>
            <button type="button" class="touch-btn accent-drift" data-touch="handbrake" aria-label="Drift">DRIFT</button>
            <button type="button" class="touch-btn accent-brake" data-touch="brake" aria-label="Brake">BRK</button>
            <button type="button" class="touch-btn accent-gas" data-touch="throttle" aria-label="Accelerate">GAS</button>
          </div>
        </div>
      </div>

      <!-- Pause Menu Modal -->
      <div class="modal-backdrop" data-el="pause" hidden>
        <div class="modal-card" role="dialog" aria-label="Race Paused">
          <h2>Race Paused</h2>
          <p class="modal-sub">Adjust settings, review controls, or return to the track.</p>
          <div class="modal-actions col">
            <button type="button" class="btn-primary" data-action="resume">Resume</button>
            <button type="button" class="btn-secondary" data-action="restart">Restart Race</button>
            <button type="button" class="btn-secondary" data-action="open-controls">Controls</button>
            <button type="button" class="btn-secondary" data-action="open-settings">Settings</button>
            <button type="button" class="btn-secondary" data-action="menu">Return to Main Menu</button>
          </div>
        </div>
      </div>

      <!-- Controls Modal -->
      <div class="modal-backdrop" data-el="controls-modal" hidden>
        <div class="modal-card" role="dialog" aria-label="Controls">
          <h2>Controls</h2>
          <p class="modal-sub">Keyboard & Touch driving bindings</p>
          <div class="key-list">
            <div class="key-row"><kbd>W / A / S / D</kbd> or <kbd>Arrows</kbd><span>Accelerate, Brake, Steer</span></div>
            <div class="key-row"><kbd>Space</kbd><span>Handbrake Drift through corners</span></div>
            <div class="key-row"><kbd>Shift</kbd><span>Activate Nitro Boost (when ≥ 15%)</span></div>
            <div class="key-row"><kbd>C</kbd><span>Switch Chase / Cockpit camera</span></div>
            <div class="key-row"><kbd>R</kbd><span>Reset car onto track</span></div>
            <div class="key-row"><kbd>M</kbd><span>Mute / Unmute audio</span></div>
            <div class="key-row"><kbd>Esc</kbd> or <kbd>P</kbd><span>Pause Race</span></div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn-primary" data-action="close-submodal">Back</button>
          </div>
        </div>
      </div>

      <!-- Settings Modal -->
      <div class="modal-backdrop" data-el="settings-modal" hidden>
        <div class="modal-card" role="dialog" aria-label="Settings">
          <h2>Settings</h2>
          <p class="modal-sub">Driving assistance, camera, and visual preferences</p>
          <div class="settings-list">
            <div class="setting-row">
              <div><strong>Dynamic Racing Line</strong><span>Green/Yellow/Red corner speed guide</span></div>
              <button type="button" class="toggle-btn" data-setting="racingLine">ON</button>
            </div>
            <div class="setting-row">
              <div><strong>Camera Shake</strong><span>Impact feedback on collisions</span></div>
              <button type="button" class="toggle-btn" data-setting="cameraShake">ON</button>
            </div>
            <div class="setting-row">
              <div><strong>Visual Effects</strong><span>Tyre smoke, sparks, trails & confetti</span></div>
              <button type="button" class="toggle-btn" data-setting="visualEffects">ON</button>
            </div>
            <div class="setting-row">
              <div><strong>Touch Controls</strong><span>On-screen buttons for mobile play</span></div>
              <button type="button" class="toggle-btn" data-setting="touchControls">AUTO</button>
            </div>
            <div class="setting-row">
              <div><strong>Mute Audio</strong><span>Silence engine, screech & chimes</span></div>
              <button type="button" class="toggle-btn" data-setting="muted">OFF</button>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn-primary" data-action="close-submodal">Done</button>
          </div>
        </div>
      </div>

      <!-- How to Play Modal -->
      <div class="modal-backdrop" data-el="howto-modal" hidden>
        <div class="modal-card" role="dialog" aria-label="How to Play">
          <h2>How to Play</h2>
          <p class="modal-sub">Master the circuit in 10 seconds</p>
          <div class="howto-steps">
            <div class="howto-item"><span class="step-tag green">1</span><div><strong>Follow the Dynamic Racing Line</strong><p>Accelerate on Green, prepare on Yellow, and brake on Red using the 150m, 100m, and 50m boards.</p></div></div>
            <div class="howto-item"><span class="step-tag amber">2</span><div><strong>Drift for Combo & Nitro</strong><p>Hold <b>Space</b> entering corners to slide the rear, build 1x–5x combos, and straighten out cleanly to bank points and charge Nitro.</p></div></div>
            <div class="howto-item"><span class="step-tag cyan">3</span><div><strong>Boost & Overtake Rivals</strong><p>Press <b>Shift</b> on straights to unleash Nitro Boost. Watch rival numbers (07 RAZOR, 12 BLAZE, 18 MOSS, 23 NOVA, 31 COMET) and stay on the asphalt for full grip.</p></div></div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn-primary" data-action="close-submodal">Got It</button>
          </div>
        </div>
      </div>

      <!-- Results & Podium Modal -->
      <div class="modal-backdrop" data-el="results" hidden>
        <div class="modal-card results-card" role="dialog" aria-label="Race Results">
          <h2 data-el="results-title">Race Results</h2>
          <p class="modal-sub" data-el="results-sub">3-Lap Grand Prix Classification</p>
          <div class="podium-row" data-el="podium"></div>
          <div class="summary-grid" data-el="summary-grid"></div>
          <table class="results-table">
            <thead>
              <tr>
                <th class="num">Pos</th>
                <th>Driver</th>
                <th class="num">Best Lap</th>
                <th class="num">Total Time</th>
                <th class="num">Gap</th>
                <th class="num">Pass</th>
                <th class="num">Drift</th>
              </tr>
            </thead>
            <tbody data-el="results-body"></tbody>
          </table>
          <div class="modal-actions">
            <button type="button" class="btn-primary" data-action="restart" data-start="true">Restart Race</button>
            <button type="button" class="btn-secondary" data-action="menu">Main Menu</button>
          </div>
        </div>
      </div>
    `;
  }

  dispose(): void {
    if (this.root.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
  }
}

export const RACING_STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body, #root {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #0f172a;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: #f8fafc;
    user-select: none;
  }
  .race-shell {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .canvas-mount {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .race-ui-root {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 10;
  }
  [hidden] { display: none !important; }

  /* Title Screen */
  .title-screen {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: flex-end;
    justify-content: flex-start;
    padding: 48px;
    background: linear-gradient(180deg, rgba(10,14,22,0.12) 0%, rgba(10,14,22,0.78) 100%);
    pointer-events: auto;
  }
  .title-panel { max-width: 620px; }
  .title-emblem {
    width: 100%;
    max-width: 420px;
    height: auto;
    display: block;
    margin-bottom: 22px;
    filter: drop-shadow(0 6px 20px rgba(0,0,0,0.6));
  }
  .title-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 16px;
  }
  .control-strip {
    margin: 0;
    font-size: 13px;
    font-weight: 500;
    color: #cbd5e1;
    letter-spacing: 0.02em;
    text-shadow: 0 1px 4px rgba(0,0,0,0.85);
  }

  /* Buttons */
  .btn-primary, .btn-secondary {
    pointer-events: auto;
    cursor: pointer;
    border: none;
    border-radius: 6px;
    padding: 11px 22px;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.03em;
    white-space: nowrap;
    transition: transform 0.14s ease, background-color 0.14s ease;
  }
  .btn-primary {
    background: #06b6d4;
    color: #091017;
    box-shadow: 0 6px 20px rgba(6,182,212,0.35);
  }
  .btn-primary:hover { background: #22d3ee; transform: translateY(-1px); }
  .btn-secondary {
    background: rgba(20, 28, 42, 0.92);
    color: #f8fafc;
    border: 1px solid rgba(255,255,255,0.18);
  }
  .btn-secondary:hover { background: rgba(38, 50, 72, 0.96); }
  .btn-primary:focus-visible, .btn-secondary:focus-visible, .icon-btn:focus-visible, .toggle-btn:focus-visible {
    outline: 2px solid #f8fafc;
    outline-offset: 2px;
  }

  /* HUD Layout */
  .hud-overlay { position: absolute; inset: 0; pointer-events: none; }
  .hud-card {
    position: absolute;
    background: rgba(11, 16, 25, 0.86);
    border: 1px solid rgba(255,255,255,0.14);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.38);
  }

  /* Top-Left: Position, Lap & Progress */
  .hud-tl {
    top: 16px;
    left: 16px;
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .pos-block { display: flex; align-items: baseline; gap: 3px; }
  .pos-num { font-size: 38px; font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; }
  .pos-meta { display: flex; flex-direction: column; font-size: 11px; font-weight: 800; color: #94a3b8; line-height: 1.1; }
  .pos-ord { color: #06b6d4; }
  .hud-divider { width: 1px; height: 36px; background: rgba(255,255,255,0.12); }
  .lap-progress-col { display: flex; flex-direction: column; gap: 6px; min-width: 112px; }
  .lap-row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .hud-kicker { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: #94a3b8; text-transform: uppercase; }
  .hud-val { font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .progress-track { width: 100%; height: 5px; background: rgba(255,255,255,0.12); border-radius: 3px; overflow: hidden; }
  .progress-fill { height: 100%; background: #06b6d4; transition: width 0.12s linear; }

  /* Top-Right: Timing & Utility Icons */
  .hud-tr-stack {
    position: absolute;
    top: 16px;
    right: 16px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
  }
  .hud-times {
    position: static;
    padding: 9px 14px;
    display: flex;
    gap: 16px;
  }
  .time-col { display: flex; flex-direction: column; gap: 2px; min-width: 68px; }
  .time-val {
    font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
    font-size: 14px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .time-val.accent { color: #facc15; }
  .hud-tr-btns { display: flex; align-items: center; gap: 6px; pointer-events: auto; }
  .demo-label {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #facc15;
    background: rgba(11, 16, 25, 0.86);
    border: 1px solid rgba(250, 204, 21, 0.38);
    border-radius: 6px;
    padding: 7px 10px;
  }
  .icon-btn {
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    background: rgba(11, 16, 25, 0.86);
    border: 1px solid rgba(255,255,255,0.14);
    color: #f8fafc;
    cursor: pointer;
  }
  .icon-btn:hover { background: rgba(30, 41, 59, 0.94); }
  .icon-btn[data-muted="1"] { color: #ef4444; }
  .icon-btn[data-mode="cockpit"] { border-color: #06b6d4; color: #38bdf8; }

  /* Countdown & Event Toasts */
  .countdown-wrap {
    position: absolute;
    top: 8%;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .start-lights {
    display: flex;
    gap: 10px;
    background: rgba(11, 16, 25, 0.9);
    padding: 7px 14px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.14);
  }
  .light-pod {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #27272a;
    border: 1px solid rgba(255,255,255,0.16);
  }
  .light-pod[data-state="red"] { background: #ef4444; box-shadow: 0 0 12px #ef4444; }
  .light-pod[data-state="green"] { background: #22c55e; box-shadow: 0 0 12px #22c55e; }
  .countdown-banner {
    font-size: 76px;
    font-weight: 900;
    line-height: 1;
    color: #ef4444;
    text-shadow: 0 6px 24px rgba(0,0,0,0.85);
    font-variant-numeric: tabular-nums;
  }
  .countdown-banner[data-go="1"] { color: #22c55e; }

  .event-toast {
    position: absolute;
    top: 84px;
    left: 50%;
    transform: translateX(-50%);
    padding: 8px 18px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.06em;
    background: rgba(11, 16, 25, 0.92);
    border: 1px solid #06b6d4;
    color: #f8fafc;
    white-space: nowrap;
  }
  .event-toast[data-positive="0"] { border-color: #ef4444; color: #fecaca; }

  .hint-toast {
    position: absolute;
    bottom: 118px;
    left: 50%;
    transform: translateX(-50%);
    padding: 7px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    background: rgba(11, 16, 25, 0.88);
    border: 1px solid rgba(250, 204, 21, 0.45);
    color: #fef08a;
    white-space: nowrap;
  }

  /* Bottom-Left: Minimap */
  .hud-bl { bottom: 16px; left: 16px; padding: 8px; }
  .hud-bl canvas { display: block; width: 188px; height: 140px; }

  /* Bottom-Center: Speed, Gear, Pedals, Nitro & Drift */
  .hud-bc {
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 18px;
    display: flex;
    align-items: center;
    gap: 16px;
    min-width: 440px;
  }
  .bc-drift {
    display: flex;
    flex-direction: column;
    min-width: 88px;
    gap: 2px;
  }
  .drift-nums { display: flex; align-items: baseline; gap: 6px; }
  .drift-score { font-size: 20px; font-weight: 900; font-variant-numeric: tabular-nums; color: #f8fafc; }
  .bc-drift[data-drifting="1"] .drift-score { color: #facc15; }
  .drift-combo { font-size: 12px; font-weight: 800; color: #f97316; }
  .drift-angle { font-size: 11px; font-weight: 700; color: #94a3b8; font-variant-numeric: tabular-nums; }

  .bc-speed-cluster { display: flex; align-items: center; gap: 10px; }
  .gear-badge {
    width: 34px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.16);
    font-size: 22px;
    font-weight: 900;
    color: #06b6d4;
    font-variant-numeric: tabular-nums;
  }
  .speed-readout { display: flex; flex-direction: column; align-items: flex-end; min-width: 78px; }
  .speed-num { font-size: 40px; font-weight: 900; line-height: 0.95; font-variant-numeric: tabular-nums; }
  .speed-unit { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; color: #94a3b8; }

  .bc-meters { display: flex; flex-direction: column; gap: 8px; min-width: 158px; }
  .pedal-row { display: flex; align-items: center; gap: 6px; }
  .pedal-lbl { font-size: 10px; font-weight: 800; color: #94a3b8; }
  .bar-track { flex: 1; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; }
  .bar-fill.gas { height: 100%; background: #22c55e; }
  .bar-fill.brk { height: 100%; background: #ef4444; }

  .boost-row { display: flex; align-items: center; gap: 6px; }
  .boost-lbl { font-size: 10px; font-weight: 800; color: #38bdf8; letter-spacing: 0.06em; }
  .boost-track { flex: 1; height: 9px; background: rgba(255,255,255,0.12); border-radius: 4px; overflow: hidden; }
  .boost-fill { height: 100%; background: #06b6d4; transition: width 0.06s linear; }
  .boost-row[data-active="1"] .boost-fill { background: #facc15; }
  .boost-pct { font-size: 11px; font-weight: 800; width: 34px; text-align: right; font-variant-numeric: tabular-nums; color: #e2e8f0; }

  /* Touch Controls */
  .touch-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .touch-left, .touch-right {
    position: absolute;
    bottom: 92px;
    display: flex;
    gap: 8px;
    pointer-events: auto;
  }
  .touch-left { left: 16px; }
  .touch-right { right: 16px; flex-wrap: wrap; justify-content: flex-end; max-width: 190px; }
  .touch-btn {
    min-width: 56px;
    height: 48px;
    padding: 0 12px;
    border-radius: 8px;
    background: rgba(11, 16, 25, 0.85);
    border: 1px solid rgba(255,255,255,0.22);
    color: #f8fafc;
    font-size: 13px;
    font-weight: 800;
    touch-action: none;
  }
  .touch-btn.active { background: #06b6d4; color: #091017; }
  .touch-btn.accent-gas { border-color: #22c55e; }
  .touch-btn.accent-brake { border-color: #ef4444; }
  .touch-btn.accent-drift { border-color: #facc15; }
  .touch-btn.accent-nitro { border-color: #38bdf8; }

  /* Modals */
  .modal-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(8, 12, 18, 0.76);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    pointer-events: auto;
  }
  .modal-card {
    background: #111827;
    border: 1px solid rgba(255,255,255,0.14);
    border-radius: 10px;
    padding: 24px 28px;
    width: 100%;
    max-width: 480px;
    max-height: 92vh;
    overflow-y: auto;
    box-shadow: 0 20px 48px rgba(0,0,0,0.65);
  }
  .results-card { max-width: 720px; }
  .modal-card h2 { margin: 0 0 4px; font-size: 24px; font-weight: 800; }
  .modal-sub { margin: 0 0 18px; font-size: 13px; color: #94a3b8; }
  .modal-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
  .modal-actions.col { flex-direction: column; }

  /* Controls / Settings / How To Lists */
  .key-list, .settings-list, .howto-steps { display: flex; flex-direction: column; gap: 10px; }
  .key-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px;
    background: rgba(255,255,255,0.04);
    border-radius: 6px;
    font-size: 13px;
  }
  kbd {
    background: #1e293b;
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 4px;
    padding: 3px 8px;
    font-family: ui-monospace, monospace;
    font-size: 12px;
    font-weight: 700;
    color: #38bdf8;
  }
  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 10px 12px;
    background: rgba(255,255,255,0.04);
    border-radius: 6px;
  }
  .setting-row strong { display: block; font-size: 14px; }
  .setting-row span { font-size: 12px; color: #94a3b8; }
  .toggle-btn {
    min-width: 64px;
    padding: 7px 14px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.2);
    background: #1e293b;
    color: #94a3b8;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
  }
  .toggle-btn[data-on="1"] { background: #06b6d4; color: #091017; border-color: #06b6d4; }

  .howto-item {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 10px;
    background: rgba(255,255,255,0.04);
    border-radius: 6px;
  }
  .howto-item p { margin: 4px 0 0; font-size: 13px; color: #cbd5e1; line-height: 1.45; }
  .step-tag {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 13px;
    flex-shrink: 0;
    color: #091017;
  }
  .step-tag.green { background: #22c55e; }
  .step-tag.amber { background: #facc15; }
  .step-tag.cyan { background: #06b6d4; }

  /* Podium & Results Table */
  .podium-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    align-items: end;
    gap: 10px;
    margin-bottom: 16px;
  }
  .podium-slot { display: flex; flex-direction: column; align-items: stretch; }
  .podium-badge {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.16);
    border-top-width: 3px;
    border-radius: 6px 6px 0 0;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: center;
    text-align: center;
  }
  .podium-num { font-size: 12px; font-weight: 900; padding: 2px 8px; border-radius: 4px; }
  .podium-name { font-size: 13px; font-weight: 800; }
  .podium-time { font-size: 12px; color: #94a3b8; font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums; }
  .podium-step {
    background: #1e293b;
    text-align: center;
    font-weight: 900;
    font-size: 14px;
    padding: 6px 0;
    border-radius: 0 0 6px 6px;
  }
  .podium-slot.place-1 .podium-step { padding: 14px 0; background: #facc15; color: #0f172a; }
  .podium-slot.place-2 .podium-step { padding: 9px 0; background: #cbd5e1; color: #0f172a; }
  .podium-slot.place-3 .podium-step { padding: 5px 0; background: #d97706; color: #ffffff; }

  .summary-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 14px;
  }
  .stat-tile {
    background: rgba(255,255,255,0.04);
    border-radius: 6px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .stat-tile.wide { grid-column: span 4; }
  .stat-k { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; }
  .stat-v { font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; }

  .results-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .results-table th {
    text-align: left;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #94a3b8;
    padding: 7px 8px;
    border-bottom: 1px solid rgba(255,255,255,0.12);
  }
  .results-table td { padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.06); vertical-align: middle; }
  .results-table tr.is-player td { background: rgba(6, 182, 212, 0.14); font-weight: 700; }
  .results-table .num { text-align: right; font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums; }
  .results-table td.muted { color: #94a3b8; }
  .num-pill {
    display: inline-block;
    min-width: 24px;
    text-align: center;
    padding: 2px 5px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 900;
    margin-right: 6px;
  }

  @media (max-width: 780px) {
    .title-screen { padding: 24px; }
    .hud-tl { top: 10px; left: 10px; padding: 8px 12px; gap: 10px; }
    .pos-num { font-size: 28px; }
    .hud-tr-stack { top: 10px; right: 10px; }
    .hud-times { gap: 10px; padding: 7px 10px; }
    .time-col { min-width: 54px; }
    .hud-bl { display: none; }
    .hud-bc { bottom: 10px; min-width: 0; width: calc(100% - 20px); padding: 8px 12px; gap: 10px; justify-content: space-between; }
    .speed-num { font-size: 30px; }
    .bc-meters { min-width: 110px; }
    .summary-grid { grid-template-columns: repeat(2, 1fr); }
    .stat-tile.wide { grid-column: span 2; }
  }
`;
