import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const rootDir = path.resolve(import.meta.dirname, '..');

// Bundle our TypeScript game + Three.js into a single self-contained IIFE script
const result = await esbuild.build({
  entryPoints: [path.join(rootDir, 'src/game/main_entry.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  target: ['es2022'],
  minify: true,
  sourcemap: false,
});

const bundledJs = result.outputFiles[0].text;

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>Turbovex 2.0 — 3D Arcade Racing</title>
  <meta name="description" content="Turbovex 2.0 3D arcade car racing with dynamic racing line, drift combo scoring, nitro boost, 6 unique drivers, podium presentation, and deterministic benchmarking." />
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #0b0f19;
      color: #f8fafc;
      font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      user-select: none;
      -webkit-user-select: none;
    }

    #canvas-host {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: 0;
    }

    #canvas-host canvas {
      display: block;
      width: 100%;
      height: 100%;
    }

    .tabular {
      font-variant-numeric: tabular-nums;
    }

    /* Main Menu / Title Overlay — Left side over calm sky/horizon negative space */
    #title-overlay {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 40px 46px 26px;
      pointer-events: none;
      background: linear-gradient(108deg, rgba(8, 12, 22, 0.78) 0%, rgba(8, 12, 22, 0.34) 44%, rgba(8, 12, 22, 0.0) 76%);
    }

    .title-block {
      max-width: 470px;
      pointer-events: auto;
    }

    .title-svg {
      display: block;
      width: 100%;
      max-width: 430px;
      height: auto;
      margin-bottom: 16px;
      filter: drop-shadow(0 6px 18px rgba(0, 0, 0, 0.55));
    }

    .title-tagline {
      margin: 0 0 20px;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.5;
      color: #cbd5e1;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.85);
    }

    .title-menu-stack {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
    }

    .title-menu-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .btn-primary {
      appearance: none;
      border: none;
      cursor: pointer;
      background: #06b6d4;
      color: #04131c;
      font-size: 15px;
      font-weight: 900;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      padding: 14px 32px;
      border-radius: 6px;
      box-shadow: 0 8px 24px rgba(6, 182, 212, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.4);
      transition: transform 120ms ease, background 120ms ease;
    }

    .btn-primary:hover {
      background: #22d3ee;
      transform: translateY(-1px);
    }

    .btn-primary:active {
      transform: translateY(1px);
    }

    .btn-secondary {
      appearance: none;
      border: 1px solid rgba(255, 255, 255, 0.22);
      cursor: pointer;
      background: rgba(15, 23, 42, 0.9);
      color: #f8fafc;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 11px 18px;
      border-radius: 6px;
      transition: background 120ms ease, border-color 120ms ease;
    }

    .btn-secondary:hover {
      background: rgba(30, 41, 59, 0.96);
      border-color: rgba(6, 182, 212, 0.6);
    }

    .seed-hint {
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.12em;
      color: #38bdf8;
      text-shadow: 0 2px 6px rgba(0, 0, 0, 0.7);
      margin-left: 6px;
    }

    .control-hint-bar {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.06em;
      color: rgba(248, 250, 252, 0.88);
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.85);
    }

    /* Playing HUD — Compact perimeter corners & bottom dash, >=85% center road clear */
    #hud-overlay {
      position: fixed;
      inset: 0;
      z-index: 15;
      pointer-events: none;
      display: none;
    }

    .hud-panel {
      background: rgba(11, 15, 25, 0.88);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-top: 3px solid #06b6d4;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.44);
    }

    .hud-kicker {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.13em;
      color: #94a3b8;
      text-transform: uppercase;
      display: block;
      margin-bottom: 2px;
    }

    /* TOP LEFT: Position, Lap, Race Progress, Sector Split */
    .hud-top-left {
      position: fixed;
      top: 16px;
      left: 18px;
      padding: 10px 16px;
      min-width: 224px;
    }

    .hud-row-split {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 8px;
    }

    .hud-hero-pos {
      font-size: 30px;
      font-weight: 900;
      line-height: 1;
      color: #ffffff;
    }

    .hud-hero-sub {
      font-size: 12px;
      font-weight: 800;
      color: #06b6d4;
      margin-left: 3px;
    }

    .hud-hero-lap {
      font-size: 22px;
      font-weight: 900;
      line-height: 1;
      color: #f8fafc;
    }

    .hud-progress-wrap {
      margin-top: 4px;
    }

    .hud-progress-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.1em;
      color: #cbd5e1;
      margin-bottom: 4px;
    }

    .hud-progress-track {
      width: 100%;
      height: 5px;
      background: rgba(255, 255, 255, 0.12);
      border-radius: 99px;
      overflow: hidden;
    }

    .hud-progress-fill {
      width: 0%;
      height: 100%;
      background: linear-gradient(90deg, #06b6d4, #22c55e);
      transition: width 120ms linear;
    }

    .hud-sector-row {
      margin-top: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .hud-sector-pill {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      color: #cbd5e1;
      padding: 2px 7px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.08);
    }

    .hud-sector-pill.ahead {
      color: #34d399;
      background: rgba(16, 185, 129, 0.16);
    }

    .hud-sector-pill.behind {
      color: #f87171;
      background: rgba(239, 68, 68, 0.16);
    }

    #hud-demo-badge {
      display: none;
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.12em;
      color: #fbbf24;
      text-transform: uppercase;
    }

    /* TOP RIGHT: Lap Times, Total Time & Utility Controls */
    .hud-top-right {
      position: fixed;
      top: 16px;
      right: 18px;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
    }

    .hud-timing-box {
      padding: 10px 16px;
      min-width: 240px;
      border-top-color: #22c55e;
    }

    .hud-times-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .hud-time-val {
      font-size: 14px;
      font-weight: 800;
      color: #f8fafc;
    }

    .hud-time-val.best {
      color: #34d399;
    }

    .util-bar {
      display: flex;
      gap: 6px;
      pointer-events: auto;
    }

    .util-btn {
      appearance: none;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(11, 15, 25, 0.88);
      color: #e2e8f0;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.08em;
      padding: 6px 9px;
      border-radius: 6px;
      cursor: pointer;
    }

    .util-btn:hover {
      background: rgba(30, 41, 59, 0.96);
      color: #ffffff;
    }

    .util-btn.is-off {
      color: #94a3b8;
      border-color: rgba(255, 255, 255, 0.1);
    }

    /* BOTTOM LEFT: Minimap */
    .hud-bottom-left {
      position: fixed;
      bottom: 16px;
      left: 18px;
    }

    .minimap-box {
      padding: 6px;
      border-top-color: #3b82f6;
    }

    #minimap-canvas {
      display: block;
      width: 156px;
      height: 156px;
    }

    /* BOTTOM CENTER: Digital Speedometer, Gear, Gas/Brake, Nitro Boost, Drift Combo */
    .hud-bottom-center {
      position: fixed;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: stretch;
      gap: 12px;
      padding: 10px 16px;
      border-top-color: #f59e0b;
      min-width: 470px;
      max-width: 92vw;
    }

    .dash-pedals {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-width: 84px;
      padding-right: 12px;
      border-right: 1px solid rgba(255, 255, 255, 0.12);
    }

    .gear-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 4px;
    }

    .gear-val {
      font-size: 22px;
      font-weight: 900;
      color: #fbbf24;
      line-height: 1;
    }

    .pedal-meter {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 9px;
      font-weight: 800;
      color: #94a3b8;
    }

    .pedal-track {
      flex: 1;
      height: 5px;
      background: rgba(255, 255, 255, 0.12);
      border-radius: 3px;
      overflow: hidden;
    }

    .pedal-fill-thr {
      width: 0%;
      height: 100%;
      background: #22c55e;
    }

    .pedal-fill-brk {
      width: 0%;
      height: 100%;
      background: #ef4444;
    }

    .dash-core {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-width: 210px;
    }

    .speed-line {
      display: flex;
      align-items: baseline;
      justify-content: center;
      gap: 6px;
    }

    .hud-speed-num {
      font-size: 42px;
      font-weight: 900;
      line-height: 0.92;
      color: #ffffff;
      letter-spacing: -0.02em;
    }

    .hud-speed-unit {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.1em;
      color: #94a3b8;
    }

    .nitro-wrap {
      margin-top: 6px;
    }

    .nitro-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.08em;
      margin-bottom: 3px;
    }

    .nitro-status {
      color: #94a3b8;
    }

    .nitro-status.ready {
      color: #38bdf8;
    }

    .nitro-status.boosting {
      color: #22d3ee;
    }

    .nitro-status.locked {
      color: #f59e0b;
    }

    .nitro-track {
      width: 100%;
      height: 7px;
      background: rgba(255, 255, 255, 0.14);
      border-radius: 99px;
      overflow: hidden;
    }

    .nitro-fill {
      width: 40%;
      height: 100%;
      background: linear-gradient(90deg, #0284c7, #06b6d4, #67e8f9);
      transition: width 60ms linear;
    }

    .nitro-fill.is-boosting {
      background: linear-gradient(90deg, #38bdf8, #ffffff, #38bdf8);
    }

    .nitro-fill.is-locked {
      background: #f59e0b;
    }

    .dash-drift {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-width: 126px;
      padding-left: 12px;
      border-left: 1px solid rgba(255, 255, 255, 0.12);
      text-align: right;
    }

    #hud-drift-box {
      opacity: 0.42;
      transition: opacity 100ms ease;
    }

    #hud-drift-box.active {
      opacity: 1;
    }

    .drift-top {
      display: flex;
      justify-content: flex-end;
      align-items: baseline;
      gap: 6px;
    }

    .drift-combo-tag {
      padding: 1px 6px;
      border-radius: 4px;
      background: #f59e0b;
      color: #0b0f19;
      font-size: 11px;
      font-weight: 900;
    }

    .drift-score-num {
      font-size: 20px;
      font-weight: 900;
      color: #fbbf24;
      line-height: 1.05;
    }

    .drift-angle-sub {
      font-size: 10px;
      font-weight: 800;
      color: #cbd5e1;
    }

    #hud-cam {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.08em;
      color: #93c5fd;
    }

    /* TOP CENTER DYNAMIC TOASTS & CONTEXTUAL HINTS */
    .hud-top-center {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 7px;
      pointer-events: none;
    }

    .hud-toast {
      display: none;
      padding: 7px 14px;
      border-radius: 6px;
      background: rgba(11, 15, 25, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.2);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
      align-items: center;
      gap: 8px;
      white-space: nowrap;
    }

    .hud-toast.event-gold { border-color: #f59e0b; color: #fde68a; }
    .hud-toast.event-cyan { border-color: #06b6d4; color: #cffafe; }
    .hud-toast.event-green { border-color: #22c55e; color: #bbf7d0; }
    .hud-toast.event-red { border-color: #ef4444; color: #fecaca; }

    .rival-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.7);
    }

    .hud-hint-pill {
      display: none;
      padding: 5px 12px;
      border-radius: 6px;
      background: rgba(11, 15, 25, 0.82);
      border: 1px solid rgba(56, 189, 248, 0.4);
      color: #e0f2fe;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
    }

    /* Countdown Center Banner */
    #countdown-banner {
      position: fixed;
      top: 16%;
      left: 50%;
      transform: translateX(-50%);
      z-index: 18;
      font-size: 84px;
      font-weight: 900;
      letter-spacing: 0.04em;
      text-shadow: 0 6px 24px rgba(0, 0, 0, 0.72), 0 0 2px #000000;
      pointer-events: none;
      display: none;
    }

    /* Optional Touch Controls */
    #touch-controls {
      position: fixed;
      inset: auto 18px 186px 18px;
      z-index: 17;
      display: none;
      justify-content: space-between;
      align-items: flex-end;
      pointer-events: none;
    }

    .touch-cluster {
      display: flex;
      gap: 8px;
      pointer-events: auto;
    }

    .touch-btn {
      appearance: none;
      touch-action: none;
      width: 58px;
      height: 54px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.28);
      background: rgba(15, 23, 42, 0.84);
      color: #f8fafc;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.06em;
    }

    .touch-btn.gas { border-color: #22c55e; color: #86efac; }
    .touch-btn.nitro { border-color: #06b6d4; color: #67e8f9; }
    .touch-btn.drift { border-color: #f59e0b; color: #fde68a; }
    .touch-btn.pressed { background: rgba(6, 182, 212, 0.45); transform: scale(0.96); }

    /* Modals */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 30;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(8, 12, 22, 0.78);
      padding: 20px;
    }

    #confetti-canvas {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 31;
    }

    .modal-card {
      position: relative;
      z-index: 32;
      background: rgba(15, 23, 42, 0.97);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-top: 4px solid #06b6d4;
      border-radius: 10px;
      padding: 24px 28px;
      width: 100%;
      max-width: 660px;
      max-height: 92vh;
      overflow-y: auto;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7);
    }

    .modal-card.pause-card {
      max-width: 380px;
      text-align: center;
    }

    .modal-title {
      margin: 0 0 4px;
      font-size: 24px;
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #ffffff;
    }

    .modal-sub {
      margin: 0 0 16px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: #94a3b8;
    }

    .pause-actions {
      display: flex;
      flex-direction: column;
      gap: 9px;
      margin-top: 16px;
    }

    /* Controls / Settings / How-to grids */
    .key-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 18px;
    }

    .key-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      border-radius: 6px;
      background: rgba(30, 41, 59, 0.72);
      border: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 13px;
      font-weight: 700;
    }

    .kbd-badge {
      padding: 3px 8px;
      border-radius: 4px;
      background: #0f172a;
      border: 1px solid #38bdf8;
      color: #67e8f9;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.06em;
    }

    .settings-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 18px;
    }

    .setting-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 10px 14px;
      border-radius: 6px;
      background: rgba(30, 41, 59, 0.65);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .setting-row strong {
      display: block;
      font-size: 13px;
      color: #f8fafc;
    }

    .setting-row span {
      display: block;
      font-size: 11px;
      color: #94a3b8;
    }

    .setting-row select {
      background: #0f172a;
      color: #f8fafc;
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 5px;
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 700;
    }

    .setting-row input[type="checkbox"] {
      width: 18px;
      height: 18px;
      accent-color: #06b6d4;
      cursor: pointer;
    }

    .howto-sections {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 16px;
    }

    .howto-box {
      padding: 12px;
      border-radius: 6px;
      background: rgba(30, 41, 59, 0.62);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .howto-box h3 {
      margin: 0 0 6px;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #38bdf8;
    }

    .howto-box p {
      margin: 0;
      font-size: 12px;
      line-height: 1.45;
      color: #cbd5e1;
    }

    /* Results Podium + Telemetry + Table */
    .podium-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      align-items: end;
      gap: 10px;
      margin-bottom: 14px;
    }

    .podium-slot {
      padding: 10px 8px;
      border-radius: 8px;
      background: rgba(30, 41, 59, 0.78);
      border: 1px solid rgba(255, 255, 255, 0.14);
      text-align: center;
    }

    .podium-slot.rank-1 {
      padding-top: 16px;
      padding-bottom: 14px;
      border-color: #fbbf24;
      background: rgba(251, 191, 36, 0.12);
    }

    .podium-slot.rank-2 {
      border-color: #cbd5e1;
    }

    .podium-slot.rank-3 {
      border-color: #d97706;
    }

    .podium-slot.is-player {
      box-shadow: 0 0 0 2px #06b6d4;
    }

    .podium-rank {
      font-size: 11px;
      font-weight: 900;
      color: #94a3b8;
      letter-spacing: 0.1em;
    }

    .podium-num {
      display: inline-block;
      margin: 4px auto;
      padding: 2px 9px;
      border-radius: 5px;
      border: 2px solid #ffffff;
      font-size: 16px;
      font-weight: 900;
    }

    .podium-name {
      font-size: 13px;
      font-weight: 900;
      color: #ffffff;
    }

    .podium-time {
      font-size: 11px;
      font-weight: 700;
      color: #cbd5e1;
      margin-top: 2px;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }

    .stat-cell {
      padding: 7px 10px;
      border-radius: 6px;
      background: rgba(30, 41, 59, 0.65);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .stat-cell span {
      display: block;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #94a3b8;
    }

    .stat-cell strong {
      display: block;
      font-size: 14px;
      font-weight: 900;
      color: #f8fafc;
      margin-top: 2px;
    }

    .lap-splits-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 14px;
    }

    .lap-chip {
      padding: 4px 10px;
      border-radius: 5px;
      background: rgba(30, 41, 59, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.14);
      font-size: 11px;
      font-weight: 800;
      color: #cbd5e1;
    }

    .lap-chip.best {
      border-color: #22c55e;
      color: #86efac;
    }

    table.results-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
      font-size: 13px;
    }

    .results-table th {
      text-align: left;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #94a3b8;
      padding: 7px 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.14);
    }

    .results-table td {
      padding: 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      font-weight: 600;
      color: #e2e8f0;
    }

    .results-table tr.player-row td {
      background: rgba(6, 182, 212, 0.16);
      color: #ffffff;
      font-weight: 800;
    }

    .num-col {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .swatch {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 3px;
      margin-right: 7px;
      vertical-align: middle;
      border: 1px solid rgba(255, 255, 255, 0.45);
    }

    .car-num-tag {
      font-weight: 900;
      color: #94a3b8;
      margin-right: 3px;
    }

    .you-tag {
      display: inline-block;
      margin-left: 6px;
      padding: 1px 6px;
      border-radius: 3px;
      background: #06b6d4;
      color: #04131c;
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.08em;
    }

    .modal-actions-row {
      display: flex;
      gap: 10px;
      align-items: center;
    }
  </style>
</head>
<body data-state="title">
  <div id="canvas-host" data-testid="race-canvas"></div>

  <!-- Main Menu / Title Screen -->
  <section id="title-overlay" aria-label="Main Menu">
    <div class="title-block">
      <svg class="title-svg" viewBox="0 0 440 124" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Turbovex 2.0">
        <path d="M6 18 L54 18 L44 56 L0 56 Z" fill="#06B6D4"/>
        <path d="M15 24 L25 24 L22 35 L12 35 Z" fill="#FFFFFF"/>
        <path d="M35 24 L45 24 L42 35 L32 35 Z" fill="#FFFFFF"/>
        <path d="M22 35 L32 35 L29 46 L19 46 Z" fill="#FFFFFF"/>
        <text x="68" y="48" fill="#FFFFFF" font-family="system-ui, sans-serif" font-weight="900" font-size="36" letter-spacing="3">TURBOVEX 2.0</text>
        <rect x="68" y="60" width="352" height="4" fill="#06B6D4"/>
        <text x="68" y="88" fill="#E2E8F0" font-family="system-ui, sans-serif" font-weight="800" font-size="13" letter-spacing="3.5">APEX CIRCUIT · 6-CAR GRAND PRIX</text>
      </svg>
      <p class="title-tagline">
        Dynamic braking line, precision Space-bar drift combos, Shift Nitro Boost, and 5 distinct AI rivals across 3 high-speed laps.
      </p>
      <div class="title-menu-stack">
        <div class="title-menu-row">
          <button id="btn-start" class="btn-primary" data-start="true" type="button">Start Race</button>
          <span id="title-seed-hint" class="seed-hint tabular"></span>
        </div>
        <div class="title-menu-row">
          <button id="btn-menu-controls" class="btn-secondary" type="button">Controls</button>
          <button id="btn-menu-settings" class="btn-secondary" type="button">Settings</button>
          <button id="btn-menu-howto" class="btn-secondary" type="button">How to Play</button>
        </div>
      </div>
    </div>
    <div class="control-hint-bar">
      WASD / Arrows Drive &nbsp;·&nbsp; Space Drift &nbsp;·&nbsp; Shift Nitro Boost &nbsp;·&nbsp; C Camera &nbsp;·&nbsp; L Racing Line &nbsp;·&nbsp; R Reset &nbsp;·&nbsp; P Pause
    </div>
  </section>

  <!-- Active Race HUD -->
  <div id="hud-overlay" aria-label="Race HUD">
    <!-- TOP LEFT: Position, Lap, Race Progress, Sector Split -->
    <div class="hud-panel hud-top-left">
      <div class="hud-row-split">
        <div>
          <span class="hud-kicker">Position</span>
          <span id="hud-pos" class="hud-hero-pos tabular">6th</span><span class="hud-hero-sub">/ 6</span>
        </div>
        <div style="text-align:right">
          <span class="hud-kicker">Lap</span>
          <span id="hud-lap" class="hud-hero-lap tabular">1 / 3</span>
        </div>
      </div>
      <div class="hud-progress-wrap">
        <div class="hud-progress-head">
          <span>RACE PROGRESS</span>
          <span id="hud-progress-pct" class="tabular">0%</span>
        </div>
        <div class="hud-progress-track">
          <div id="hud-progress-bar" class="hud-progress-fill"></div>
        </div>
      </div>
      <div class="hud-sector-row">
        <span id="hud-sector-split" class="hud-sector-pill tabular">SECTOR --</span>
        <span id="hud-demo-badge">DEMO AUTOPILOT</span>
      </div>
    </div>

    <!-- TOP CENTER: Rival Alerts, Event Banners & Hints -->
    <div class="hud-top-center">
      <div id="hud-rival-toast" class="hud-toast"></div>
      <div id="hud-event-toast" class="hud-toast"></div>
      <div id="hud-hint-pill" class="hud-hint-pill"></div>
    </div>

    <!-- TOP RIGHT: Lap Times, Total Time & Quick Utility Controls -->
    <div class="hud-top-right">
      <div class="hud-panel hud-timing-box">
        <div class="hud-times-grid">
          <div>
            <span class="hud-kicker">Current</span>
            <span id="hud-cur-lap" class="hud-time-val tabular">00:00.00</span>
          </div>
          <div>
            <span class="hud-kicker">Best Lap</span>
            <span id="hud-best-lap" class="hud-time-val best tabular">--:--.--</span>
          </div>
          <div style="text-align:right">
            <span class="hud-kicker">Total</span>
            <span id="hud-total-time" class="hud-time-val tabular">00:00.00</span>
          </div>
        </div>
      </div>
      <div class="util-bar">
        <button id="btn-cam" class="util-btn" type="button" tabindex="-1" title="Switch Camera (C)">CAM [C]</button>
        <button id="btn-line" class="util-btn" type="button" tabindex="-1" title="Toggle Racing Line (L)">LINE ON</button>
        <button id="btn-reset" class="util-btn" type="button" tabindex="-1" title="Reset to Track (R)">RESET [R]</button>
        <button id="btn-mute" class="util-btn" type="button" tabindex="-1" aria-label="Toggle Mute" title="Mute Audio (M)">🔊</button>
        <button id="btn-pause" class="util-btn" type="button" tabindex="-1" aria-label="Pause Race" title="Pause (P)">⏸</button>
      </div>
    </div>

    <!-- BOTTOM LEFT: Track Minimap -->
    <div class="hud-bottom-left">
      <div class="hud-panel minimap-box">
        <canvas id="minimap-canvas" width="156" height="156" aria-label="Track Minimap"></canvas>
      </div>
    </div>

    <!-- BOTTOM CENTER: Speedometer, Gear, Gas/Brake, Nitro Boost, Drift Combo -->
    <div class="hud-panel hud-bottom-center">
      <div class="dash-pedals">
        <div class="gear-row">
          <span class="hud-kicker" style="margin:0">GEAR</span>
          <span id="hud-gear" class="gear-val tabular">N</span>
        </div>
        <div class="pedal-meter">
          <span>GAS</span>
          <div class="pedal-track"><div id="hud-throttle-bar" class="pedal-fill-thr"></div></div>
        </div>
        <div class="pedal-meter">
          <span>BRK</span>
          <div class="pedal-track"><div id="hud-brake-bar" class="pedal-fill-brk"></div></div>
        </div>
      </div>

      <div class="dash-core">
        <div class="speed-line">
          <span id="hud-speed" class="hud-speed-num tabular">0</span>
          <span class="hud-speed-unit">KM/H</span>
        </div>
        <div class="nitro-wrap">
          <div class="nitro-head">
            <span id="hud-nitro-status" class="nitro-status ready">NITRO READY [SHIFT]</span>
            <span id="hud-nitro-pct" class="tabular">40%</span>
          </div>
          <div class="nitro-track">
            <div id="hud-nitro-bar" class="nitro-fill"></div>
          </div>
        </div>
      </div>

      <div id="hud-drift-box" class="dash-drift">
        <div class="drift-top">
          <span id="hud-drift-combo" class="drift-combo-tag tabular">1x</span>
          <span id="hud-drift-score" class="drift-score-num tabular">+0</span>
        </div>
        <div class="drift-angle-sub tabular">DRIFT <span id="hud-drift-angle">0°</span></div>
        <div id="hud-cam">[C] CHASE</div>
      </div>
    </div>

    <!-- Optional Touch Controls -->
    <div id="touch-controls" aria-label="Touch Controls">
      <div class="touch-cluster">
        <button id="tbtn-left" class="touch-btn" type="button">LEFT</button>
        <button id="tbtn-right" class="touch-btn" type="button">RIGHT</button>
      </div>
      <div class="touch-cluster">
        <button id="tbtn-brake" class="touch-btn" type="button">BRAKE</button>
        <button id="tbtn-drift" class="touch-btn drift" type="button">DRIFT</button>
        <button id="tbtn-nitro" class="touch-btn nitro" type="button">NITRO</button>
        <button id="tbtn-gas" class="touch-btn gas" type="button">GAS</button>
      </div>
    </div>

    <div id="countdown-banner" class="tabular" aria-live="polite">3</div>
  </div>

  <!-- Pause Modal -->
  <div id="pause-overlay" class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Race Paused">
    <div class="modal-card pause-card">
      <h2 class="modal-title">Race Paused</h2>
      <p class="modal-sub">Press P or Esc to resume</p>
      <div class="pause-actions">
        <button id="btn-resume" class="btn-primary" type="button">Resume</button>
        <button id="btn-restart-pause" class="btn-secondary" type="button">Restart Race</button>
        <button id="btn-pause-controls" class="btn-secondary" type="button">Controls</button>
        <button id="btn-pause-settings" class="btn-secondary" type="button">Settings</button>
        <button id="btn-menu-pause" class="btn-secondary" type="button">Main Menu</button>
      </div>
    </div>
  </div>

  <!-- Controls Modal -->
  <div id="controls-overlay" class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Controls">
    <div class="modal-card">
      <h2 class="modal-title">Controls</h2>
      <p class="modal-sub">Keyboard & Touch Driving Bindings</p>
      <div class="key-grid">
        <div class="key-item"><span>Accelerate / Brake</span><span class="kbd-badge">W S / ↑ ↓</span></div>
        <div class="key-item"><span>Steer Left / Right</span><span class="kbd-badge">A D / ← →</span></div>
        <div class="key-item"><span>Handbrake Drift</span><span class="kbd-badge">SPACE</span></div>
        <div class="key-item"><span>Nitro Boost</span><span class="kbd-badge">SHIFT</span></div>
        <div class="key-item"><span>Chase / Cockpit Cam</span><span class="kbd-badge">C</span></div>
        <div class="key-item"><span>Toggle Racing Line</span><span class="kbd-badge">L</span></div>
        <div class="key-item"><span>Reset onto Track</span><span class="kbd-badge">R</span></div>
        <div class="key-item"><span>Pause / Mute</span><span class="kbd-badge">P / M</span></div>
      </div>
      <button id="btn-close-controls" class="btn-primary" type="button">Back</button>
    </div>
  </div>

  <!-- Settings Modal -->
  <div id="settings-overlay" class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Settings">
    <div class="modal-card">
      <h2 class="modal-title">Settings</h2>
      <p class="modal-sub">Driving Aids, Camera & Visual Options</p>
      <div class="settings-list">
        <label class="setting-row">
          <div>
            <strong>Dynamic Racing Line</strong>
            <span>Show green / yellow / red braking guide directly on track (Shortcut: L)</span>
          </div>
          <input id="set-racing-line" type="checkbox" checked />
        </label>
        <label class="setting-row">
          <div>
            <strong>Collision Camera Shake</strong>
            <span>Enable subtle impact trauma shake on hard collisions</span>
          </div>
          <input id="set-camera-shake" type="checkbox" checked />
        </label>
        <label class="setting-row">
          <div>
            <strong>Sparks & Nitro Flame FX</strong>
            <span>Display collision sparks, exhaust flames, and boost speed trails</span>
          </div>
          <input id="set-visual-effects" type="checkbox" checked />
        </label>
        <label class="setting-row">
          <div>
            <strong>Engine & Race Audio</strong>
            <span>Synthesized engine pitch, tyre screech, drift chimes, and nitro SFX</span>
          </div>
          <input id="set-audio" type="checkbox" checked />
        </label>
        <div class="setting-row">
          <div>
            <strong>On-Screen Touch Controls</strong>
            <span>Show pedal and steering touch buttons during gameplay</span>
          </div>
          <select id="set-touch-controls">
            <option value="auto">Auto (Touch Devices)</option>
            <option value="on">Always On</option>
            <option value="off">Off</option>
          </select>
        </div>
      </div>
      <button id="btn-close-settings" class="btn-primary" type="button">Save & Back</button>
    </div>
  </div>

  <!-- How to Play Modal -->
  <div id="howto-overlay" class="modal-backdrop" role="dialog" aria-modal="true" aria-label="How to Play">
    <div class="modal-card">
      <h2 class="modal-title">How to Play</h2>
      <p class="modal-sub">Master Apex Circuit in 3 Steps</p>
      <div class="howto-sections">
        <div class="howto-box">
          <h3>Dynamic Racing Line</h3>
          <p>Green zones are full throttle. Yellow signals setup for an upcoming turn. Red shows hard braking zones, backed by 150m, 100m, and 50m trackside boards.</p>
        </div>
        <div class="howto-box">
          <h3>Drift Combos</h3>
          <p>Hold SPACE while turning into a corner to kick out the rear tyres. Maintain angle and speed to build up to a 5x combo, then release cleanly to bank points. Spinning out or slamming barriers breaks your combo.</p>
        </div>
        <div class="howto-box">
          <h3>Nitro Boost</h3>
          <p>Charge Nitro (0–100%) by drifting, hitting clean corners, and overtaking rivals (+22%). Press SHIFT to surge above 300 km/h with exhaust flames. Empty tanks lock until 15% recharged.</p>
        </div>
        <div class="howto-box">
          <h3>The 6 Drivers</h3>
          <p>#00 PLAYER (Cyan) · #07 RAZOR (Aggressive) · #12 BLAZE (Top Speed) · #18 MOSS (Defensive) · #23 NOVA (Cornering) · #31 COMET (Opportunistic).</p>
        </div>
      </div>
      <button id="btn-close-howto" class="btn-primary" type="button">Got It</button>
    </div>
  </div>

  <!-- Finish Results + Top-3 Podium + Confetti Modal -->
  <div id="results-overlay" class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Race Results">
    <canvas id="confetti-canvas"></canvas>
    <div class="modal-card">
      <h2 class="modal-title">Race Complete</h2>
      <p id="results-subtitle" class="modal-sub tabular">3 Laps Complete</p>

      <div id="results-podium" class="podium-grid"></div>
      <div id="results-player-stats" class="stats-grid"></div>
      <div id="results-lap-splits" class="lap-splits-row"></div>

      <table class="results-table">
        <thead>
          <tr>
            <th>Pos</th>
            <th>Driver</th>
            <th>Laps</th>
            <th>Best Lap</th>
            <th>Total Time</th>
          </tr>
        </thead>
        <tbody id="results-tbody"></tbody>
      </table>

      <div class="modal-actions-row">
        <button id="btn-race-again" class="btn-primary" data-start="true" type="button">Restart Race</button>
        <button id="btn-results-menu" class="btn-secondary" type="button">Main Menu</button>
      </div>
    </div>
  </div>

  <script>${bundledJs}</script>
</body>
</html>
`;

const outPath = path.join(rootDir, 'racing.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log(`Built self-contained ${outPath} (${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)} KB)`);
