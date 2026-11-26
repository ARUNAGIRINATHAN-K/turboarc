# 🏁 TURBOARC

*One car. Five rivals. Three laps. Zero install.*

A 3D arcade racer that runs in your browser. Drift through the hairpins, outbrake the AI, and beat your best lap.

## ▶️ Play

Open `racing.html` in any modern browser. That's it. No install, no build step.

## 🎮 Controls

| Key | Action |
|---|---|
| ↑ ↓ ← → or W A S D | Accelerate, brake, steer |
| Space | Handbrake (hold it through a corner to drift) |
| R | Reset onto the track |
| C | Switch chase / cockpit camera |

## 🏆 The Race

Three laps, six cars: you against five AI rivals who brake for corners, overtake, and sometimes make mistakes. Watch your position, lap times, and the minimap.

## 🤖 Demo Mode

Add `?demo=1` to the URL and watch an autopilot take the race. It restarts itself after the results.

Add `?seed=42` (any number) to get the same race every time.

## 🧪 Bench (for testing)

```js
window.bench.race(42, 120)
// → { laps, order, barrierHits, stuck }
```

Runs a full race headless and returns the results instantly.