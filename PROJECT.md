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
- The layout lives in one data file, and the owner can design it visually in the **map editor** (epipalace.com/editor).
- Clear room numbers everywhere (editor, debug map, floors, door signs, HUD), so feedback can say "change Room 7".
- Built in pieces, with each piece tested before the next starts.

### Roadmap (pieces)

| Piece | What | Status |
|---|---|---|
| 1 | Foundation: level format, hollow rooms, collision + tests, desktop & phone controls, chasm respawn, debug map | **Done** |
| 1.5 | Map editor at /editor; stairs, ramps, curved walls, pillar grids, different floor heights; proportions review | **Done** |
| 2 | Real layout from the five sketches (entrance, top-left branch, top-right branch, left wing, right wing) | Not started. The owner can now lay it out in the editor; see section 10. |
| 3+ | Mnemonic objects in the numbered item spots, epidemiology content, polish | Not started |

---

## 2. How the project is built

- **Vite + Three.js**, plain JavaScript (no framework). Two pages: the game (`/`) and the map editor (`/editor/`).
- **Hosting:** Netlify builds from GitHub automatically. `netlify.toml` tells Netlify to run
  `npm test && npm run build` and publish `dist/`. **If any test fails, Netlify does not deploy**,
  and the last good version stays live.
- **Do not reuse** the earlier prototype (the old single `index.html`). It was replaced from scratch.

### Folder map

```
index.html              game page shell (loads src/main.js); also sends /editor to /editor/
editor/index.html       map editor page (loads src/editor/main.js)
src/level/palace.js     ★ THE LEVEL FILE: rooms, doors, chasms, walls, stairs, ramps, curves, pillars, items, spawn
src/level/validate.js   checks the level file, gives plain-English errors; holds the DEFAULT proportions
src/level/build.js      turns the level file into solid boxes (used for visuals, collision and the debug map)
src/level/geometry.js   rectangle / arc helpers
src/core/physics.js     player movement + collision, step-up for stairs (no graphics; fully testable)
src/core/game.js        game rules: fixed 1/60 s steps, chasm respawn, current room
src/render/scene.js     draws the level with Three.js (smooth ramps, curved walls, round pillars), camera
src/render/textures.js  floor/wall/label textures drawn in code
src/input/desktop.js    keyboard + mouse
src/input/touch.js      phone joystick, look pad, Jump & Map buttons
src/ui/map.js           in-game debug top-down map
src/main.js             game: wires everything together, HUD, start/pause screen, editor preview mode
src/editor/main.js      map editor: grid canvas, tools, side panel, undo, save/load, preview
src/editor/model.js     editor operations (move room with contents, renumber, place doors...), testable
src/editor/serialize.js reads and writes palace.js
tests/*.test.js         automated tests (run on every deploy)
scripts/e2e.mjs         real-browser test of the game (desktop + phone), screenshots in test-output/
scripts/e2e-editor.mjs  real-browser test of the editor (draws with the mouse, previews, downloads)
docs/sketches/          the owner's five layout sketches
```

### Commands (for whoever runs the code)

```
npm install          # once
npm run dev          # local preview at http://localhost:5173 (editor at /editor/)
npm test             # unit tests (collision, level, features, editor)
npm run build        # production build into dist/
npm run test:e2e     # after build: plays the game and uses the editor in headless Chrome
npm run check        # all of the above in order
```

Game URL options: `?map` opens the full debug map at start. `?touch` forces the phone controls on
a desktop. `?autotest` skips the start screen (used by the browser test). `?preview&room=N` plays the
level the editor stored in this browser, starting in Room N (used by the editor's Preview button).

---

## 3. Level format (`src/level/palace.js`)

**The easiest way to edit it is the map editor** (section 5). The file stays plain and readable, so it can also be edited by hand.

All units are metres. The format is like graph paper seen from above:

- **x** = distance to the **east** (right on the map)
- **z** = distance to the **south** (down on the map)
- A rectangle `{ x, z, w, d }` starts at its **top-left (north-west) corner**. It is `w` wide (east-west) and `d` deep (north-south).
- Compass angles (curved walls, facings): 0 = north, 90 = east, 180 = south, 270 = west.

| Section | Example | Notes |
|---|---|---|
| `defaults` | `{ height: 3.5, wallThickness: 0.3, doorWidth: 1.2, doorHeight: 2.4, chasmDepth: 14, stepHeight: 0.18 }` | Used whenever a room/door doesn't say otherwise. See section 4. |
| `rooms` | `{ id: 9, name: 'Gallery', x: 24, z: 8, w: 10, d: 10, floor: 1.8, height: 3.5, color: '#e3f0d0' }` | Every walkable space, corridors included. `floor` = floor height (default 0), `height` = ceiling height above the floor. Walls are generated **automatically** along every edge. Rooms must not overlap; touching rooms share one wall. |
| `doors` | `{ between: [4, 9], width: 1.2, offset: 0 }` | A doorway in the wall shared by two touching rooms. If their floors differ, the doorway sits at the **higher** floor, and the lower room needs stairs or a ramp up to it. |
| `stairs` | `{ x: 20, z: 12, w: 4, d: 2, up: 'east', top: 1.8 }` | A flight of solid steps. `up` = the direction you walk to go up. `bottom` (optional) defaults to the room floor. The number of steps is worked out from `defaults.stepHeight`. Too steep is an error. |
| `ramps` | `{ x: -1.5, z: 20, w: 3, d: 5, up: 'north', top: 0 }` | Same fields as stairs, but a smooth slope (max 40°). |
| `chasms` | `{ room: 8, x: 8, z: -18, w: 2.5, d: 12, depth: 14, respawn: { x: 4, z: -9, facing: 'east' } }` | A hole in a room's floor. Falling 5 m in sends the player to `respawn`. |
| `walls` | `{ x1: 16, z1: 8, x2: 16, z2: 12, height: 2 }` | Free-standing straight walls (north-south or east-west). `height` optional (default floor-to-ceiling). |
| `curves` | `{ cx: -10, cz: -12, r: 3, start: 210, end: 330, height: 2 }` | Curved walls: centre, radius, drawn **clockwise** from `start` to `end`. `0 → 360` is a full circle. `height` optional. |
| `pillars` | `{ x: -22, z: 10, w: 12, d: 6, rows: 2, cols: 4, size: 0.6, shape: 'round' }` | A grid of pillars spread evenly over a rectangle. `shape` is `'round'` or `'square'`; `height` optional. |
| `items` | `{ id: 3, room: 4, x: 12, z: 15 }` | Numbered spots for future mnemonic objects (gold pedestals for now). |
| `spawn` | `{ x: 0, z: 28, facing: 'north' }` | Start position. |

What the builder generates (`build.js`): floors with chasm holes cut out, ceilings, walls (shared
walls merged, door gaps cut, a lintel above and a sill below each doorway), stair steps, chasm pits,
pillars and curved-wall collision, pedestals. **The same boxes feed the 3D view, the collision and the
debug map.** Three shapes are *drawn* smoothly but *collide* as small boxes: ramps (invisible 5 cm
steps under the slope), curved walls (a chain of overlapping 0.3 m posts along the curve) and round
pillars (a square of the same width). The difference is a few centimetres and can't be felt.

If the level has a mistake, the editor lists it in red, the game shows it in plain English instead of
starting, and the tests fail, so it can't be deployed by accident.

---

## 4. Proportions (reviewed in Piece 1.5)

The owner said the Piece 1 proportions felt off. Review and new defaults:

| | Piece 1 | Now | Why |
|---|---|---|---|
| **Field of view** | 72° vertical (≈104° horizontal on a widescreen) | **60° vertical** (≈90° horizontal); tall phone screens widen it so the horizontal view stays ≥ 65° | 72° stretched everything: rooms looked huge and walls bent at the edges. This was the main cause. |
| Eye height | 1.6 m (player 1.7 m tall) | **1.6 m** (unchanged) | Typical adult eye height. |
| Player width | 0.6 m | 0.6 m (unchanged) | Shoulder width. |
| Default ceiling | 4 m | **3.5 m** | Like a public building. Ordinary rooms 3–3.5 m, corridors ~3 m, grand halls 5–8 m (set per room). |
| Doorway | 1.6 × 2.6 m | **1.2 × 2.4 m** | A real single door is 0.9 m. 1.2 m still feels generous with a 0.6 m-wide player. |
| Corridor width | 4 m (placeholder) | **3 m** in the placeholder; **2.5–3 m recommended** | 4 m read as a room, not a corridor. The editor warns below 1.8 m. |
| Walking speed | 4.5 m/s (jogging) | **3.5 m/s**, run 6.5 m/s | Moving fast makes spaces feel small. (Real walking is ~1.4 m/s; games feel right at 3–4.) |
| Jump | ≈1.2 m high | **≈0.9 m** | Less floaty. A running jump still crosses ~3.5 m. |
| Stair step | n/a | **18 cm high**, ≥ 20 cm deep (28–30 cm comfortable) | Normal building stairs. The player climbs up to 35 cm without jumping. |
| Ramps | n/a | **≤ 40°** (5–15° gentle) | |
| Wall thickness | 0.3 m | 0.3 m (unchanged) | |

All of these live in `DEFAULTS` (`src/level/validate.js`) and the level's `defaults` block, and can be
changed in the editor (click empty space → "Default proportions"). The player-body numbers live in `PLAYER`
(`src/core/physics.js`), and the field of view in `src/render/scene.js`.

---

## 5. Map editor (epipalace.com/editor)

A top-down grid editor that reads and writes `palace.js`. Desktop browser recommended.

- **Tools** (left; key in brackets): Select/move (V), Room (R), Doorway (D), Stairs (T), Ramp (A),
  Chasm (C), Curved wall (U), Straight wall (W), Pillar grid (P), Item spot (I), Start point (O).
- **Draw**: drag on the grid (snaps to 0.5 m; 0.25 m or 1 m in the Snap menu). Stairs and ramps:
  drag from the bottom to the top. If the top end leads into a higher room, the stairs climb to its floor.
- **Edit**: click to select; drag to move (a room moves with everything in it); drag the white squares
  to resize or reshape; type exact values in the side panel (floor height, ceiling height, name,
  colour, door width, rows/columns...). Arrow keys nudge, Delete removes, Ctrl+Z / Ctrl+Shift+Z undo/redo.
- **Problems** panel: the same checks the website tests run (red = must fix), plus warnings (orange)
  such as narrow corridors, pillar gaps too small to walk through, or a raised doorway with no stairs.
- **▶ Preview**: opens the game in a new tab with the level you are editing. With a room selected, it
  starts inside that room, on free floor, facing the most open direction.
- **Save / load**: every change is autosaved in the browser. **Download palace.js** saves the file;
  **Open file…** loads one; **Load site version** goes back to the published level; **New blank**.
- **Publishing** (also in the editor's Help): download palace.js → GitHub → `src/level` →
  Add file → Upload files → Create a new branch → Propose changes → Create pull request → wait for
  green checks → Merge. Or send the file to Claude.

---

## 6. Room numbering

- Room numbers are the `id` values in `palace.js`. They are **permanent labels for feedback**
  ("change Room 7"). The editor, the in-game map, the HUD, the floor markings and the door signs all show them.
  Renumbering a room in the editor updates its doors, chasms and item spots.
- Current placeholder rooms:

| # | Name | Notes |
|---|---|---|
| 1 | Entrance | Start point. Floor 1 m lower (−1 m), with a ramp up to Room 2. Item spot 1. |
| 2 | Central Hall | 5 m ceiling. Hub, with doors to 1, 3, 4, 5 and 7. |
| 3 | Left Wing | Two rows of four round pillars. Item spot 2. |
| 4 | Right Wing | 5 m ceiling, free-standing partition, stairs up to Room 9. Item spot 3. |
| 5 | Left Corridor | 3 m wide, 3 m ceiling. Leads to 6. |
| 6 | Top-Left Branch | 6 m ceiling, curved screen wall. Item spot 4. |
| 7 | Right Corridor | 3 m wide, 3 m ceiling. Leads to 8. |
| 8 | Top-Right Branch (chasm) | 2.5 m chasm across the room. Run + jump to cross. Item spot 5. |
| 9 | Upper Gallery | Floor at 1.8 m, reached by the stairs in Room 4. Item spot 6. |

- Item spots have their own numbers (gold), separate from room numbers. The numbers on the sketches
  are item spots (confirmed by the owner); the entrance's numbers mark connections (section 10).

---

## 7. Controls

| | Desktop | Phone / tablet |
|---|---|---|
| Move | W A S D or arrow keys | Left thumb: a joystick appears where you touch, so drag it |
| Run | Shift | Push the joystick all the way out |
| Look | Mouse (click into the game first). If the browser refuses mouse capture, hold the button and drag. | Right thumb: drag anywhere on the right half |
| Jump | Space | Jump button |
| Stairs / ramps | Just walk | Just walk |
| Debug map | M (off → corner → full screen) | Map button |
| Free the cursor | Esc (shows the pause screen; click to continue) | n/a |

---

## 8. Decisions made (and why)

1. **Mostly rectangles, plus curves.** Rooms, stairs, ramps, chasms and pillar grids are rectangles aligned to north/south/east/west. Curved walls add round shapes. This keeps the file easy to read and collision exact. Round rooms are made from a rectangular room plus curved walls inside it.
2. **Walls are centred on room edges** (0.3 m thick, half on each side), so two touching rooms share one wall. The walkable inside of a room is 0.15 m smaller on each side than its rectangle.
3. **The player is an upright box** (0.6 m wide, 1.7 m tall, eyes at 1.6 m). Movement is split into steps of at most 0.1 m, and walls must be at least 0.2 m thick, so the player **cannot tunnel through a wall**. Each axis is resolved separately, so the player slides along walls.
4. **Stairs by step-up.** On the ground, the player automatically climbs anything up to 35 cm with head room above it. Going down, they are kept on the ground ("snap-down") instead of bouncing. The camera glides over steps. A 1 m pedestal is not climbable.
5. **Smooth on screen, boxes for collision** for ramps, curved walls and round pillars (see section 3). Tested to block and carry the player correctly.
6. **Doors between different floor heights** sit at the higher floor. The lower side needs stairs/ramp (the editor warns if missing). Rooms can't be stacked on top of each other yet (no overlapping rooms).
7. **Fixed time steps.** The game advances in 1/60 s steps, running several per frame on slow devices, so walking speed is the same on every device instead of turning into slow motion.
8. **One box list for visuals and collision.** What you see is what blocks you.
9. **Bright, even lighting**, no shadows; a pastel floor colour per room.
10. **Chasm respawn = a fixed spot per chasm** ("the top"), checked to be on solid floor.
11. **Tests run on Netlify before every deploy.** Browser tests (`scripts/e2e*.mjs`) run during development, because Netlify's build machines don't have a browser.
12. **The editor saves files, not the website.** It runs entirely in the browser, with no login and no server. Publishing goes through GitHub, so every layout change still passes the collision tests before going live, and every version is kept in history.
13. **/editor without the slash** is redirected to /editor/ by a tiny script on the game page, so it works on any host.

---

## 9. What's done

### Piece 1
- [x] Vite + Three.js project, Netlify config, data-driven level format with plain-English validation
- [x] Hollow rooms, collision, desktop & phone controls, chasm respawn, debug map, HUD, door signs

### Piece 1.5
- [x] **Map editor** at /editor: draw/resize/move rooms on a grid with room numbers; floor & ceiling height per room; stairs, ramps, chasms, doorways, curved walls, straight walls, pillar grids, item spots, start point; side panel with exact values; undo/redo; autosave; download/open palace.js; load site version; one-click first-person **Preview** (optionally from the selected room); Problems panel; Help with publishing steps
- [x] Level format: stairs, ramps, curves, pillars; doors between different floor heights
- [x] Physics: step-up/snap-down for stairs and ramps; fixed time steps
- [x] Proportions reviewed; new defaults applied (section 4); placeholder layout updated to show every feature
- [x] **Tests: 59 unit tests**. On top of Piece 1's: stairs up/down without bouncing, ramp smoothness, pedestal not climbable, too-steep stairs/ramps rejected, curved wall blocks from inside and outside at every angle, every pillar blocks from 4 sides (checked every frame), raised doorways, save → load round trip, room renumbering, moving rooms with contents, door placement, auto respawn. Deliberate breakage confirmed: removing step-up fails 4, removing snap-down fails 1, gaps in a curved wall fail 1, removing one pillar's collision fails 1.
- [x] **Browser tests**: game 21 checks (walks the ramp and the stairs too); editor 23 checks (draws a room with the mouse, edits the panel, places a doorway, resizes with a handle, adds pillars/curve/item, undo/redo, overlap shows a red problem, Preview opens the game in the new room at the right height, Download, reload restores the draft, Open file, Help)

### Known limitations / next steps
- The layout is still a **placeholder**: Piece 2 builds the real one from the sketches (the owner may draft it in the editor).
- The editor is built for a desktop browser. It works on a tablet, but not comfortably on a phone.
- No rooms stacked above other rooms (bridges, balconies). No sloped/angled straight walls (use curves).
- No sound, no mnemonic objects yet. Item spots are plain pedestals.

---

## 10. Sketches (input for Piece 2)

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
