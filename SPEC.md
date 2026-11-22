# SPEC — Web-Slinger

> This file is the single source of truth for the game. It records every decision
> about how the game looks, feels and is built. A builder (human or AI) given
> **only this file** should be able to produce a game that matches it.
>
> Status markers: **[DECIDED]** settled · **[PROPOSED]** suggested default, not yet confirmed · **[OPEN]** still being discussed

---

## 0. Vision

A first-person, physics-driven web-swinging game set in a stylized procedural city.
The player feels like they're *inside* the hero's body: they look around freely,
aim each web themselves with each hand separately, and manage rope length by hand.
Mastery comes from rhythm and timing: fire left, reel, release, fire right, wall-jump.

- **[DECIDED]** The hero is an **original character** (own name, suit and city), not
  a copy of any existing franchise, so the game can be shared freely.
- **[DECIDED]** "VR-like without VR": first-person mouse-look, plus optional webcam
  head-tracking layered on top.
- **[DECIDED]** Runs locally from a single Docker command so friends can play it.
- **[DECIDED]** v1 is a **free-roam traversal sandbox**. The code must be structured so
  more gameplay (missions, enemies, races, collectibles, multiplayer) can be added later
  without rewrites (see §10, §14).

---

## 1. Tech Stack — [DECIDED]

| Concern | Choice |
|---|---|
| Language | TypeScript (strict mode) |
| Build / dev server | Vite |
| Rendering | Three.js (WebGL2) |
| Physics | Rapier (`@dimforge/rapier3d-compat`, WASM) |
| Head-tracking | MediaPipe Tasks Vision, Face Landmarker (WASM + model bundled locally, no CDN at runtime) |
| Packaging | Docker (multi-stage: Node build → static web server) |
| Runtime | Player's own browser (Chrome / Edge / Firefox, desktop) |

**Why browser-based:** native 3D games inside Docker need GPU + display passthrough,
which breaks across OSes and drivers. Serving a web build from Docker gives full GPU
acceleration through the browser on Linux, macOS and Windows with zero setup.

---

## 2. Distribution & Running (Docker) — [DECIDED]

- Repo: `github.com/Amit-Sherman/web-slinger` (private; collaborators are invited).
- A friend runs:
  ```bash
  git clone https://github.com/Amit-Sherman/web-slinger.git
  cd web-slinger
  docker compose up --build
  ```
  then opens **http://localhost:8080**.
- `Dockerfile`: stage 1 `node:lts` runs `npm ci && npm run build`; stage 2 serves `dist/`
  with a minimal static server (e.g. `nginx:alpine`) on port 8080. Correct MIME type for `.wasm`.
- All assets (models, textures, audio, MediaPipe model files) live inside the image.
  **The game must work fully offline** once built.
- Webcam access requires a secure context. `localhost` qualifies, so each player runs
  their own container. (Playing via another machine's LAN IP over plain HTTP would
  disable head-tracking; that's acceptable.)
- Dev workflow outside Docker: `npm install && npm run dev`.

---

## 3. Camera & Point of View — [DECIDED]

### 3.1 First-person mouse-look (primary)
- The camera sits at the hero's eyes. Mouse controls yaw/pitch (pointer lock).
- Look direction is **independent of velocity**: you can look behind you mid-swing.
- **[DECIDED]** The hero's forearms/hands and web-shooters are visible in first person,
  animated when firing, holding and reeling webs. Webs visibly leave each wrist.
  No torso/legs are rendered (looking down shows nothing).
- **[PROPOSED]** Speed feel: FOV widens with speed (base 85°, up to ~100°), subtle speed
  lines, wind audio. Optional slight camera roll on hard turns (can be turned off).
- **[PROPOSED]** Comfort settings: FOV slider, motion-effects toggle, camera-roll toggle,
  mouse sensitivity, invert-Y.

### 3.2 Webcam head-tracking (optional, additive)
- **Off by default**; enabled in Settings. The game is fully playable without a webcam.
- Mouse sets the body/aim direction; head pose **adds** an offset on top:
  - Head yaw/pitch → extra look rotation (glance sideways without moving the mouse).
  - Head translation (lean) → small camera position offset for parallax.
- Pose comes from MediaPipe Face Landmarker (facial transformation matrix), smoothed
  (One-Euro filter or similar) to avoid jitter.
- "Recenter" key/button sets the current head pose as neutral.
- **[DECIDED]** Web aim follows the **mouse/body direction only**. With head-tracking on,
  the crosshair is drawn where the aim ray lands, so it drifts on screen when you glance
  with your head. Glance to spot an anchor, then aim at it with the mouse.

---

## 4. Movement & Web-Swinging — [DECIDED core / PROPOSED numbers]

### 4.1 Principles
- **Physics + assist:** real pendulum physics (gravity, momentum, rope tension), tuned
  to feel good, with small assists (e.g. slight momentum preservation at release, soft
  rope stretch) but **no auto-aim**.
- **Manual aim:** a web goes exactly where the crosshair points. It attaches only if a
  raycast hits real geometry (building, bridge, tree, lamp post) within max web range.
  Miss → the web visibly shoots out, falls limp and retracts. No sky-hooks.

### 4.2 Two independent hands
- Left hand and right hand each have their own web, state and rope length.
- Hand web states: `idle → firing (travel time) → attached → released`.
- Each attached web is a **one-sided distance constraint** (a rope: taut when stretched
  to its length, slack when closer). Both webs can be attached at once; both constraints act.
- Per-hand **reel in** shortens rope length (pulls you toward the anchor);
  per-hand **let out** lengthens it (drop lower, swing wider).
- Releasing a hand's button detaches that web; momentum carries on.
- **[PROPOSED]** numbers (tunable in a config file):
  - Max web range: 90 m · web travel speed: 250 m/s
  - Reel-in speed: 12 m/s · let-out speed: 10 m/s · min rope length: 2 m
  - Gravity: 9.81 m/s² × 1.6 (heavier-feeling arcs) · terminal velocity: ~70 m/s
  - Air control (WASD while airborne): small steering force

### 4.3 Wall movement
- **Wall-run:** when moving fast into a wall with Shift held, run along or up it for a
  limited time/distance.
- **Wall-crawl:** stick to any wall and crawl in any direction (WASD relative to wall).
- **Wall-jump:** Space while on a wall launches you away from it (plus a bit up/forward),
  so you can chain wall-to-wall or wall-to-web.
- Landing on the ground or rooftops: run, sprint and jump normally.

### 4.4 Falling / damage — [DECIDED: superhero landing]
- No fall damage and no health in v1.
- Hard landings play a heavy impact: camera shake, short crouch/roll, brief slowdown,
  scaled by impact speed. Soft landings flow straight into running.
- Hitting a wall at high speed (without wall-run) causes a short stagger and kills
  most of your momentum.

---

## 5. Web Abilities — [DECIDED]

1. **Swing (per hand):** fire/hold/release with LMB (left) or RMB (right). Reel per hand (§6).
2. **Web-zip / point launch:** shoot a web to the targeted point, zip straight to it fast,
   and launch off it with a boost when you reach it (if you press jump on arrival).
3. **Dual-web slingshot:** attach both webs to points ahead, let both out / pull back,
   then release to be catapulted forward. Launch power scales with the stretch.
4. **Web-pull / yank:** web an object and yank it toward you; or, on heavy/fixed objects,
   yank yourself to it.
5. **Web-shooter combat:** fire web balls that stick to surfaces and objects (and future
   enemies, to trap them). Web up an object and throw it.

---

## 6. Controls — Keyboard + Mouse

| Input | Action | Status |
|---|---|---|
| Mouse | Look | DECIDED |
| LMB (hold) | Fire & hold **left** web; release to detach | DECIDED |
| RMB (hold) | Fire & hold **right** web; release to detach | DECIDED |
| Q | Reel **left** web in | DECIDED |
| Shift + Q | Let **left** web out | DECIDED |
| E | Reel **right** web in | DECIDED |
| Shift + E | Let **right** web out | DECIDED |
| W A S D | Move / air-steer / crawl on walls | DECIDED |
| Space | Jump / wall-jump / launch at end of zip | DECIDED |
| Shift (alone) | Sprint on ground / wall-run | PROPOSED |
| F | Web-zip | DECIDED |
| Middle mouse | Web-pull / yank | DECIDED |
| R | Web-ball shot | DECIDED |
| Ctrl | Crouch, drop off a wall | DECIDED |
| Tab | Reserved (unused in v1) | DECIDED |
| H | Recenter head-tracking | DECIDED |
| Esc | Pause / settings | DECIDED |

- All input goes through an **action map** (raw keys → named actions), so keys can be
  rebound and gamepad support added later without touching gameplay code.
- **[DECIDED]** Gamepad support is **not in v1**; the action map makes it easy to add later.

---

## 7. World & City — [DECIDED: procedural]

- Procedurally generated fictional city from a **seed** (same seed = same city).
- **[PROPOSED]** Layout: a grid-ish street network with some diagonal avenues; districts
  with distinct height profiles (a downtown of tall skyscrapers, midtown, low-rise
  residential, an industrial waterfront), a large park, and a river crossed by bridges.
- Buildings: varied footprints and heights, rooftop details (water towers, AC units,
  antennas, billboards) that double as web anchors and parkour props.
- Streets: roads, sidewalks, lamp posts, trees.
- **[DECIDED]** Simple ambient **traffic and pedestrians**: cars follow the road graph,
  pedestrians walk sidewalks. Low-detail, cel-shaded, no complex AI in v1.
- **[DECIDED]** **Day/night cycle:** the sun moves across the sky; at night, street lamps
  and lit building windows turn on. **[PROPOSED]** one full cycle = 20 real minutes, with a
  settings option to freeze the time of day.
- **[DECIDED]** Fixed, medium-size city generated at load (no chunk streaming in v1).
  **[PROPOSED]** about 2 km × 2 km.

---

## 8. Visual Style & Audio

- **[DECIDED]** Stylized **cel-shaded / comic-book** look: toon shading with stepped
  lighting, bold ink outlines (screen-space edge-detection post-process), flat
  saturated colors.
- **[PROPOSED]** Halftone-dot shading in shadows, speed lines at high velocity,
  comic-style impact effects.
- **[DECIDED]** Hero palette: teal, graphite and orange; lines are glowing cyan (§9).
- Audio, music, city color palette: **[OPEN]**.

---

## 9. Character — [DECIDED: Lineweaver]

- **Name:** Lineweaver. An original hero, not based on any existing franchise.
- **Vibe:** a precise, self-made inventor who built their own gear. Technical and
  controlled, not mystical.
- **Fiction:** the "webs" are **carbon-fiber cables** fired from wrist-mounted
  launchers. In-world they're called *lines*; code and this spec may still say "web".
- **Suit:** fitted suit of teal and graphite panels with orange accents at the joints and seams.
- **Head:** smooth, featureless helmet with a single horizontal visor strip that glows faintly.
- **Wrists (visible in first person):** chunky cable reels with spools that visibly spin
  while reeling in or letting out. Each reel has a small light showing its state
  (dim = idle, cyan = attached, orange = firing/missed).
- **Lines:** thin, glowing **cyan** cables. They snap taut with a slight vibration when
  tension spikes and go slack (sagging curve) when shorter than their length.
- **HUD fiction:** the on-screen HUD *is* the helmet visor display (§12).
- Third-person model: not needed in v1 (first-person only). Needed later for
  multiplayer and photo mode.

---

## 10. Gameplay Loop

- **[DECIDED] v1:** free roam. Spawn on a rooftop, swing anywhere, no fail state beyond §4.4.
- **[DECIDED] Extensibility:** gameplay is organised as pluggable **game modes / activities**
  (e.g. `FreeRoamMode`) that use the core systems (player, webs, world) without
  modifying them. Future candidates: street crime & enemies, races & challenges,
  collectibles, missions.

---

## 11. Multiplayer — [DECIDED: single-player, MP-ready]

- v1 is single-player.
- Code is structured so a shared-city mode can be added later:
  - Simulation runs on a **fixed timestep** (60 Hz) separate from rendering.
  - Player state (position, velocity, web states per hand) is plain serialisable data.
  - Input is captured as per-tick action snapshots (could be sent over the network later).
  - The city is fully reproducible from its seed.

---

## 12. UI / HUD / Menus

### 12.1 HUD — [DECIDED: minimal, visor-styled]
- Styled as Lineweaver's **visor display**: thin cyan lines, slight glow, faint scanline
  texture, monospace numbers.
- **Crosshair:** hollow ring when the aim ray hits nothing in range; **solid** when it hits
  an attachable surface within max range. Small distance readout next to it (optional).
- **Two rope gauges** (bottom left = left hand, bottom right = right hand): state
  (idle / firing / attached) and current line length in metres.
- Nothing else on screen by default. A settings toggle can show extra info (speed, altitude).

### 12.2 Menus — [OPEN]

---

## 13. Performance Targets — [DECIDED]

- **60 fps at 1080p on a mid-range laptop with integrated graphics** (recent Intel Iris Xe /
  AMD Radeon iGPU class) on the **Medium** preset.
- Graphics presets: **Low / Medium / High**, auto-detected on first launch, changeable in
  settings. Presets scale shadow resolution, draw distance, outline pass resolution,
  traffic/pedestrian density and render resolution scale.
- **[PROPOSED]** techniques: instanced meshes for repeated props and windows, merged
  building geometry per city block, frustum culling, distance-based LOD, a single
  shadow-casting sun with cascaded or tight-fitted shadow maps.

---

## 14. Project Structure & Conventions — [PROPOSED]

```
src/
  main.ts            # bootstrap
  core/              # game loop (fixed timestep), events, config
  input/             # action map, keyboard/mouse, (future) gamepad
  camera/            # first-person camera, head-tracking integration
  headtracking/      # MediaPipe wrapper, filtering, calibration
  player/            # character controller, wall movement
  webs/              # per-hand web state machine, rope constraints, abilities
  world/             # procedural city generation, chunks, props
  render/            # toon materials, outline/halftone post-processing
  audio/
  ui/                # HUD, menus, settings
  modes/             # game modes (FreeRoamMode, future modes)
  config/            # tunable gameplay numbers (one place)
```

- All tunable gameplay numbers live in `src/config/`, never hard-coded in systems.

---

## 15. Decision Log

| Date | Decision | Reason |
|------|----------|--------|
| 2026-11-22 | SPEC.md is the source of truth | Lets any builder recreate the game from one file |
| 2026-11-22 | Original hero, not an existing franchise | Shareable without IP issues |
| 2026-11-22 | Three.js + Rapier + TS + Vite, served from Docker | Docker-native GPU games are fragile; browser gets full GPU on any OS |
| 2026-11-22 | Private GitHub repo `web-slinger` | Friends get invited as collaborators |
| 2026-11-22 | First-person mouse-look + optional additive webcam head-tracking | "VR feel" without VR hardware; playable without webcam |
| 2026-11-22 | Physics + assist swinging, manual aim, no sky-hooks | Realism and skill, without frustration |
| 2026-11-22 | Independent left/right webs with per-hand reel in/out | Core identity of the game |
| 2026-11-22 | Reel: Q/E in, Shift+Q/E out | Keeps fingers on WASD |
| 2026-11-22 | Abilities: zip/launch, dual-web slingshot, pull/yank, web-ball combat | |
| 2026-11-22 | Movement: wall-run, wall-crawl, wall-jump | |
| 2026-11-22 | Procedural seeded city | Original, no asset dependency, reproducible |
| 2026-11-22 | Cel-shaded comic-book style | Fits procedural geometry, cheap to render |
| 2026-11-22 | v1 = free roam; modular game modes for later | Ship the swinging feel first |
| 2026-11-22 | Single-player v1, multiplayer-ready architecture | |
| 2026-11-22 | Superhero landing, no fall damage | Keeps flow; no frustration |
| 2026-11-22 | Web aim = mouse only; head-tracking is look-only | Precision aiming stays on the mouse |
| 2026-11-22 | First-person arms + web-shooters visible, no full body | Immersion without full-body IK complexity |
| 2026-11-22 | v1 world: day/night cycle, ambient traffic & pedestrians, fixed medium city | |
| 2026-11-22 | Gamepad deferred past v1 | |
| 2026-11-22 | Hero = Lineweaver: tech inventor, teal/graphite/orange suit, glowing cyan cable lines | Original, and the visor justifies the HUD |
| 2026-11-22 | Ability keys: F zip, MMB pull, R web ball, Ctrl crouch/drop, H recenter, Esc pause | |
| 2026-11-22 | Minimal visor-styled HUD: crosshair + two rope gauges | Keeps the first-person view clean |
| 2026-11-22 | Target 60 fps @1080p on integrated-GPU laptops, Low/Med/High presets | Friends' laptops must run it |
