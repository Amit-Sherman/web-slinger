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
- **Manual aim, ballistic web, no range limit (see §5.1):** the web is a physical stream
  that drops under gravity like a bullet. It attaches only where its flying tip actually
  hits real geometry (building, bridge, tree, lamp post, even the street). No sky-hooks and
  no auto-aim. An HUD marker shows where a stream fired now would land.

### 4.2 Two independent hands
- Left hand and right hand each have their own web, state and rope length.
- Hand web states: `idle → firing (stream in flight) → attached → idle` (release at any point).
- Each attached web is a **one-sided distance constraint** (a rope: taut when stretched
  to its length, slack when closer). Both webs can be attached at once; both constraints act.
- **[DECIDED] Elastic lines:** lines are not rigid ropes. They **stretch and pull back**
  under load like a real spider-silk strand. Each attached line is a **one-sided
  spring-damper** acting on velocity. It pulls only when stretched past its rest length and
  never pushes:
  - pull (m/s²) = `elasticity × strain + 2·ζ·√k × radialSpeed`, where `strain = (d − L)/L`,
    `k = elasticity / L`, `elasticity = 300`, `ζ (dampingRatio) = 0.3`. Pull is never negative.
    (Softened from 450 / 0.35 after playtest: "a bit more elastic".)
  - Because stiffness scales with 1/L, a given load gives the same *percentage* stretch on
    long and short lines: about 5% hanging still, about 8% mid-swing, and up to about 16%
    when a line catches a fall (then a soft bounce settles).
  - Hard stop at +50% stretch (velocity-level, correction capped at 6 m/s).
  - Reel in / let out change the rest length L. The spring makes reeling feel slightly
    elastic and lagging. Forces are central, so angular momentum is conserved and reeling a
    loaded line still speeds you up.
  - *Do not* convert position corrections into velocity: in the first build that turned a
    1 m correction into a 60 m/s jolt.
  - Visuals: a stretched line gets **thinner** (down to 45% width at about 18% strain), and it
    **twangs** (vibrates) when its pull jumps suddenly, not under steady load.
- **[BUILT-DEFAULT]** At attach, rope length = current distance to the anchor. If you are
  falling, you drop until it goes taut, then swing.
- Release assist: +1.5 m/s along velocity (and +1 m/s up if rising) when the *last* line is released.
- Per-hand **reel in** shortens rope length (pulls you toward the anchor);
  per-hand **let out** lengthens it (drop lower, swing wider).
- Releasing a hand's button detaches that web; momentum carries on.
- **[BUILT-DEFAULT]** numbers (all in `src/config/gameplay.ts`):
  - Web range: unlimited (rope length cap 5 km, larger than the city) · stream launch speed 150 m/s, see §5.1
  - Reel-in speed: 13.2 m/s · let-out speed: 11 m/s (+10% after first playtest) · min rope length: 2 m
  - Gravity: 9.81 m/s² × 1.6 (heavier-feeling arcs) · terminal velocity: ~70 m/s
  - Air control (WASD while airborne): 9 m/s² · walk 7 m/s · sprint 13 m/s · jump 9 m/s (sprint jump 11)
  - **[DECIDED] No free speed:** running and air control can never *create* speed.
    - Ground: above run speed you keep momentum (from swings or falls), but it only bleeds
      off at 10 m/s². Input steers the direction without adding magnitude.
    - Air: control steers, but horizontal speed after control may not exceed
      max(speed before, 13 m/s). This blocks both holding W and air-strafing.
    - The only ways to go faster are gravity, swings, reeling and wall-jumps.
    - (Bug found in playtest: you could run up to unlimited speed on the ground.)
  - Player capsule: radius 0.4 m, total height ~1.9 m; eyes 0.7 m above centre
- **Headless check (elastic lines):** dropping from 12 m below a bridge beam with 12 m/s
  forward: the line catches with a 16% peak stretch, then swings smoothly at ~22 m/s through
  the bottom; reeling a loaded line raised speed 19.5 → 22.8 m/s in 0.5 s.

### 4.3 Wall movement
- **Wall-run:** when moving fast into a wall with Shift held, run along or up it for a
  limited time/distance.
- **Wall-crawl:** stick to any wall and crawl in any direction (WASD relative to wall).
- **[DECIDED] Grab vs. slide:** only *deliberate* wall contacts stick. This was changed after
  playtest, because accidental hits mid-swing used to stop you dead.
  - **While any line is attached** (swing lines, or a reeling pull line), walls never grab you.
    You **scrape along the facade**: the into-wall part of your velocity is removed, the
    along-wall part is kept with light friction (0.4/s), the line keeps swinging you, and a scrape
    sound plays.
  - **With no line attached**, you stick only if one of these is true:
    - the approach is **head-on**: the into-wall share of your velocity is ≥ 0.6, i.e. within
      ~53° of perpendicular;
    - you **hold W into the wall**;
    - you're almost still (< 0.5 m/s);
    - you **hold Shift at ≥ 12 m/s** (a deliberate wall-run).
    Glancing contacts slide.
  - On the ground, walking into a wall while holding W still starts a climb.
  - **Props:** walking into a light prop (< 200 kg) **pushes** it, with at most 600 N (a strong
    person), instead of climbing it. Heavy props (cars, AC units) are climbable like walls, and
    their friction (~10 kN for a car) means you can't push them. Measured: a trash can was pushed
    ~2.9 m in 2 s; a car didn't move and the player climbed over it.
  - Head-on slams faster than 28 m/s with no line still **stagger** (unchanged).
  - Headless checks: swinging glancing → slides at 22 m/s; swinging head-on → slides; no line
    glancing → slides; head-on → grabs; 35 m/s head-on → stagger; glancing + W → grabs;
    glancing + Shift → wall-run at ~20 m/s; swinging + Shift → still slides. Crawl 6 m/s (10 with Shift). Crawling
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
   Firing is a continuous web stream (§5.1).
2. **Web balls (R), §5.2:** sticky projectiles. They knock and glue props and leave splats that catch lines.
3. **Pull line (middle mouse), §5.3:** yank light objects into your hands and throw them, or
   yank yourself to heavy/fixed things.
4. **Swinging on props:** swing lines also stick to movable props, with real two-body forces (§5.3).

- **[DECIDED] Dropped:** *web-zip / point launch* (F is unbound). *Dual-web slingshot* is not a
  separate ability: it emerges from the elastic lines and the existing controls (attach both lines
  ahead, let out or pull back, release).

### 5.1 Web stream — [DECIDED, built]
- **Hold LMB / RMB = a continuous stream of web** pours from that hand's launcher nozzle for as
  long as the button is held. There is **no range limit**.
- The stream is physical. Its **tip flies ballistically**: launch velocity = aim × 150 m/s +
  50% of the player's velocity, then **gravity (9.81 m/s², normal gravity, because web is light)**
  pulls it down like a bullet. Real drop at range: ~0.3 m at 35 m, ~2.5 m at 100 m, ~73 m at 580 m.
  (Launch speed raised from 110 to 150 m/s after playtest: "webs should come out faster".)
  - Gameplay tip: integrated each 60 Hz tick (semi-implicit Euler), with a raycast swept along
    each step. The first hit = the anchor. Rope rest length = the distance from the player to
    the anchor at that moment.
  - After 30 s of flight the tip stops testing for hits (the stream keeps flowing visually).
  - Visual stream: every frame a particle is emitted at the nozzle with the *current* aim, and
    all particles fall under the same gravity. Moving your aim while streaming bends the
    stream like a garden hose. The far end is drawn at the gameplay tip. Particles are capped
    at 160 by thinning the oldest half.
  - On attach, the curved stream blends into the straight elastic line over 0.15 s.
  - **Readability (the stream lives only ~0.2 s at short range, because the user prefers a fast web):**
    - a **muzzle flash** at the nozzle when firing starts (0.14 s);
    - a **glowing tip glob** at the stream's head, constant on-screen size, so it reads at any distance;
    - the stream is **brighter and ~35% thicker** than an attached line, and its core is
      **dashed with pulses flowing outward** at 45 m/s;
    - a **catch splat** (expanding glow that fades over 0.5 s) where the stream attaches.
  - **Rendering pitfall (bug found in playtest):** three.js `Line2`/`LineGeometry` locks its
    drawable segment count the first time it renders. A line that grows by calling
    `setPositions()` with longer arrays is silently truncated, which made the stream invisible
    (only a stub at the hand). Every strip is allocated once at a fixed capacity (168 points)
    and updated in place, drawing only `instanceCount = points − 1` segments.
- **Release = disconnect.** The strand separates from the hand and **lingers in the world for
  2.5 s**, simulated as a 24-point position-based strand with explicit velocities (correct
  for any frame time), under gravity. It rests on the street rather than sinking through, and it
  keeps the momentum it had (a stream released mid-flight keeps flying forward as it falls). If it was attached it **keeps hanging from its anchor**; if it was
  still in flight it falls freely. It fades over the last 0.7 s and is removed.
  **At most 8 strands** exist at once (the oldest is recycled), so the load never grows.
- **HUD:** an orange diamond marks the predicted impact point (4 s look-ahead, using the same
  ballistics); the crosshair is solid when a hit is predicted, and the distance readout is to that
  point. The gauge reads `STREAM <distance>` while firing.
- **Audio:** a continuous hiss per hand (stereo-panned) while streaming.
- All numbers live in `LINES` in `src/config/gameplay.ts`.

### 5.2 Web balls — [DECIDED, built] (key R, hold for auto-fire)
- Sticky projectiles at 90 m/s along the aim (+50% of player velocity), same web gravity as the
  stream (they drop). One every 0.18 s while R is held; the hands alternate (wrist flick).
  At most 24 in flight; they expire after 4 s.
- **On hit:**
  - **Splat decal:** a white/cyan web-pattern disc (0.9 m radius) on the surface. It lasts
    30 s and fades over the last 4 s. At most 40 exist (the oldest is recycled). A splat on a
    prop moves with the prop.
  - **Knock:** a movable prop gets a 120 N·s impulse along the ball's direction. That sends a
    15 kg trash can flying at ~8 m/s, and a car barely moves.
  - **Glue:** the prop becomes *sticky*. Once it slows below 0.6 m/s (or after 3 s) it is glued:
    it becomes a fixed body for 20 s, then is released (dynamic again). Another ball refreshes
    the glue.
  - **Splat = anchor:** a web stream (swing or pull line, including the HUD prediction) whose
    path passes within 2.2 m of a splat **snaps onto the splat**. This makes splats reliable
    anchors you place yourself.
- Numbers: `WEB_BALLS` in `src/config/gameplay.ts`.

### 5.3 Pull line & two-body lines — [DECIDED, built] (middle mouse, hold)
- A third web stream (same ballistic stream as §5.1), drawn from the right launcher; the right arm
  animates it whenever the right swing line is idle.
- On attach it **reels in fast** (30 m/s) as a stiff elastic line (elasticity 900, ζ 0.6).
- **Two-body physics (also used by swing lines stuck to props):** a line's pull on the player is
  F = m_player · a (m_player = 80 kg). The prop receives the equal and opposite impulse at the
  anchor point, so the lighter side moves more:
  - **Light prop** (≤ 250 kg, not glued): it flies to you. Within 2.4 m of your eyes it is
    **caught and held**, floating at a camera-local point (0.85 m right, 0.6 m down, 2.6 m
    ahead), driven by velocity with gravity off. HUD: `HOLDING · release middle mouse to throw`.
    **Releasing middle mouse throws it** along the aim at 32·√(30 kg / mass) m/s
    (clamped to 10–45), plus your velocity and a random tumble.
  - **Heavy prop** (a car, 1200 kg) or **glued prop / static city geometry:** you get yanked
    towards it. Measured headlessly, pulling a car moved the player 17 m and the car 0.5 m.
  - Releasing middle mouse without holding anything detaches the line (it lingers like any strand).
- **Swinging from a prop:** a swing line attached to a trash can drags the can (measured: 19.7 m)
  instead of holding you up. A line on a car is nearly as solid as a wall. Body-anchored lines
  follow the prop as it moves.
- A taut or reeling pull line pulls you off walls, like swing lines.
- Numbers: `PULL` and `PROPS` in `src/config/gameplay.ts`.

### 5.4 Web tethers — [DECIDED, built] (key F)
Web two things together. Once joined you **can't control the strand: it just holds**.
- **F** → a web stream (left launcher, same ballistic stream as §5.1) flies to **end A**: anything
  (prop, wall, pole, street, a splat). A slack strand then runs from your left hand to A, and the HUD
  shows `TETHER · F: 2nd end · Shift+F: tie to you`.
- **F again** → a second stream flies to **end B**; A and B are joined by one strand. While B flies,
  A's strand stays drawn from your hand.
- **Shift+F** (while A waits) → **ties A to yourself**. This acts like a swing line you can't reel or
  release. HUD: `TIED · F to cut`. **F** cuts your own tether (so you can never be trapped).
  Only one self-tether at a time.
- An end A that waits 20 s without a second end drops (falling strand).
- **Physics:** rest length = the distance between the ends at the moment they join ("just holds",
  no contraction). Beyond that it's an elastic spring-damper: pull = 80 kg × (600 × strain) plus
  damping (ζ 0.5), applied equal and opposite to prop ends (two-body; static ends don't move).
  Stiffness is capped at 0.25·m_light/dt² for numerical stability with very light props.
  Measured: a trash can tethered to a wall and kicked at ~27 m/s stopped at 25.2 m on a 24.3 m
  tether (it would have flown ~50 m).
- **Static ↔ static strands are solid:** a thin capsule collider (r 0.15 m) along the strand. You
  can **stand and walk on it** (a tightrope between buildings) and anchor lines to it.
- **Ends allowed:** prop ↔ static, prop ↔ prop, static ↔ static, you ↔ anything.
- **Lifetime:** tethers never break; **max 10**, and the oldest is removed (fades out over 0.6 s,
  its collider is removed).
- Strands sag when slack and thin when stretched, like all lines. Sounds: fire, end stuck,
  connect (a taut twang), cut.
- Numbers: `TETHER` in `src/config/gameplay.ts`.

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
| F | Tether: 1st end, then 2nd end (web two things together) · F while tied cuts your tether | DECIDED |
| Shift + F | Tie the waiting 1st end to yourself | DECIDED |
| Middle mouse (hold) | Pull line: catch & hold light objects, release to throw; yank yourself to heavy/fixed things | DECIDED |
| R (hold) | Web balls (auto-fire, hands alternate) | DECIDED |
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

### 7.1 Movable props — [DECIDED, built]
- Every prop is a Rapier **dynamic body**, drawn with instanced meshes (one per kind & part).
  They start **asleep** and wake when touched, hit, webbed or pushed by the player (the player is
  a kinematic body whose character controller pushes props with an 80 kg character mass).
- Placement uses a **separate RNG stream** (`seed ^ 0x5bd1e995`), so adding props never changes
  the city layout for a seed.

| Kind | Where | Collider · mass |
|---|---|---|
| Trash can | sidewalks, 0.9 m inside the curb, every 30–50 m (40% of slots) | cylinder r0.32 h0.96 · 15 kg |
| Newspaper box | sidewalks (22% of slots), facing the street | box 0.52×1.1×0.48 · 25 kg |
| Bench | sidewalks (23% of slots), parks every 25–40 m | box 1.8×0.84×0.6 · 40 kg |
| Traffic cone | 15% of blocks: 3 cones near one corner, in the street | cone r0.2 h0.72 · 3 kg |
| Parked car | curb lane (2.4 m into the street), parallel, within 900 m of downtown, 7% of 7 m slots | box 1.9×1.44×4.4 · 1200 kg |
| Crate / barrel | 30% of roofs: 1–3 each | box 1 m · 30 kg / cylinder r0.35 h1.1 · 50 kg |
| AC unit | roofs (the former static AC boxes) | box ~1.5–3 m · 45 kg/m³ |

- Seed 1337 → ~5,600 props (1,750 AC, 1,160 trash, 780 benches, 640 newsboxes, 550 cars, …).
- **Performance rule:** attaching a collider wakes a body, and Rapier wakes bodies again on
  the first step. So props spawn 1 cm above their support, `sleep()` right after creation, and
  `sleepAll()` + one more step after the world is built. Without this, ~5,000 props simulate for
  seconds at start (24 ms/step). Steady state with all asleep: ~3.8 ms/step headless (vs ~2 ms
  with no props). Distance-based enabling was measured (3.3 ms) and judged not worth it.
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
- **Hands & launchers (visible in first person) [DECIDED, refined after playtest]:** natural
  gloved hands, not blocky props.
  - Tapered teal forearm sleeve with a graphite outer panel and an orange cuff seam.
  - Graphite gloves: a rounded palm with a teal stripe on the back, four fingers with three
    jointed segments each, and a two-segment thumb.
  - A **slim watch-style launcher** on top of each wrist: dark band, small body, an orange
    bezel ring that **spins while reeling** (with a notch so the spin reads), a round face
    light (dim = idle, cyan = attached, orange = streaming), and a short orange nozzle.
    **Lines leave from the nozzle.**
  - Poses: relaxed half-curl at rest, with the hands visible in the lower corners. On fire
    the hand opens and the wrist flicks up. While holding a line it makes a fist and the
    forearm rolls thumb-up (~65°) as if gripping a rope, and the arm aims at the anchor.
    These hands and poses are Lineweaver's own, not a copy of any franchise's gestures.
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
- **Crosshair:** shows the aim direction. It's a hollow ring when no hit is predicted, and
  **solid** when a stream fired now would hit something within 4 s of flight.
- **Impact marker:** a small orange diamond at the predicted landing point (it sits below the
  crosshair at range because of web drop), with a distance readout next to the crosshair.
- **Two rope gauges** (bottom left = left hand, bottom right = right hand): state
  (IDLE / STREAM / TAUT / SLACK / REEL IN / LET OUT) and line length in metres (stream distance while firing).
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
  webs/              # lines.ts (swing lines + two-body elastic solver), ballistics.ts (stream tip,
                     # prediction, anchors, splat magnet), pull.ts, webBalls.ts, lineVisuals.ts
  world/             # cityGen.ts (pure data incl. prop placement), cityWorld.ts (meshes + colliders),
                     # props.ts (movable prop bodies + instanced meshes + glue), boxGeometry.ts, palette.ts
  render/            # materials.ts (toon, windows), pipeline.ts (outline/speed-line post), sky.ts
  audio/             # sfx.ts (Web Audio synthesis)
  ui/                # hud.ts, menu.ts
  modes/             # gameMode.ts (GameMode interface, FreeRoamMode)
  config/            # gameplay.ts (all tunables), settings.ts (presets, persistence)
```
- **Physics model:** Rapier holds static colliders (cuboids, cylinders, balls, cones), the
  dynamic props (world gravity 9.81) and the player: a **standalone capsule collider** (no rigid
  body) moved by a kinematic character controller (slide, autostep 0.5 m, snap to ground).
  Prop pushing is our own force-limited code, not Rapier's.
  - **Pitfall (bug found during M2):** the character controller loses precision against
    *huge* cuboids. The single 2 km street slab made the player sink ~3–20 cm and **get stuck when
    running on the street** (this was present since M1). All big boxes are therefore added as
    **≤ 100 m collider tiles** (`Physics.addCuboidTiled`); the visual mesh stays one piece. Player gravity,
  ropes and movement modes are our own code. Per 60 Hz tick: player tick (lines, pull line,
  movement, rope forces incl. reactions on props) → web balls → prop glue timers →
  `world.step()` → game mode. Ray hits report the prop body they hit (`RayHit.body`).
- **Player modes:** `ground | air | wall | wallrun | swim`. Systems emit `GameEvent`s
  (fire, attach, miss, release, land, step, jump, wallJump, wallStick, stagger, splash), which
  drive audio, camera shake and arm recoil. Gameplay never calls audio or rendering directly.
- Debug: `?shot&cam=x,y,z,yawDeg,pitchDeg[&lines]` hides the start overlay, places the camera,
  optionally attaches both lines, and exposes `window.__game` (`debugPlay()` runs the sim without
  pointer lock; `debugTimeScale` slows time for frame captures). Used for automated screenshots
  and scripted play.

- All tunable gameplay numbers live in `src/config/`, never hard-coded in systems.

---

## 15. Milestones & Definition of Done — [DECIDED]

**The v1 release gate is the core swing feel.** Everything else in this spec is the full
target, built in later milestones. A milestone ships only when the previous one still feels right.

| Milestone | Contents |
|---|---|
| **M1 = v1 (release gate)** | Docker build, click-to-play, procedural city geometry (buildings, streets, rooftops, cel-shaded with outlines, fixed sun), first-person camera + arms, two independent lines with fire/attach/miss/release, per-hand reel in/out, momentum on release, air control, superhero landings, wall-run / crawl / jump, minimal HUD, pause + settings, movement SFX |
| M2 (built on `m2-abilities`) | Movable props (street, rooftop, cars) · pull line with catch/hold/throw · web balls (knock, glue, splats that act as anchors) · two-body lines on props. (Zip and slingshot dropped.) |
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
| 2026-11-22 | Playtest: swinging "feels really good" | Baseline confirmed |
| 2026-11-22 | Lines are elastic spring-dampers (450 elasticity, ζ 0.35, 35% max stretch) | Requested: lines should stretch and pull back like real silk |
| 2026-11-22 | Reel speeds +10% (13.2 in / 11 out) | Requested after playtest |
| 2026-11-22 | Natural gloved hands with jointed fingers + watch-style launcher | Requested: hands should look natural |
| 2026-11-22 | Web = continuous stream while held, ballistic drop, unlimited range | Requested: realistic web with bullet-like drop |
| 2026-11-22 | Released strands linger 2.5 s under gravity, then fade; max 8 | Requested: webs stay briefly but never pile up |
| 2026-11-22 | HUD impact marker from ballistic prediction | Makes aiming with drop learnable |
| 2026-11-22 | Keep stream at 110 m/s; add muzzle flash, tip glow, flowing pulses, catch splat | User chose speed over slower visible flight |
| 2026-11-22 | Fixed-capacity line buffers | Growing Line2 geometry was silently truncated → stream invisible |
| 2026-11-22 | Lines softer: elasticity 300, ζ 0.3, max stretch 50% | Requested: "a bit more elastic" |
| 2026-11-22 | M1 merged to `main`; M2 started on `m2-abilities` | User loves the swinging |
| 2026-11-22 | Web launch speed 110 → 150 m/s | Requested: webs should come out faster |
| 2026-11-22 | Running/air control can't create speed (bleed-only above run speed, air cap) | Bug: unlimited speed by running |
| 2026-11-22 | M2: drop web-zip and slingshot | User: slingshot already possible with current controls |
| 2026-11-22 | M2: movable street props, rooftop props, parked cars | User choice (all three) |
| 2026-11-22 | M2: web balls knock + glue + splat decals + splat anchors | User choice (all four) |
| 2026-11-22 | Pull line: two-body physics, catch ≤250 kg, release to throw | Heavy things pull you, by real physics |
| 2026-11-22 | Walls only grab on deliberate contact; mid-swing hits scrape along | Bug: accidental hits mid-swing stopped you as if climbing |
| 2026-11-22 | Web tethers on F: two shots join ends; just holds; never break, max 10; Shift+F ties to you | User request ("connect objects with a web") |
| 2026-11-22 | Static↔static tether strands are solid (tightrope, anchor) | Makes building-to-building webs useful |
| 2026-11-22 | Ground colliders tiled ≤100 m | Bug: player sank/stuck when running on the street (since M1) |
| 2026-11-22 | Light props pushed (≤600 N), heavy props climbable | Walking into a trash can used to climb it |
