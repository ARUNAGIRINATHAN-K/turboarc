# Turbovex 2.0

A self contained 3D arcade racing game focused on accessible driving, competitive AI, and responsive race feedback.

## Features

- Six uniquely identified cars and a three-lap race.
- Racing-line guidance, drifting, scoring combos, and nitro boosts.
- Race HUD with position, timing, speed, boost, and minimap.
- Chase and cockpit cameras, pause menu, and race results.
- Demo mode and deterministic seeded races.
- Synchronous benchmark API: `window.bench.race(seed, seconds)`.

## Controls

- **Arrow keys / WASD:** Drive and steer
- **Space:** Handbrake drift
- **Shift:** Activate nitro
- **R:** Reset car
- **C:** Switch camera
- **Esc:** Pause

## Run

Open `racing.html` in a browser. Add `?demo=1` for demo mode or `?seed=N` for a reproducible race.