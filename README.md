# Lineweaver: a web-slinging game

A first-person, physics-driven swinging game in a cel-shaded procedural city. You fire two
independent cable lines, one from each hand, and reel each one in or let it out yourself.

`SPEC.md` is the source of truth for how the game looks, feels and is built.

## Play (Docker)

```bash
git clone https://github.com/Amit-Sherman/web-slinger.git
cd web-slinger
docker compose up --build
```

Open **http://localhost:8080** in Chrome, Edge or Firefox and click to play.

## Controls

| Input | Action |
|---|---|
| Mouse | Look |
| Left / right mouse (hold) | Fire & hold the left / right line; release to let go |
| Q / E | Reel the left / right line in |
| Shift+Q / Shift+E | Let the left / right line out |
| W A S D | Move · steer in the air · crawl on walls |
| Space | Jump · wall-jump |
| Shift | Sprint · wall-run (hold it when you hit a wall fast) |
| Ctrl or C | Crouch · drop off a wall |
| Middle mouse (hold) | Pull line: yank light objects into your hands, release to throw · heavy/fixed things yank you |
| F, then F | Tether: web two things together (props, walls, poles, buildings) |
| F, then Shift+F | Tie the first end to yourself · F again cuts it |
| Esc | Pause & settings |

Tips: hold a mouse button to pour a web stream. It has no range limit but drops with gravity, so
aim at the orange diamond (where the web will land), not the crosshair, for long shots. Keep holding
to swing. Let go near the bottom of the arc for
speed, or near the top for height. Alternate hands for rhythm. Walk into any wall to climb it.

## Webcam head-tracking (optional)

Esc → Settings → **Webcam head-tracking**. Allow camera access when the browser asks. Turn your
head to glance around, and lean to peek. Your aim stays on the mouse. Press **H** to recenter while
looking straight at the screen. Tune "Head look amount" if glances feel too small or too big.
The camera image is processed locally in your browser; nothing is uploaded, and it works offline.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production bundle in dist/
```

`?seed=1234` in the URL generates a different city.
