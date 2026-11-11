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
| 1.6 | Open air (sky, open sides, railings), platforms, diagonal walls, ladders, water/swimming, real doors, secret doors with levers/plates, rotate rooms 90° | **Done** |
| 2 | Real layout from the five sketches (entrance, top-left branch, top-right branch, left wing, right wing) | Not started. The owner can now lay it out in the editor; see section 10. |
| 3+ | Mnemonic objects in the numbered item spots, epidemiology content, polish | Not started |

---

## 2. How the project is built

- **Vite + Three.js**, plain JavaScript (no framework). Two pages: the game (`/`) and the map editor (`/editor/`).
- **Hosting:** Netlify builds from GitHub automatically. `netlify.toml` tells Netlify to run
  `npm test && npm run build` and publish `dist/`. **If any test fails, Netlify does not deploy**,
  and the last good version stays live.
- **Live address:** the site is live at **https://epipalace.netlify.app** (editor: `/editor`).
  As of Nov 2026, **epipalace.com is not connected yet**: its DNS (at Namecheap) points to Namecheap's
  parking page. To connect it: in Netlify, Domain management → Add a domain → epipalace.com; in
  Namecheap, Advanced DNS → replace the `@` and `www` parking records with an **A record `@` → 75.2.60.5**
  and a **CNAME `www` → epipalace.netlify.app**; then in Netlify, HTTPS → Verify DNS / Provision certificate.
  Editor drafts are saved per web address, so download palace.js before switching addresses.
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
| room `sky` | `{ id: 10, ..., sky: true }` | Open to the sky: no ceiling; sky and sunlight instead. |
| room `sides` | `sides: { west: 'railing', east: 'open' }` | Per side: `'wall'` (default), `'open'` (no wall) or `'railing'` (see-through, 1 m high). A shared edge is open if **either** room opens it. Below the higher floor and above the lower ceiling, the wall stays. An open side facing the **outside** of the palace gets an invisible barrier, so nobody can walk off the palace. |
| doors `leaf` / `opens` / `trigger` | `{ between: [3, 10], leaf: 'swing' }`, `{ between: [9, 11], leaf: 'secret', trigger: 'gallery-lever' }` | `leaf`: `'none'` (open doorway, default), `'swing'`, `'slide'`, `'secret'` (looks exactly like wall, slides down into the floor). `opens`: `'use'` (press E / Use, default) or `'auto'` (opens as you approach). `trigger`: the name of a lever/plate that opens it (required for secret doors; makes other doors locked until then). Doors can't be put on open/railing sides. |
| `triggers` | `{ name: 'gallery-lever', type: 'lever', x: 31, z: 16.8 }` | `type`: `'lever'` (pull with E / Use) or `'plate'` (1 × 1 m floor plate, step on it). Fires once and its doors stay open. |
| `walls` (any angle, style) | `{ x1: -18, z1: -15, x2: -15, z2: -18 }`, `{ ..., style: 'railing' }` | Free-standing walls may now run at **any angle**. `style: 'railing'` makes a 1 m see-through railing. Curved walls take `style` too. |
| `platforms` | `{ x: -13, z: 19, w: 4, d: 4, top: 1.5, railings: ['west', 'south'], under: 'solid' }` | A raised area inside a room. `railings` = which edges get railings; railings **leave a gap automatically** where stairs, a ramp or a ladder arrive. `under: 'open'` makes a 30 cm slab you can walk beneath (top ≥ 2.3 m). |
| `ladders` | `{ x: -13, z: 21, facing: 'east', top: 1.5 }` | (x, z) is the point on the wall/platform edge the ladder leans on; `facing` = the way you face while climbing. Optional `bottom` (default floor), `w` (width, 0.8). |
| `water` | `{ x: -21, z: 21, w: 7, d: 6, depth: 2.5 }` | A pool cut into the floor, filled to 15 cm below the floor. Over ~1.4 m deep you swim; shallower you wade. |
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
  Chasm (C), Curved wall (U), Wall / railing at any angle (W; hold Shift for straight or 45°), Pillar grid (P),
  Platform (L), Ladder (K; snaps to the nearest wall or platform edge), Water (Q), Lever / plate (G),
  Item spot (I), Start point (O).
- **Room panel**: floor and ceiling height, colour, *Open to the sky*, and each side as wall / open / railing.
  **⟳ Rotate 90°** turns the room and everything in it a quarter-turn clockwise (doorways may need re-placing).
- **Doorway panel**: width, height, position, and *Door*: none / swinging / sliding / secret; *Opens*: on E or
  automatically; *Opened by lever/plate*. A secret door without a lever/plate shows a red problem.
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
| 2 | Central Hall | 5 m ceiling. Hub, with doors to 1, 3, 4, 5 and 7 (the door to 7 slides open automatically). |
| 3 | Left Wing | Two rows of four round pillars. Item spot 2. |
| 4 | Right Wing | 5 m ceiling, free-standing partition, stairs up to Room 9. Item spot 3. |
| 5 | Left Corridor | 3 m wide, 3 m ceiling. Leads to 6. |
| 6 | Top-Left Branch | 6 m ceiling, curved screen wall, a diagonal wall across its north-west corner. Item spot 4. |
| 7 | Right Corridor | 3 m wide, 3 m ceiling. Leads to 8. |
| 8 | Top-Right Branch (chasm) | 2.5 m chasm across the room. Run + jump to cross. Item spot 5. |
| 9 | Upper Gallery | Floor at 1.8 m, a balcony: its west side is a railing over Room 4, with a gap where the stairs arrive. Has the lever that opens the secret door to Room 11. Item spot 6. |
| 10 | Courtyard | Open to the sky; west side railing, east side open (invisible edge). Swinging door from Room 3. A 2.5 m deep pool, a 1.5 m lookout platform with a ladder and railings, and a floor plate that opens the secret door to Room 12. |
| 11 | Secret Study | Behind a secret door in Room 9 (lever). Item spot 7. |
| 12 | Hidden Alcove | Behind a secret door in Room 10 (floor plate). Item spot 8. |

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
| Open doors, pull levers | E (a prompt shows when something can be used) | **Use** button (appears when something can be used) |
| Ladders | Walk into the ladder to climb; walk off the top facing away to climb down; Space lets go | Same, with the joystick and Jump |
| Swim | Space = swim up, C = dive | Jump = swim up, **Dive** button (appears in water) |
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
14. **Open sides are all-or-nothing per side** and an edge is open if either room opens it, which keeps the format simple. Outside edges get an invisible barrier: the player can never leave the palace or fall off it (except into chasms, on purpose).
15. **Doors are the only moving collision.** A closed door adds one box to the world; an opening door removes it at once. A door never closes on the player: if they are in the doorway, it opens again. Swinging doors open into the room on the south/east side.
16. **Secret doors give nothing away**: same texture and thickness as the wall, no sign, no prompt. Levers and plates fire once and their doors stay open (no puzzles that can lock you out).
17. **Ladders and water are zones in the physics**, not boxes: in a ladder's zone, walking towards it climbs; in water, gravity gives way to floating, and you can haul yourself out over an edge up to 1.7 m high, so no pool can trap you.
18. **The palace stands on a lawn** just below its lowest floor, so open sides and the sky look out onto ground rather than empty space.
19. **Rotate is 90° only**: rooms stay rectangles lined up with north/south/east/west. Angled spaces are made with diagonal and curved walls.

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

### Piece 1.6
- [x] Open air: rooms open to the sky; each side wall / open / railing; invisible edge on outside open sides; sky and lawn
- [x] Platforms with railing edges (automatic gaps for stairs/ramps/ladders), walk-under platforms; diagonal walls; railing-style walls and curves
- [x] Ladders (climb up/down, let go); water (float, swim, dive with C, wade, climb out of any pool); underwater tint
- [x] Real doors (swinging, sliding; open with E/Use or automatically) and secret doors opened by levers or floor plates; "E: Open door" prompts; phone Use and Dive buttons
- [x] Editor: Platform, Ladder, Water, Lever/plate tools; any-angle walls; room sky/sides; door type/trigger; Rotate 90°; Help updated
- [x] Placeholder layout shows every feature (rooms 9–12, see section 6)
- [x] **Tests: 84 unit tests.** New: sky rooms have no ceiling; open outside edge has a barrier; railings block and can't be jumped; balcony railing gap at the stairs; can't walk under a raised room; open side between rooms is passable; platform railing; walk-under platform; diagonal wall blocks at every point and angle; ladder up, down, and not grabbed when walking past; floating, diving and resurfacing, climbing out, shallow wading; swing door blocks/opens/closes; door never closes on the player; automatic sliding door; secret door blocks with no prompt and opens by lever; plate opens its door; rotate 90° (and back after 4 turns); ladder snapping; validation messages. Deliberate breakage confirmed for barriers, railings, diagonal walls, ladders, swimming, door collision and door safety.
- [x] **Browser tests**: game 30 checks (adds: door prompt, closed door blocks, E opens it, ladder climb, floating, diving tint, lever prompt, secret door opens and is walkable); editor 36 checks (adds: platform, railing tick-box, ladder snap, water, 45° wall, lever, secret door needs/accepts a trigger, sky + railing side, Rotate 90° and undo)
- [x] Fixed along the way: shallow pools could trap the player; secret doors showed a slightly different colour; the Courtyard's open side accidentally opened into Room 2; floor numbers could float over water; Ctrl was briefly mapped to "dive" (Ctrl+W closes the tab), now C only

### Known limitations / next steps
- The layout is still a **placeholder**: Piece 2 builds the real one from the sketches (the owner may draft it in the editor).
- The editor is built for a desktop browser. It works on a tablet, but not comfortably on a phone.
- No rooms stacked directly above other rooms (use platforms, including walk-under platforms, for mezzanines and bridges).
- Rooms rotate in 90° steps only; doors can't be placed on open or railing sides.
- epipalace.com is not connected to Netlify yet (see section 2); the site is live at epipalace.netlify.app.
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
