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
| Esc | Pause & settings |

Tips: aim at a building and hold a mouse button to swing. Let go near the bottom of the arc for
speed, or near the top for height. Alternate hands for rhythm. Walk into any wall to climb it.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production bundle in dist/
```

`?seed=1234` in the URL generates a different city.
