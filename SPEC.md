# SPEC — Web-Slinger

> This file is the single source of truth for the game. It records every decision
> about how the game looks, feels and is built. A builder (human or AI) given
> **only this file** should be able to produce a game that matches it.
>
> Status markers: **[DECIDED]** settled · **[BUILT-DEFAULT]** chosen while building, works in the game, can still be changed · **[PROPOSED]** suggested, not yet built or confirmed · **[OPEN]** still being discussed

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
- **[BUILT-DEFAULT]** Speed feel: FOV widens with speed (base 85°, +15° between 20 and 60 m/s),
  radial speed lines above ~30 m/s, wind audio. Camera rolls up to 7° on hard lateral
  acceleration (can be turned off).
- **[BUILT-DEFAULT]** Landing feel: the view dips and springs back. Hard landings and wall
  staggers add trauma-based camera shake.
- **[BUILT-DEFAULT]** Comfort settings: FOV slider, motion-effects toggle, camera-roll toggle,
  mouse sensitivity, invert-Y.
- **[BUILT-DEFAULT]** Camera near plane 0.1 m (depth precision for distant rooftops). The
  forearms sit just beyond it, in the lower screen corners, and swing to point at their line's target.

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

## 4. Movement & Web-Swinging — [DECIDED core / BUILT-DEFAULT numbers]

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
- **[BUILT-DEFAULT] Rope solver (important for feel):** a **velocity-level** constraint, not
  position projection. For each taut line, the outward radial velocity is clamped to the
  line's length rate (−reel-in speed, +let-out speed, or 0), plus a small drift correction
  capped at 6 m/s. Because the impulses are central, angular momentum is conserved
  automatically, so reeling a taut line in mid-swing speeds you up with no extra boost.
  *Do not* convert position corrections into velocity: in the first build that turned a
  1 m correction into a 60 m/s jolt.
- **[BUILT-DEFAULT]** At attach, rope length = current distance to the anchor. If you are
  falling, you drop until it goes taut, then swing.
- Release assist: +1.5 m/s along velocity (and +1 m/s up if rising) when the *last* line is released.
- Per-hand **reel in** shortens rope length (pulls you toward the anchor);
  per-hand **let out** lengthens it (drop lower, swing wider).
- Releasing a hand's button detaches that web; momentum carries on.
- **[BUILT-DEFAULT]** numbers (all in `src/config/gameplay.ts`):
  - Max web range: 90 m · web travel speed: 250 m/s
  - Reel-in speed: 12 m/s · let-out speed: 10 m/s · min rope length: 2 m
  - Gravity: 9.81 m/s² × 1.6 (heavier-feeling arcs) · terminal velocity: ~70 m/s
  - Air control (WASD while airborne): 9 m/s² · walk 7 m/s · sprint 13 m/s · jump 9 m/s (sprint jump 11)
  - Player capsule: radius 0.4 m, total height ~1.9 m; eyes 0.7 m above centre
- **Headless check (M1 build):** dropping from 12 m below a bridge beam with 12 m/s forward
  gives a clean pendulum. Rope overshoot ≤ 0.07 m, ~24 m/s at the bottom; reeling a taut
  line raised speed 19.5 → 27.9 m/s.

### 4.3 Wall movement
- **Wall-run:** when moving fast into a wall with Shift held, run along or up it for a
  limited time/distance.
- **Wall-crawl:** stick to any wall and crawl in any direction (WASD relative to wall).
  **[BUILT-DEFAULT]** You stick automatically when you touch a wall in the air, or when
  you walk into a wall on the ground while holding W. Crawl 6 m/s (10 with Shift). Crawling
  up past the top edge mantles you onto the roof. S while touching the ground steps off.
- **[BUILT-DEFAULT] Wall-run details:** on contact with Shift held and speed ≥ 12 m/s, the
  into-wall speed converts to upward speed (×0.8), with 25% gravity, for up to 1.6 s, then crawl.
  An impact faster than 28 m/s without wall-run → 0.45 s stagger (no control, heavy shake).
- **[BUILT-DEFAULT]** A taut line pulls you off a wall when it is reeled in or pulls away
  from the wall. Otherwise lines stay attached while you crawl.
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
| Shift (alone) | Sprint on ground / wall-run | BUILT-DEFAULT |
| F | Web-zip | DECIDED |
| Middle mouse | Web-pull / yank | DECIDED |
| R | Web-ball shot | DECIDED |
| Ctrl **or C** | Crouch, drop off a wall | DECIDED (C alias built: browsers can't block Ctrl+W, which closes the tab) |
| Tab | Reserved (unused in v1) | DECIDED |
| H | Recenter head-tracking | DECIDED |
| Esc | Pause / settings | DECIDED |

- All input goes through an **action map** (raw keys → named actions), so keys can be
  rebound and gamepad support added later without touching gameplay code.
- **[DECIDED]** Gamepad support is **not in v1**; the action map makes it easy to add later.

---

## 7. World & City — [DECIDED: procedural]

- Procedurally generated fictional city from a **seed** (same seed = same city).
- **[BUILT-DEFAULT] Layout** (`src/world/cityGen.ts`, default seed 1337, `?seed=` in the URL):
  - 2 km × 2 km. An irregular grid with blocks 55–105 m and 18 m streets. Diagonal avenues
    are **[PROPOSED]** for later.
  - The river is an east–west band 100 m wide (z 410–510), recessed: bed at −4 m, water
    surface at −0.8 m. Players who fall in swim (4 m/s) and climb out up the embankment walls.
  - Three suspension-style bridges with tall towers, top cross-beams and decorative cables.
    The towers are great swing anchors.
  - Districts by distance from the downtown centre (−150, −180): downtown < 380 m
    (90–300 m towers with setback tiers and antennas); industrial within 160 m of the river
    (9–22 m warehouses, plus orange cranes on the quays); midtown < 700 m (40–120 m); residential
    beyond that (12–35 m, water towers). A park (grass slabs and trees) sits around (180..520, −620..−340).
  - Lots: 1–3 × 1–3 per block, 0–6 m alleys between buildings, about 6% empty lots outside downtown.
  - Spawn: the tallest roof near downtown centre.
- Buildings: varied footprints and heights, rooftop details (water towers, AC units,
  antennas, billboards) that double as web anchors and parkour props.
- Streets: roads, sidewalks, lamp posts, trees.
- **[DECIDED]** Simple ambient **traffic and pedestrians**: cars follow the road graph,
  pedestrians walk sidewalks. Low-detail, cel-shaded, no complex AI in v1.
- **[DECIDED]** **Day/night cycle:** the sun moves across the sky; at night, street lamps
  and lit building windows turn on. **[PROPOSED]** one full cycle = 20 real minutes, with a
  settings option to freeze the time of day.
- **[DECIDED]** Fixed, medium-size city generated at load (no chunk streaming in v1).
  2 km × 2 km (see layout above).

---

## 8. Visual Style & Audio

- **[DECIDED]** Stylized **cel-shaded / comic-book** look: toon shading with stepped
  lighting, bold ink outlines (screen-space edge-detection post-process), flat
  saturated colors.
- **[BUILT-DEFAULT] Rendering recipe:** `MeshToonMaterial` with a 3-step ramp (110/185/255),
  hemisphere light and one sun with shadows. A post pass draws ink where (a) the Laplacian of
  inverse depth is large (silhouettes, creases; zero on flat planes) or (b) neighbouring
  luminance differs (fades out by 140 m). Ink fades with fog distance. Building windows come
  from a tiling mask texture with world-scale UVs (one cell ≈ 3.2–4.8 m × one floor), mixed to
  blue-grey glass with a faint glint. Lines are drawn after the post pass with correct depth
  (the post pass writes scene depth), so they glow without being outlined.
- **[BUILT-DEFAULT]** Speed lines at high velocity (in the post pass).
- **[PROPOSED]** Halftone-dot shading in shadows, comic-style impact effects.
- **[DECIDED]** Hero palette: teal, graphite and orange; lines are glowing cyan (§9).
- **[DECIDED]** City palette, **warm comic city**:
  - Day: sandstone, cream and terracotta buildings; blue-grey glass; light blue sky.
  - Sunset: gold and magenta sky, long purple shadows.
  - Night: deep navy sky, warm yellow lit windows and street lamps; the cyan lines glow
    and stand out the most.
  - Ink outlines: dark brown-black (not pure black).
  - The teal/cyan/orange hero colors must always contrast against the warm city.

### 8.1 Audio — [DECIDED: movement SFX only in v1]
- Line fire (whip-crack launch), attach (metallic clack), miss (fizzle), release (snap).
- Reel motor whir per hand, pitch rising with reel speed; stereo-panned left/right by hand.
- Wind noise rising in volume and pitch with speed.
- Landings scaled by impact (soft tap → heavy thud), footsteps, wall-run steps, wall-jump.
- No music and no city ambience in v1 (could come later).
- **[BUILT-DEFAULT]** Every sound is **synthesized with the Web Audio API** (filtered noise
  bursts and oscillators, `src/audio/sfx.ts`). No audio files, no licensing. Never use
  copyrighted game or film audio.

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

### 12.2 Start flow & menus — [DECIDED: straight into the city]
- Opening the page shows the city with a single overlay: **"Click to play"** (needed for
  pointer lock and audio unlock). Clicking spawns Lineweaver on a downtown rooftop.
- No title screen and no tutorial in v1.
- **Esc → pause screen:** Resume, Controls (full key list from §6), Settings.
- **Settings:** graphics preset, render scale, FOV, mouse sensitivity, invert-Y,
  motion effects / camera roll toggles, head-tracking on/off + recenter, freeze time of day,
  master/SFX volume. Saved in `localStorage`.

---

## 13. Performance Targets — [DECIDED]

- **60 fps at 1080p on a mid-range laptop with integrated graphics** (recent Intel Iris Xe /
  AMD Radeon iGPU class) on the **Medium** preset.
- Graphics presets: **Low / Medium / High**, auto-detected on first launch, changeable in
  settings. Presets scale shadow resolution, draw distance, outline pass resolution,
  traffic/pedestrian density and render resolution scale.
- **[BUILT-DEFAULT]** techniques: buildings merged into one mesh per 250 m region (frustum
  culled); props instanced (lamp posts, tanks, trees, cones); windows are a texture, not
  geometry; one sun shadow map whose frustum follows the player (Low 1024/±90 m,
  Medium 2048/±140 m, High 4096/±200 m); fog-limited draw distance (1000 / 1600 / 2200 m).
  Distance-based LOD is **[PROPOSED]** if needed.

---

## 14. Project Structure & Conventions — [BUILT-DEFAULT]

```
src/
  main.ts            # bootstrap (physics init, city gen, Game)
  core/              # game.ts (fixed-timestep loop, wiring), physics.ts (Rapier wrapper), rng.ts
  input/             # actions.ts (action map + labels), input.ts (per-tick snapshots)
  camera/            # firstPerson.ts (look, FOV, roll, shake); head-tracking goes here in M3
  player/            # state.ts (serialisable state + events), controller.ts (movement modes), arms.ts
  webs/              # lines.ts (per-hand state machine + rope solver), lineVisuals.ts
  world/             # cityGen.ts (pure data), cityWorld.ts (meshes + colliders), boxGeometry.ts, palette.ts
  render/            # materials.ts (toon, windows), pipeline.ts (outline/speed-line post), sky.ts
  audio/             # sfx.ts (Web Audio synthesis)
  ui/                # hud.ts, menu.ts
  modes/             # gameMode.ts (GameMode interface, FreeRoamMode)
  config/            # gameplay.ts (all tunables), settings.ts (presets, persistence)
```
- **Physics model:** Rapier holds static colliders (cuboids, cylinders, balls, cones) and a
  kinematic character controller for the player capsule (slide, autostep 0.5 m, snap to
  ground). Gravity, ropes and movement modes are our own code. Rapier only resolves
  collisions and answers raycasts.
- **Player modes:** `ground | air | wall | wallrun | swim`. Systems emit `GameEvent`s
  (fire, attach, miss, release, land, step, jump, wallJump, wallStick, stagger, splash), which
  drive audio, camera shake and arm recoil. Gameplay never calls audio or rendering directly.
- Debug: `?shot&cam=x,y,z,yawDeg,pitchDeg` hides the start overlay and places the camera
  (used for automated screenshots).

- All tunable gameplay numbers live in `src/config/`, never hard-coded in systems.

---

## 15. Milestones & Definition of Done — [DECIDED]

**The v1 release gate is the core swing feel.** Everything else in this spec is the full
target, built in later milestones. A milestone ships only when the previous one still feels right.

| Milestone | Contents |
|---|---|
| **M1 = v1 (release gate)** | Docker build, click-to-play, procedural city geometry (buildings, streets, rooftops, cel-shaded with outlines, fixed sun), first-person camera + arms, two independent lines with fire/attach/miss/release, per-hand reel in/out, momentum on release, air control, superhero landings, wall-run / crawl / jump, minimal HUD, pause + settings, movement SFX |
| M2 | Abilities: web-zip/launch, dual-line slingshot, pull/yank, web balls |
| M3 | Webcam head-tracking |
| M4 | Living city: day/night cycle, night lighting, traffic and pedestrians |
| Later | Game modes (crime, races, collectibles), gamepad, multiplayer, third-person/photo mode |

**Status (2026-11-22):** M1 is built on branch `m1-core-swing`. It passes type-check, builds, and passes the
headless physics and screenshot checks. It still needs a human playtest against the checks below.

**M1 "swing feel" acceptance checks:**
- From a rooftop you can cross 1 km of downtown without touching the ground, using only
  left/right lines and reeling, after a few minutes of practice.
- Releasing at the bottom of an arc gives a clear speed boost; releasing at the top gives
  height. Chaining lines builds speed up to ~40–60 m/s without feeling uncontrollable.
- Letting a line out mid-swing visibly lowers and widens the arc; reeling in tightens it
  and speeds you up (angular momentum).
- Holding both lines at once behaves physically: you hang between both anchors.
- A miss is always obvious: the line visibly flies out and falls.
- No jitter: ropes and the camera are smooth at 60 fps, with physics on a fixed timestep.
- Landing, wall contact and wall-jumps never get the player stuck in geometry.

## 16. Decision Log

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
| 2026-11-22 | Warm comic city palette (sandstone/cream/terracotta, brown-black ink) | Cyan/teal hero contrasts with it |
| 2026-11-22 | v1 audio = movement SFX only, no music or ambience | |
| 2026-11-22 | Start straight into the city (click to play), no title or tutorial | Fastest path to swinging |
| 2026-11-22 | v1 release gate = core swing feel; abilities, head-tracking, living city are M2–M4 | Nail the feel first |
| 2026-11-22 | M1 built: velocity-level rope solver, attach length = current distance | Position-based projection caused huge speed spikes |
| 2026-11-22 | C added as alias for Ctrl (crouch/drop) | Ctrl+W closes the browser tab and can't be blocked |
| 2026-11-22 | All SFX synthesized in Web Audio | No asset licensing, works offline |
| 2026-11-22 | Recessed river with swimming; suspension bridges as anchors | Gives the waterfront a gameplay purpose |
