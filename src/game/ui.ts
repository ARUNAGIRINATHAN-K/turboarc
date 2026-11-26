import { CAR_SPECS, CarState } from './physics';
import { CameraMode } from './renderer3d';
import { TOTAL_LAPS } from './sim';
import { CIRCUIT } from './track';

export type GameScreenState = 'title' | 'playing' | 'paused' | 'gameover';

export interface UIHandlers {
  onStartRace: () => void;
  onResume: () => void;
  onRestart: () => void;
  onMainMenu: () => void;
  onToggleCamera: () => void;
  onResetCar: () => void;
  onToggleMute: () => void;
  onTogglePause: () => void;
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

  private titleOverlay: HTMLElement;
  private hudOverlay: HTMLElement;
  private pauseModal: HTMLElement;
  private resultsModal: HTMLElement;
  private countdownBanner: HTMLElement;

  // Live HUD numeric refs (mutated directly at <=20Hz without layout thrash)
  private posNumEl: HTMLElement;
  private posOrdEl: HTMLElement;
  private lapValEl: HTMLElement;
  private curLapEl: HTMLElement;
  private bestLapEl: HTMLElement;
  private speedEl: HTMLElement;
  private driftEl: HTMLElement;
  private camBtnEl: HTMLButtonElement;
  private muteBtnEl: HTMLButtonElement;
  private demoTagEl: HTMLElement;

  private minimapCanvas: HTMLCanvasElement;
  private minimapCtx: CanvasRenderingContext2D;
  private minimapTrackPoints: Array<[number, number]> = [];

  private resultsBodyEl: HTMLElement;
  private resultsTitleEl: HTMLElement;
  private resultsSubEl: HTMLElement;

  constructor(container: HTMLElement, handlers: UIHandlers) {
    this.handlers = handlers;
    this.root = document.createElement('div');
    this.root.className = 'race-ui-root';
    this.root.innerHTML = this.buildMarkup();
    container.appendChild(this.root);

    this.titleOverlay = this.root.querySelector('[data-el="title"]')!;
    this.hudOverlay = this.root.querySelector('[data-el="hud"]')!;
    this.pauseModal = this.root.querySelector('[data-el="pause"]')!;
    this.resultsModal = this.root.querySelector('[data-el="results"]')!;
    this.countdownBanner = this.root.querySelector('[data-el="countdown"]')!;

    this.posNumEl = this.root.querySelector('[data-el="pos-num"]')!;
    this.posOrdEl = this.root.querySelector('[data-el="pos-ord"]')!;
    this.lapValEl = this.root.querySelector('[data-el="lap-val"]')!;
    this.curLapEl = this.root.querySelector('[data-el="cur-lap"]')!;
    this.bestLapEl = this.root.querySelector('[data-el="best-lap"]')!;
    this.speedEl = this.root.querySelector('[data-el="speed-val"]')!;
    this.driftEl = this.root.querySelector('[data-el="drift-flag"]')!;
    this.camBtnEl = this.root.querySelector('[data-action="camera"]')!;
    this.muteBtnEl = this.root.querySelector('[data-action="mute"]')!;
    this.demoTagEl = this.root.querySelector('[data-el="demo-tag"]')!;

    this.minimapCanvas = this.root.querySelector('[data-el="minimap"]')!;
    this.minimapCtx = this.minimapCanvas.getContext('2d')!;
    this.resultsBodyEl = this.root.querySelector('[data-el="results-body"]')!;
    this.resultsTitleEl = this.root.querySelector('[data-el="results-title"]')!;
    this.resultsSubEl = this.root.querySelector('[data-el="results-sub"]')!;

    this.precomputeMinimap();
    this.bindEvents();
  }

  private precomputeMinimap(): void {
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    const pad = 16;
    const spanX = CIRCUIT.maxX - CIRCUIT.minX;
    const spanZ = CIRCUIT.maxZ - CIRCUIT.minZ;
    const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanZ);
    const offsetX = (w - spanX * scale) * 0.5 - CIRCUIT.minX * scale;
    const offsetZ = (h - spanZ * scale) * 0.5 - CIRCUIT.minZ * scale;

    this.minimapTrackPoints = [];
    for (let i = 0; i < CIRCUIT.samples.length; i += 3) {
      const s = CIRCUIT.samples[i];
      // Invert X or keep top-down map aligned so +Z points up on minimap
      this.minimapTrackPoints.push([w - (s.x * scale + offsetX), h - (s.z * scale + offsetZ)]);
    }
  }

  private worldToMinimap(x: number, z: number): [number, number] {
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    const pad = 16;
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
          e.currentTarget && (e.currentTarget as HTMLButtonElement).blur();
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
  }

  setScreenState(state: GameScreenState, isDemo: boolean): void {
    document.body.dataset.state = state;
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
    this.muteBtnEl.dataset.muted = muted ? '1' : '0';
    this.muteBtnEl.setAttribute('aria-label', muted ? 'Unmute audio (M)' : 'Mute audio (M)');
  }

  updateHUD(
    cars: ReadonlyArray<CarState>,
    order: ReadonlyArray<number>,
    phase: 'countdown' | 'racing' | 'finished',
    countdownDisplay: number,
    goFlashTimer: number,
    raceTime: number
  ): void {
    const player = cars[0];
    const pos = order.indexOf(0) + 1;

    this.posNumEl.textContent = String(pos);
    this.posOrdEl.textContent = ordinalSuffix(pos);

    const displayLap = Math.min(TOTAL_LAPS, player.lapsCompleted + 1);
    this.lapValEl.textContent = `${displayLap} / ${TOTAL_LAPS}`;

    const curLapSec = phase === 'countdown' ? 0 : Math.max(0, raceTime - player.currentLapStartTime);
    this.curLapEl.textContent = formatRaceTime(curLapSec);
    this.bestLapEl.textContent = formatRaceTime(player.bestLapTime);

    this.speedEl.textContent = String(Math.round(player.speedKmh));
    this.driftEl.style.opacity = player.isDrifting ? '1' : '0';

    // Countdown / GO banner
    if (phase === 'countdown') {
      this.countdownBanner.hidden = false;
      this.countdownBanner.textContent = String(countdownDisplay);
      this.countdownBanner.dataset.go = '0';
    } else if (goFlashTimer > 0) {
      this.countdownBanner.hidden = false;
      this.countdownBanner.textContent = 'GO!';
      this.countdownBanner.dataset.go = '1';
    } else {
      this.countdownBanner.hidden = true;
    }

    this.drawMinimap(cars);
  }

  private drawMinimap(cars: ReadonlyArray<CarState>): void {
    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    ctx.clearRect(0, 0, w, h);

    // Circuit outline
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

    // Start/finish line tick
    const s0 = CIRCUIT.sampleAtS(0);
    const [sx, sy] = this.worldToMinimap(s0.x, s0.z);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx - 3, sy - 1.5, 6, 3);

    // Draw AI opponents first, then player car on top
    for (let i = 5; i >= 0; i--) {
      const car = cars[i];
      const [cx, cy] = this.worldToMinimap(car.x, car.z);
      ctx.beginPath();
      ctx.arc(cx, cy, i === 0 ? 5.2 : 3.8, 0, Math.PI * 2);
      ctx.fillStyle = CAR_SPECS[i].color;
      ctx.fill();
      ctx.lineWidth = i === 0 ? 2 : 1.2;
      ctx.strokeStyle = i === 0 ? '#ffffff' : '#0f172a';
      ctx.stroke();
    }
  }

  showResults(cars: ReadonlyArray<CarState>, order: ReadonlyArray<number>, isDemo: boolean): void {
    const playerRank = order.indexOf(0) + 1;
    this.resultsTitleEl.textContent =
      playerRank === 1 ? 'Victory — 1st Place' : `Finished ${playerRank}${ordinalSuffix(playerRank).toLowerCase()} of 6`;
    this.resultsSubEl.textContent = isDemo
      ? 'Demo race complete — starting next race automatically'
      : '3-Lap Grand Prix Classification';

    const leaderTime = cars[order[0]].finishTime;
    const rowsHtml = order
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
              <span class="swatch" style="background:${car.spec.color}"></span>
              <span class="driver-name">${car.spec.name}</span>
            </td>
            <td class="num">${bestStr}</td>
            <td class="num">${totalStr}</td>
            <td class="num muted">${gapStr}</td>
          </tr>
        `;
      })
      .join('');

    this.resultsBodyEl.innerHTML = rowsHtml;
  }

  private buildMarkup(): string {
    return `
      <!-- Title Screen Overlay -->
      <div class="screen-overlay title-screen" data-el="title">
        <div class="title-panel">
          <svg class="title-emblem" viewBox="0 0 420 96" aria-label="Apex Circuit GP">
            <rect x="0" y="8" width="10" height="80" fill="#ef4444" />
            <rect x="16" y="8" width="4" height="80" fill="#f8fafc" opacity="0.65" />
            <text x="34" y="48" fill="#f8fafc" font-size="38" font-weight="800" letter-spacing="2" font-family="system-ui, -apple-system, sans-serif">APEX CIRCUIT</text>
            <text x="36" y="78" fill="#cbd5e1" font-size="16" font-weight="600" letter-spacing="4" font-family="system-ui, -apple-system, sans-serif">3-LAP GRAND PRIX · 6 CARS</text>
          </svg>
          <div class="title-actions">
            <button type="button" class="btn-primary" data-action="start" data-start="true">Start Race</button>
          </div>
          <p class="control-strip">Arrows / WASD Drive · Space Drift · C Camera · R Reset · P Pause</p>
        </div>
      </div>

      <!-- Playing HUD Overlay -->
      <div class="hud-overlay" data-el="hud" hidden>
        <!-- Top-Left: Position, Lap & Timing -->
        <div class="hud-card hud-tl">
          <div class="pos-block">
            <span class="pos-num" data-el="pos-num">6</span>
            <span class="pos-meta">
              <span class="pos-ord" data-el="pos-ord">TH</span>
              <span class="pos-total">OF 6</span>
            </span>
          </div>
          <div class="hud-divider"></div>
          <div class="lap-block">
            <div class="hud-kicker">Lap</div>
            <div class="hud-val" data-el="lap-val">1 / 3</div>
          </div>
          <div class="hud-divider"></div>
          <div class="times-block">
            <div class="time-row">
              <span class="hud-kicker">Current</span>
              <span class="time-val" data-el="cur-lap">0:00.00</span>
            </div>
            <div class="time-row">
              <span class="hud-kicker">Best</span>
              <span class="time-val accent" data-el="best-lap">--:--.--</span>
            </div>
          </div>
        </div>

        <!-- Top-Right: Compact Controls -->
        <div class="hud-tr">
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

        <!-- Center Countdown -->
        <div class="countdown-banner" data-el="countdown" hidden>3</div>

        <!-- Bottom-Left: Minimap -->
        <div class="hud-card hud-bl">
          <canvas width="176" height="132" data-el="minimap" aria-label="Circuit minimap"></canvas>
        </div>

        <!-- Bottom-Right: Speedometer -->
        <div class="hud-card hud-br">
          <div class="drift-indicator" data-el="drift-flag" style="opacity:0">DRIFT</div>
          <div class="speed-num" data-el="speed-val">0</div>
          <div class="speed-unit">KM/H</div>
        </div>
      </div>

      <!-- Pause Modal -->
      <div class="modal-backdrop" data-el="pause" hidden>
        <div class="modal-card" role="dialog" aria-label="Race Paused">
          <h2>Race Paused</h2>
          <p class="modal-sub">Arrows / WASD Drive · Space Drift · C Camera · R Reset</p>
          <div class="modal-actions">
            <button type="button" class="btn-primary" data-action="resume">Resume</button>
            <button type="button" class="btn-secondary" data-action="restart">Restart Race</button>
            <button type="button" class="btn-secondary" data-action="menu">Main Menu</button>
          </div>
        </div>
      </div>

      <!-- Results Table Modal -->
      <div class="modal-backdrop" data-el="results" hidden>
        <div class="modal-card results-card" role="dialog" aria-label="Race Results">
          <h2 data-el="results-title">Race Results</h2>
          <p class="modal-sub" data-el="results-sub">3-Lap Grand Prix Classification</p>
          <table class="results-table">
            <thead>
              <tr>
                <th class="num">Pos</th>
                <th>Driver</th>
                <th class="num">Best Lap</th>
                <th class="num">Total Time</th>
                <th class="num">Gap</th>
              </tr>
            </thead>
            <tbody data-el="results-body"></tbody>
          </table>
          <div class="modal-actions">
            <button type="button" class="btn-primary" data-action="restart" data-start="true">Race Again</button>
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
    background: linear-gradient(180deg, rgba(10,14,22,0.12) 0%, rgba(10,14,22,0.72) 100%);
    pointer-events: auto;
  }
  .title-panel {
    max-width: 520px;
  }
  .title-emblem {
    width: 100%;
    max-width: 420px;
    height: auto;
    display: block;
    margin-bottom: 24px;
    filter: drop-shadow(0 6px 20px rgba(0,0,0,0.6));
  }
  .title-actions {
    display: flex;
    gap: 12px;
    margin-bottom: 18px;
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
    padding: 12px 28px;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.03em;
    white-space: nowrap;
    transition: transform 0.14s ease, background-color 0.14s ease;
  }
  .btn-primary {
    background: #ef4444;
    color: #ffffff;
    box-shadow: 0 6px 20px rgba(239,68,68,0.35);
  }
  .btn-primary:hover { background: #dc2626; transform: translateY(-1px); }
  .btn-secondary {
    background: rgba(30, 41, 59, 0.92);
    color: #f8fafc;
    border: 1px solid rgba(255,255,255,0.16);
  }
  .btn-secondary:hover { background: rgba(51, 65, 85, 0.96); }
  .btn-primary:focus-visible, .btn-secondary:focus-visible, .icon-btn:focus-visible {
    outline: 2px solid #f8fafc;
    outline-offset: 2px;
  }

  /* Playing HUD */
  .hud-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .hud-card {
    position: absolute;
    background: rgba(12, 16, 24, 0.84);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.36);
  }
  .hud-tl {
    top: 20px;
    left: 20px;
    padding: 12px 18px;
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .pos-block {
    display: flex;
    align-items: baseline;
    gap: 4px;
  }
  .pos-num {
    font-size: 40px;
    font-weight: 800;
    line-height: 1;
    color: #f8fafc;
    font-variant-numeric: tabular-nums;
  }
  .pos-meta {
    display: flex;
    flex-direction: column;
    font-size: 11px;
    font-weight: 700;
    color: #94a3b8;
    line-height: 1.15;
  }
  .pos-ord { color: #ef4444; }
  .hud-divider {
    width: 1px;
    height: 36px;
    background: rgba(255,255,255,0.12);
  }
  .lap-block {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .hud-kicker {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: #94a3b8;
    text-transform: uppercase;
  }
  .hud-val {
    font-size: 22px;
    font-weight: 800;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }
  .times-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 132px;
  }
  .time-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }
  .time-val {
    font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
    font-size: 15px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: #f8fafc;
  }
  .time-val.accent { color: #f59e0b; }

  /* Top-Right Icon Buttons */
  .hud-tr {
    position: absolute;
    top: 20px;
    right: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    pointer-events: auto;
  }
  .demo-label {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #f59e0b;
    background: rgba(12, 16, 24, 0.84);
    border: 1px solid rgba(245, 158, 11, 0.35);
    border-radius: 6px;
    padding: 8px 12px;
  }
  .icon-btn {
    width: 38px;
    height: 38px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    background: rgba(12, 16, 24, 0.84);
    border: 1px solid rgba(255,255,255,0.14);
    color: #f8fafc;
    cursor: pointer;
    transition: background-color 0.14s ease;
  }
  .icon-btn:hover { background: rgba(30, 41, 59, 0.94); }
  .icon-btn[data-muted="1"] { color: #ef4444; }
  .icon-btn[data-mode="cockpit"] { border-color: #06b6d4; color: #38bdf8; }

  /* Countdown Banner */
  .countdown-banner {
    position: absolute;
    top: 10%;
    left: 50%;
    transform: translateX(-50%);
    font-size: 92px;
    font-weight: 900;
    letter-spacing: 0.04em;
    color: #ef4444;
    text-shadow: 0 6px 24px rgba(0,0,0,0.8);
    font-variant-numeric: tabular-nums;
  }
  .countdown-banner[data-go="1"] {
    color: #22c55e;
  }

  /* Minimap */
  .hud-bl {
    bottom: 20px;
    left: 20px;
    padding: 8px;
  }
  .hud-bl canvas {
    display: block;
    width: 176px;
    height: 132px;
  }

  /* Speedometer */
  .hud-br {
    bottom: 20px;
    right: 20px;
    padding: 12px 20px;
    min-width: 140px;
    text-align: right;
  }
  .drift-indicator {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.12em;
    color: #f59e0b;
    margin-bottom: 2px;
    transition: opacity 0.1s ease;
  }
  .speed-num {
    font-size: 46px;
    font-weight: 900;
    line-height: 0.95;
    font-variant-numeric: tabular-nums;
    color: #f8fafc;
  }
  .speed-unit {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: #94a3b8;
    margin-top: 2px;
  }

  /* Modals */
  .modal-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(8, 12, 18, 0.72);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    pointer-events: auto;
  }
  .modal-card {
    background: #111827;
    border: 1px solid rgba(255,255,255,0.14);
    border-radius: 10px;
    padding: 28px 32px;
    width: 100%;
    max-width: 460px;
    box-shadow: 0 20px 48px rgba(0,0,0,0.6);
  }
  .results-card {
    max-width: 640px;
  }
  .modal-card h2 {
    margin: 0 0 6px;
    font-size: 26px;
    font-weight: 800;
  }
  .modal-sub {
    margin: 0 0 20px;
    font-size: 13px;
    color: #94a3b8;
  }
  .modal-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 22px;
  }

  /* Results Table */
  .results-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  .results-table th {
    text-align: left;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #94a3b8;
    padding: 8px 10px;
    border-bottom: 1px solid rgba(255,255,255,0.12);
  }
  .results-table td {
    padding: 10px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    vertical-align: middle;
  }
  .results-table tr.is-player td {
    background: rgba(239, 68, 68, 0.12);
    font-weight: 700;
  }
  .results-table .num {
    text-align: right;
    font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
    font-variant-numeric: tabular-nums;
  }
  .results-table td.muted { color: #94a3b8; }
  .swatch {
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 3px;
    margin-right: 8px;
    vertical-align: -1px;
  }

  @media (max-width: 640px) {
    .title-screen { padding: 24px; }
    .hud-tl { top: 12px; left: 12px; padding: 10px 12px; gap: 10px; }
    .pos-num { font-size: 28px; }
    .hud-val { font-size: 18px; }
    .times-block { min-width: 105px; }
    .hud-tr { top: 12px; right: 12px; }
    .hud-bl { bottom: 12px; left: 12px; }
    .hud-bl canvas { width: 132px; height: 99px; }
    .hud-br { bottom: 12px; right: 12px; padding: 10px 14px; min-width: 108px; }
    .speed-num { font-size: 34px; }
  }
`;
