# Apex Horizon

Apex Horizon is a stylish arcade-style 3D racing experience built with React, Vite, and Three.js. It blends cinematic track racing with combat-style gameplay, nitro boosts, drift scoring, rival pressure, and a sleek HUD inspired by modern racing simulators and arcade action games.

The project is designed to feel fast, polished, and easy to explore while still being a strong foundation for further expansion.

## Why this project stands out

- Real-time 3D driving on a stylized racing circuit
- Multiple track themes with different atmosphere and color grading
- Nitro boost, drift detection, slipstream awareness, and lap timing
- Combat mechanics including machine guns, missiles, health, respawn logic, and kill feed
- Dynamic camera modes and minimap navigation
- Responsive desktop and touch-friendly controls
- Modern front-end setup with Vite and React

---

## Live experience

This project runs directly in the browser and is built to feel like a prototype arcade racer or a showcase game experience. You can tune the car, switch camera angles, race across different tracks, and interact with the HUD while the game state updates in real time.

---

## Key features

### Racing gameplay

- Race across different tracks such as canyon, alpine, and midnight environments
- Track lap progression, sector timing, and best lap tracking
- Boost meter, speedometer, gear indicator, RPM, and lap telemetry
- Drift and slipstream scoring for skill-based performance

### Combat and challenge systems

- Rival cars with AI and health bars
- Weapon systems including machine gun and missile attacks
- Damage, elimination, respawn timers, and on-screen combat feed
- Permanent elimination toggle and difficulty settings for custom play styles

### Visual polish

- 3D environment with lighting, fog, bloom, and stylized post-processing
- Cinematic camera transitions between chase, hood, and aerial views
- Procedural effects for dust, particles, vehicle hit flashes, and sparks
- Crisp HUD panels and minimap overlays for readable game state

---

## Tech stack

- React 19
- TypeScript
- Vite
- Three.js
- React + Lucide icons
- Custom game logic and procedural visuals

---

## Project structure

```bash
Apex-Horizon/
├── public/
│   └── assets/
│       └── aistudio/
├── src/
│   ├── App.tsx
│   ├── index.css
│   ├── main.tsx
│   ├── audio/
│   │   └── soundEngine.ts
│   ├── components/
│   │   ├── RacingCanvas.tsx
│   │   └── TrackMinimap.tsx
│   ├── three/
│   │   ├── carBuilder.ts
│   │   ├── proceduralTextures.ts
│   │   └── trackBuilder.ts
│   ├── types/
│   │   └── racing.ts
│   └── ...
├── index.html
├── metadata.json
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Start the development server

```bash
npm run dev
```

This launches the project on port 3000 in the browser.

### 3. Build for production

```bash
npm run build
```

### 4. Preview production build

```bash
npm run preview
```

### 5. Type-check the project

```bash
npm run lint
```

---

## Controls

### Keyboard

- W / Arrow Up: accelerate
- S / Arrow Down: brake / reverse
- A / D or Arrow Left / Right: steer
- Shift: nitro boost
- Space: machine gun / attack
- E: missile fire
- C: change camera mode
- M: toggle minimap or relevant UI state
- P: pause
- R: reset race

### Interaction notes

- Camera mode can be switched during the race to adapt the view
- Track and car settings can be adjusted through the game HUD
- Audio is available through the sound controls in the interface

---

## Gameplay loop

1. Pick a car livery and track theme.
2. Start the race countdown.
3. Drive through the circuit while managing speed, drift, and boost.
4. Survive rival pressure and use offensive tools when combat is enabled.
5. Complete the lap count and aim for the best finishing position.

---

## Future ideas

This repository is already a strong play prototype, and it can be extended with:

- leaderboard and lap persistence
- more maps and track variations
- better AI overtaking logic
- sound-driven event feedback
- mobile touch controls refinement
- online multiplayer or local split-screen mode
- polished menu and garage systems

---

## Notes

This project is built as an interactive front-end game demo and is ideal for learning, prototyping, and visual experimentation with 3D game mechanics in the browser.

If you want, this project can also be expanded into a full racing game experience with a dedicated menu, garage, unlockables, and polished game progression.

---

## Quick summary

Apex Horizon is a fast, futuristic browser racing game prototype that mixes arcade driving, tactical combat, and cinematic visuals into a single polished React + Three.js experience.
