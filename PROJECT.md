# EpiPalace: Project Notes

EpiPalace (epipalace.com) is a first-person 3D **memory palace** for teaching epidemiology to
medical students. Students walk through a building in their browser (desktop or phone). Each room
holds numbered mnemonic objects that stand for epidemiology concepts.

This file is the single source of truth for goals, decisions and progress. Update it with every change.

---

## 1. Goals

- Open in any modern browser, on desktop and on phones. Nothing to install.
- Bright, readable, hollow rooms that you walk *inside*. Walls, floors and ceilings are solid.
- Collision you can trust, proven by automated tests that block a deploy if they fail.
- The layout lives in one data file, so changing a room means editing one place.
- Clear room numbers everywhere (debug map, floors, door signs, HUD), so feedback can say "change Room 7".
- Built in pieces, with each piece tested before the next starts.

### Roadmap (pieces)

| Piece | What | Status |
|---|---|---|
| 1 | Foundation: level format, hollow rooms, collision + tests, desktop & phone controls, chasm respawn, debug map | **Done** (placeholder layout) |
| 2 | Real layout from the five sketches (entrance, top-left branch, top-right branch, left wing, right wing) | Not started. Sketches received (see section 8); waiting on answers to the open questions. |
| 3+ | Mnemonic objects in the numbered item spots, epidemiology content, polish | Not started |

---

## 2. How the project is built

- **Vite + Three.js**, plain JavaScript (no framework).
- **Hosting:** Netlify builds from GitHub automatically. `netlify.toml` tells Netlify to run
  `npm test && npm run build` and publish `dist/`. **If any test fails, Netlify does not deploy**,
  and the last good version stays live.
- **Do not reuse** the earlier prototype (the old single `index.html`). It was replaced from scratch.
  It is still in the git history if ever needed for reference.

### Folder map

```
index.html              page shell (loads src/main.js)
src/level/palace.js     ★ THE LEVEL FILE: rooms, doors, chasms, walls, items, spawn
src/level/validate.js   checks the level file, gives plain-English errors
src/level/build.js      turns the level file into solid boxes (used for BOTH visuals and collision)
src/level/geometry.js   small rectangle helpers
src/core/physics.js     player movement + collision (no graphics; fully testable)
src/core/game.js        game rules: chasm respawn, current room
src/render/scene.js     draws the boxes with Three.js, lights, room numbers, door signs
src/render/textures.js  floor/wall/label textures drawn in code
src/input/desktop.js    keyboard + mouse
src/input/touch.js      phone joystick, look pad, Jump & Map buttons
src/ui/map.js           debug top-down map
src/main.js             wires everything together, HUD, start/pause screen
tests/*.test.js         automated tests (run on every deploy)
scripts/e2e.mjs         real-browser test with screenshots (run in development, not on Netlify)
```

### Commands (for whoever runs the code)

```
npm install          # once
npm run dev          # local preview at http://localhost:5173
npm test             # unit tests (collision, level, chasms)
npm run build        # production build into dist/
npm run test:e2e     # after build: plays the game in headless Chrome, screenshots in test-output/
npm run check        # all of the above in order
```

Handy URL options: `?map` opens the full debug map at start. `?touch` forces the phone controls on
a desktop. `?autotest` skips the start screen (used by the browser test).

---

## 3. Level format (`src/level/palace.js`)

All units are metres. The format is like graph paper seen from above, and the debug map shows it exactly:

- **x** = distance to the **east** (right on the map)
- **z** = distance to the **south** (down on the map)
- A rectangle `{ x, z, w, d }` starts at its **top-left (north-west) corner**. It is `w` wide (east-west) and `d` deep (north-south).

| Section | Example | Notes |
|---|---|---|
| `defaults` | `{ height: 4, wallThickness: 0.3, doorWidth: 1.6, doorHeight: 2.6, chasmDepth: 14, ... }` | Used whenever a room or door doesn't say otherwise. |
| `rooms` | `{ id: 7, name: 'Lab', x: 2, z: -6, w: 4, d: 12, height: 4, floor: 0, color: '#e6e0d0' }` | Every walkable space, corridors included. Walls are generated **automatically** along every room edge. Rooms must not overlap; touching rooms share one wall. |
| `doors` | `{ between: [2, 7], width: 1.6, offset: 0 }` | Cuts an opening in the wall shared by two touching rooms. Centred on the shared edge; `offset` slides it along. |
| `chasms` | `{ room: 8, x: 8, z: -18, w: 2.5, d: 12, depth: 14, respawn: { x: 4, z: -9, facing: 'east' } }` | A hole in a room's floor. Falling 5 m in sends the player to `respawn` (on solid floor at the top). |
| `walls` | `{ x1: 16, z1: 8, x2: 16, z2: 12, height: 2 }` | Extra free-standing walls, straight east-west or north-south. `height` is optional (defaults to floor-to-ceiling). |
| `items` | `{ id: 3, room: 4, x: 20, z: 13 }` | Numbered spots for future mnemonic objects (shown as gold pedestals). |
| `spawn` | `{ x: 0, z: 27, facing: 'north' }` | Start position. `facing` is north/east/south/west or compass degrees. |

What the builder generates from this, in `build.js`: floors (with chasm holes cut out), ceilings,
walls (doubles merged, door gaps cut, a lintel above each door), chasm pit walls and pit floor,
pedestals. **The same box list feeds the 3D view, the collision and the walls on the debug map.**

If the level file has a mistake (overlapping rooms, a door between rooms that don't touch, a door
too wide for its wall, a spawn point outside the palace...), the game shows the problem in plain
English instead of starting, and the tests fail, so it can't be deployed by accident.

---

## 4. Room numbering

- Room numbers are the `id` values in `palace.js`. They are **permanent labels for feedback**
  ("change Room 7"). The map, the HUD, the floor markings and the door signs all show them.
- Current placeholder rooms (press **M** in game to see the map):

| # | Name | Notes |
|---|---|---|
| 1 | Entrance | Start point. Item spot 1. |
| 2 | Central Hall | Hub, with doors to 1, 3, 4, 5 and 7 |
| 3 | Left Wing | Item spot 2 |
| 4 | Right Wing | Has a free-standing partition. Item spot 3. |
| 5 | Left Corridor | Leads to 6 |
| 6 | Top-Left Branch | Taller room (6 m). Item spot 4. |
| 7 | Right Corridor | Leads to 8 |
| 8 | Top-Right Branch (chasm) | 2.5 m chasm across the room. Run + jump to cross. Item spot 5 is on the far side. |

- Item spots have their own numbers (gold), separate from room numbers.
- **Decision still open for Piece 2:** whether room numbers should follow the numbers marked on
  the sketches. Those sketch numbers mark mnemonic item positions, so they probably map to
  *item* numbers, not room numbers. To confirm with the owner when the sketches arrive.

---

## 5. Controls

| | Desktop | Phone / tablet |
|---|---|---|
| Move | W A S D or arrow keys | Left thumb: a joystick appears where you touch, so drag it |
| Run | Shift | Push the joystick all the way out |
| Look | Mouse (click into the game first). If the browser refuses mouse capture, hold the button and drag. | Right thumb: drag anywhere on the right half |
| Jump | Space | Jump button |
| Debug map | M (off → corner → full screen) | Map button |
| Free the cursor | Esc (shows the pause screen; click to continue) | n/a |

Phone controls switch on automatically on touch-screen devices (or on first touch).

---

## 6. Decisions made (and why)

1. **Axis-aligned rectangles only.** Rooms, walls and chasms are rectangles aligned to north/south/east/west. This keeps the level file simple to read and edit, and makes collision exact and testable. Angled or curved walls can be added later if the sketches need them.
2. **Walls are centred on room edges** (0.3 m thick, half on each side), so two touching rooms share one wall. The walkable inside of a room is 0.15 m smaller on each side than its rectangle.
3. **The player is an upright box** (0.6 m wide, 1.7 m tall, eyes at 1.6 m). Movement is split into steps of at most 0.1 m, and walls must be at least 0.2 m thick, so the player **cannot tunnel through a wall** even at very low frame rates or with a huge movement. Each axis is resolved separately, so the player slides along walls instead of sticking.
4. **One box list for visuals and collision.** What you see is exactly what blocks you.
5. **Bright, even lighting** (sky light + ambient + two soft directional lights + glowing ceiling panels), with no shadows. The old version was dark. Each room has its own pastel floor colour so rooms are easy to tell apart. Lambert materials and merged geometry keep phones smooth.
6. **Chasm respawn = a fixed spot per chasm** ("the top"), defined in the level file and checked to be on solid floor. Respawn happens 5 m below the floor, before reaching the bottom, with a "You fell!" message. Anyone who somehow falls 40 m below the lowest floor goes back to the start.
7. **Doors only between rooms at the same floor height** for now. Stairs and ramps are not supported yet.
8. **Tests run on Netlify before every deploy.** The heavier browser test (`scripts/e2e.mjs`) is run during development, because Netlify's build machines don't have a browser.
9. **Mouse-capture glitch handled:** Chrome sends one huge fake mouse movement when the mouse is captured. It is ignored so the view doesn't jump.

---

## 7. What's done (Piece 1)

- [x] Vite + Three.js project, Netlify config (`netlify.toml`)
- [x] Data-driven level format with validation and plain-English errors
- [x] Hollow rooms: floors, walls, ceilings, door openings with lintels, room-coloured tiled floors
- [x] Collision (walls, floors, ceilings, pedestals, chasm pits)
- [x] Automated tests (36): every wall of every room, at many frame rates, diagonal corners, huge single movements, ceilings, floors, every door passable both ways, 3 minutes of random wandering, chasm respawn, jumping the chasm, level-file error checks. Tested against deliberate breakage: removing one wall fails 8 tests, and disabling the anti-tunnelling steps fails 2.
- [x] Browser test (19 checks) on desktop and an emulated iPhone 13, with screenshots: start screen, walking into walls, going through doors, jumping, mouse look, chasm respawn, brightness check, debug map, joystick, look pad, jump button, map button, no console errors
- [x] Desktop controls: WASD/arrows, Shift run, mouse look, Space jump, Esc frees cursor (pause screen)
- [x] Phone controls: floating joystick, look pad, Jump & Map buttons, no page scrolling or zooming
- [x] Fall-into-chasm respawn at the top
- [x] Debug top-down map (M): numbered and named rooms, walls, doors, chasms (red hatching), respawn points (green), item spots (gold), player arrow, current room highlighted
- [x] HUD showing "Room N: name", room numbers on floors, door signs ("→ 2 Central Hall")

### Known limitations / next steps

- The layout is a **placeholder**. The real one comes from the sketches in Piece 2.
- The earlier AI conversation was never received (not needed, since its code is not reused).
- No stairs/ramps or different floor heights between connected rooms yet.
- In portrait orientation on phones the field of view is narrow. Consider landscape, or widening the view.
- No sound, no mnemonic objects yet. Item spots are plain pedestals.

---

## 8. Sketches (input for Piece 2)

Saved in `docs/sketches/` (phone metadata removed):

| File | Area | Numbers marked on it |
|---|---|---|
| `1-entrance.jpg` | Entrance | 1 / 1b-or-1c (left, unclear), 1a, 2, 3, 4 |
| `2-top-left-branch.jpg` | Top-left branch | 1 to 6 |
| `3-top-right-branch.jpg` | Top-right branch | 7 to 12 |
| `4-left-wing.jpg` | Left wing | 1b to 10b |
| `5-right-wing.jpg` | Right wing | 1c to 8c |

**The owner says the sketches are very imperfect.** Treat them as a guide to the *feel*,
the *order of spaces* and *where the numbered spots are*, not as exact floor plans.
Proportions, exact angles and wobbly lines should not be copied literally.

### Confirmed by the owner

- **Numbers = mnemonic object spots** (except the entrance numbers below, which mark connections).
- **Diagonal hatching = stairs.**
- **Half-moons with zigzags = pits / chasms.**
- **Entrance number 4** (the raised platform at the top of the entrance, Sketch 1 D3) is "extra",
  not a connection. Exactly what "extra" means is still to be confirmed.

### How the sketches connect

Grid references use the lettered grid (columns A–H, rows 1–10) laid over each sketch.

| Entrance (Sketch 1) point | Where | Connects to | Point on that sketch |
|---|---|---|---|
| **1a**: stairs at the top-right of the long hall | F5 | **Top-left branch** (Sketch 2) | C7: small stairs on the lower-left edge of the dotted-floor room |
| **1b**: stairs at the top-left of the long hall (the unclear label is "1b") | B5–C5 | **Top-right branch** (Sketch 3) | F8: the ladder-like stairs at the bottom-right |
| **2**: right side of the long hall | F7 | **Left wing** (Sketch 4) | A7: the open, curly end of the long horizontal corridor |
| **3**: left side of the long hall | B7 | **Right wing** (Sketch 5) | G6: the gap in the wall between 1c and 8c |

Note: these cross over. The *top-left* branch and the *left* wing join on the entrance's
*right* side, and vice versa. Built as given. The sketch names are kept as labels.

### Still to confirm

1. What does "extra" mean for entrance number 4?
2. Should the areas keep their names (left wing on the right side), or be renamed to match where they sit?

### My reading of the remaining details (unconfirmed, sensible defaults will be used)

- Entrance: rounded lobes at the bottom are the way in. The long hall has dashed walls (open
  colonnade?) and opens into a wide curved hall with two statues by a step.
- Top-left branch: a honeycomb of round chambers, each with an oval (pillar?), a dotted-floor
  room, and a winding tunnel loop leading to 5 and 6.
- Top-right branch: diagonal layout around a long staircase, with an unnumbered circle top-left.
- Left wing: "open" near 8b–10b (open-air?), an arched feature, ↑/↓ arrows, decorative curls.
- Right wing: probably outdoors. "Lake", a large tree (5c in its canopy), T-shapes along 2c, 8c bush or cloud.
- Scale: rooms about 8–12 m across unless told otherwise.
- Shapes: extend the level format to support angled and curved walls, so the layout feels like the sketches.
