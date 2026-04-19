# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start dev server (Vite)
npm run build     # Build to dist/ as a single self-contained HTML file
npm run preview   # Preview production build
```

No test runner is configured.

## Architecture

Single-file React app — all logic lives in `src/App.tsx`. There are no component subdirectories.

**Stack:** React 19 + TypeScript + Three.js + Tailwind CSS v4 + Vite. The build uses `vite-plugin-singlefile` to inline everything into one standalone `index.html` (no external assets).

**Core concept:** A 3D LED cube visualizer. A Three.js scene renders a cube where each of the 6 faces is an independent canvas-based "scene" (video feed, matrix rain, gradient, etc.). Lights (point/spot/LED) are positioned around the cube in 3D space.

**State model:**
- `faces: FaceConfig[]` — 6 cube faces, each with a `SceneType`, UV mapping rect, and per-scene params.
- `lights: LightConfig[]` — dynamic lights with position, color, intensity, and strobe settings.
- All Three.js objects are held in `useRef` (never in React state) to avoid re-render overhead during the animation loop.
- Refs mirror React state (`facesRef`, `lightsRef`, etc.) so the animation loop always reads fresh values without closure staleness.

**Scene rendering:** Each face renders to an offscreen `<canvas>` which becomes a `THREE.CanvasTexture`. The `camera` scene type uses a `THREE.VideoTexture` from `getUserMedia`. The animation loop (`requestAnimationFrame`) updates all canvases each frame based on their `SceneType`.

**Undo/Redo:** History is stored as JSON snapshots of `{ faces, lights, offFaceOpacity }`, debounced 400 ms. Max 50 entries. `Cmd+Z` / `Cmd+Shift+Z` / `Cmd+Y` are wired globally.

**Path alias:** `@/` maps to `src/`.
