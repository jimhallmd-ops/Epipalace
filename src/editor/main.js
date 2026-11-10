// EpiPalace map editor: draw the palace on a top-down grid, edit numbers in the side panel,
// preview in first person, and save/load the level file (palace.js).
import './editor.css';
import sitePalace from '../level/palace.js';
import { validateLevel, DEFAULTS } from '../level/validate.js';
import { arcSweep, compassPoint } from '../level/geometry.js';
import { toPalaceJS, parseLevelText, browserImporter } from './serialize.js';
import * as M from './model.js';

const DRAFT_KEY = 'epipalace.editor.draft';
const PREVIEW_KEY = 'epipalace.preview';
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
      return true;
    } catch {
      return false;
    }
  },
};

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------
let data;
let restored = false;
try {
  const draft = store.get(DRAFT_KEY);
  if (draft) {
    data = M.normalize(JSON.parse(draft));
    restored = true;
  }
} catch {
  data = null;
}
if (!data) data = M.normalize(sitePalace);

let selection = null; // { type: 'rooms' | 'doors' | ... | 'spawn' | 'respawn', index }
let tool = 'select';
let snapStep = 0.5;
const view = { x: 0, z: 0, scale: 14 }; // world point at the canvas centre, pixels per metre
let undoStack = [];
let redoStack = [];
let lastSnapshot = JSON.stringify(data);
let drag = null; // current mouse action
let hover = null; // world point under the mouse
let spaceHeld = false;

const $ = (sel) => document.querySelector(sel);
const canvas = $('#map');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------------------------
const TOOLS = [
  { id: 'select', key: 'V', ico: '➤', label: 'Select / move', hint: 'Click something to select it. Drag to move it, drag the white squares to resize. Drag empty space to pan; scroll to zoom. Delete key removes the selection.' },
  { id: 'room', key: 'R', ico: '▭', label: 'Room', hint: 'Drag on the grid to draw a room. Rooms that touch share a wall; add a door with the Door tool.' },
  { id: 'door', key: 'D', ico: '🚪', label: 'Doorway', hint: 'Click on a wall shared by two touching rooms to put a doorway there.' },
  { id: 'stairs', key: 'T', ico: '☰', label: 'Stairs', hint: 'Drag from the BOTTOM of the stairs to the TOP. Then set the top height in the panel.' },
  { id: 'ramp', key: 'A', ico: '◢', label: 'Ramp', hint: 'Drag from the BOTTOM of the ramp to the TOP. Then set the top height in the panel.' },
  { id: 'chasm', key: 'C', ico: '▩', label: 'Chasm', hint: 'Drag to cut a hole in a room floor. A green respawn point (R) is placed for you; drag it to move it.' },
  { id: 'curve', key: 'U', ico: '◠', label: 'Curved wall', hint: 'Press at the CENTRE of the curve and drag outwards: distance sets the radius, direction sets which way it bulges.' },
  { id: 'wall', key: 'W', ico: '▏', label: 'Straight wall', hint: 'Drag to draw a free-standing wall inside a room (straight north-south or east-west).' },
  { id: 'pillars', key: 'P', ico: '⁘', label: 'Pillar grid', hint: 'Drag a rectangle; pillars are spread evenly inside it. Set rows, columns and size in the panel.' },
  { id: 'item', key: 'I', ico: '★', label: 'Item spot', hint: 'Click to place a numbered spot for a mnemonic object.' },
  { id: 'spawn', key: 'O', ico: '⚑', label: 'Start point', hint: 'Click where the player should start. Set the facing direction in the panel.' },
];

function buildToolbar() {
  const nav = $('#tools');
  nav.innerHTML = '';
  for (const t of TOOLS) {
    const b = document.createElement('button');
    b.dataset.tool = t.id;
    b.title = `${t.label} (${t.key})`;
    b.innerHTML = `<span class="ico">${t.ico}</span><span>${t.label}</span><kbd>${t.key}</kbd>`;
    b.addEventListener('click', () => setTool(t.id));
    nav.appendChild(b);
  }
}
function setTool(id) {
  tool = id;
  for (const b of document.querySelectorAll('#tools button')) b.classList.toggle('on', b.dataset.tool === id);
  setHint(TOOLS.find((t) => t.id === id).hint);
  canvas.style.cursor = id === 'select' ? 'default' : 'crosshair';
}
let hintTimer = 0;
function setHint(text, flash = false) {
  const h = $('#hint');
  h.textContent = text;
  h.classList.toggle('flash', flash);
  clearTimeout(hintTimer);
  if (flash) hintTimer = setTimeout(() => setTool(tool), 3500);
}

// ---------------------------------------------------------------------------------------------
// History, autosave
// ---------------------------------------------------------------------------------------------
function commit() {
  M.reattach(data);
  const snap = JSON.stringify(data);
  if (snap === lastSnapshot) {
    refresh();
    return;
  }
  undoStack.push(lastSnapshot);
  if (undoStack.length > 200) undoStack.shift();
  redoStack = [];
  lastSnapshot = snap;
  saveDraft();
  refresh();
}
function restore(snap) {
  data = JSON.parse(snap);
  lastSnapshot = snap;
  if (selection && !selectedObject()) selection = null;
  saveDraft();
  refresh();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(lastSnapshot);
  restore(undoStack.pop());
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(lastSnapshot);
  restore(redoStack.pop());
}
function saveDraft() {
  const ok = store.set(DRAFT_KEY, lastSnapshot);
  $('#saved').textContent = ok ? 'Draft saved in this browser ✓ · Download to keep a copy' : 'Could not save a draft in this browser: download to keep your work';
}
function replaceLevel(newData, message) {
  undoStack.push(lastSnapshot);
  redoStack = [];
  data = M.normalize(newData);
  lastSnapshot = JSON.stringify(data);
  selection = null;
  saveDraft();
  fitView();
  refresh();
  if (message) setHint(message);
}

// ---------------------------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------------------------
const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
const W2S = (x, z) => [(x - view.x) * view.scale + canvas.clientWidth / 2, (z - view.z) * view.scale + canvas.clientHeight / 2];
const S2W = (sx, sz) => ({ x: (sx - canvas.clientWidth / 2) / view.scale + view.x, z: (sz - canvas.clientHeight / 2) / view.scale + view.z });
const snap = (v) => Math.round(v / snapStep) * snapStep;
const r3 = (v) => Math.round(v * 1000) / 1000;
const eventWorld = (e) => {
  const rect = canvas.getBoundingClientRect();
  return S2W(e.clientX - rect.left, e.clientY - rect.top);
};

function fitView() {
  if (!data.rooms.length) {
    view.x = 0;
    view.z = 0;
    view.scale = 20;
    return;
  }
  const minX = Math.min(...data.rooms.map((r) => r.x));
  const maxX = Math.max(...data.rooms.map((r) => r.x + r.w));
  const minZ = Math.min(...data.rooms.map((r) => r.z));
  const maxZ = Math.max(...data.rooms.map((r) => r.z + r.d));
  view.x = (minX + maxX) / 2;
  view.z = (minZ + maxZ) / 2;
  view.scale = Math.max(3, Math.min(80, Math.min((canvas.clientWidth - 60) / (maxX - minX + 4), (canvas.clientHeight - 80) / (maxZ - minZ + 4))));
}
function zoomAt(factor, sx, sz) {
  const before = S2W(sx, sz);
  view.scale = Math.max(3, Math.min(150, view.scale * factor));
  const after = S2W(sx, sz);
  view.x += before.x - after.x;
  view.z += before.z - after.z;
  draw();
}

// ---------------------------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------------------------
function selectedObject() {
  if (!selection) return null;
  if (selection.type === 'spawn') return data.spawn;
  if (selection.type === 'respawn') return data.chasms[selection.index]?.respawn;
  return data[selection.type]?.[selection.index] ?? null;
}
const RECT_TYPES = new Set(['rooms', 'chasms', 'stairs', 'ramps', 'pillars']);

function pillarPositions(pg) {
  const out = [];
  for (let i = 0; i < pg.cols; i++) for (let j = 0; j < pg.rows; j++) out.push({ x: pg.x + ((i + 0.5) * pg.w) / pg.cols, z: pg.z + ((j + 0.5) * pg.d) / pg.rows });
  return out;
}

/** What is under world point p? Most specific things first. */
function hitTest(p) {
  const tol = Math.max(0.35, 7 / view.scale);
  const near = (x, z, r = tol) => Math.hypot(p.x - x, p.z - z) <= r;
  const inRect = (o) => p.x >= o.x && p.x <= o.x + o.w && p.z >= o.z && p.z <= o.z + o.d;
  if (near(data.spawn.x, data.spawn.z, Math.max(tol, 0.6))) return { type: 'spawn' };
  for (const [i, c] of data.chasms.entries()) if (c.respawn && near(c.respawn.x, c.respawn.z, Math.max(tol, 0.5))) return { type: 'respawn', index: i };
  for (const [i, it] of data.items.entries()) if (near(it.x, it.z, Math.max(tol, 0.5))) return { type: 'items', index: i };
  for (const [i, d] of data.doors.entries()) {
    const g = M.doorGeometry(data, d);
    if (!g || g.broken) continue;
    const along = g.edge.orient === 'h' ? p.x : p.z;
    const across = g.edge.orient === 'h' ? p.z : p.x;
    if (along >= g.from - 0.1 && along <= g.to + 0.1 && Math.abs(across - g.edge.line) <= Math.max(tol, 0.45)) return { type: 'doors', index: i };
  }
  for (const [i, pg] of data.pillars.entries()) if (inRect(pg)) return { type: 'pillars', index: i };
  for (const type of ['stairs', 'ramps']) for (const [i, st] of data[type].entries()) if (inRect(st)) return { type, index: i };
  for (const [i, c] of data.curves.entries()) if (M.distanceToCurve(c, p.x, p.z) <= tol) return { type: 'curves', index: i };
  for (const [i, w] of data.walls.entries()) if (M.distanceToSegment(p.x, p.z, w.x1, w.z1, w.x2, w.z2) <= tol) return { type: 'walls', index: i };
  for (const [i, c] of data.chasms.entries()) if (inRect(c)) return { type: 'chasms', index: i };
  for (let i = data.rooms.length - 1; i >= 0; i--) if (inRect(data.rooms[i])) return { type: 'rooms', index: i };
  return null;
}

/** Drag handles for the current selection. */
function handles() {
  const o = selectedObject();
  if (!o) return [];
  const t = selection.type;
  if (RECT_TYPES.has(t)) {
    const { x, z, w, d } = o;
    return [
      { id: 'nw', x, z },
      { id: 'n', x: x + w / 2, z },
      { id: 'ne', x: x + w, z },
      { id: 'e', x: x + w, z: z + d / 2 },
      { id: 'se', x: x + w, z: z + d },
      { id: 's', x: x + w / 2, z: z + d },
      { id: 'sw', x, z: z + d },
      { id: 'w', x, z: z + d / 2 },
    ];
  }
  if (t === 'walls') return [
    { id: 'p1', x: o.x1, z: o.z1 },
    { id: 'p2', x: o.x2, z: o.z2 },
  ];
  if (t === 'curves') {
    const e = M.curveEnds(o);
    return [
      { id: 'start', x: e.start.x, z: e.start.z },
      { id: 'end', x: e.end.x, z: e.end.z },
      { id: 'radius', x: e.mid.x, z: e.mid.z },
      { id: 'centre', x: o.cx, z: o.cz },
    ];
  }
  return [];
}
function handleAt(p) {
  const tol = 8 / view.scale;
  return handles().find((h) => Math.abs(h.x - p.x) <= tol && Math.abs(h.z - p.z) <= tol) || null;
}

// ---------------------------------------------------------------------------------------------
// Mouse / touch
// ---------------------------------------------------------------------------------------------
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture?.(e.pointerId);
  const p = eventWorld(e);
  const sp = { x: snap(p.x), z: snap(p.z) };
  if (e.button === 1 || e.button === 2 || spaceHeld) {
    drag = { kind: 'pan', sx: e.clientX, sz: e.clientY, vx: view.x, vz: view.z };
    return;
  }
  if (tool === 'select') {
    const h = handleAt(p);
    if (h) {
      drag = { kind: 'handle', id: h.id, orig: structuredClone(selectedObject()), start: p };
      return;
    }
    const hit = hitTest(p);
    if (!hit) {
      selection = null;
      refreshPanel();
      drag = { kind: 'pan', sx: e.clientX, sz: e.clientY, vx: view.x, vz: view.z };
      draw();
      return;
    }
    selection = hit;
    refreshPanel();
    drag = { kind: 'move', start: p, applied: { x: 0, z: 0 } };
    draw();
    return;
  }
  // Click tools
  if (tool === 'door') return placeDoor(p);
  if (tool === 'item') return placeItem(sp);
  if (tool === 'spawn') {
    data.spawn.x = sp.x;
    data.spawn.z = sp.z;
    selection = { type: 'spawn' };
    commit();
    return;
  }
  // Drag-to-create tools
  drag = { kind: 'create', start: sp, now: sp };
});

canvas.addEventListener('pointermove', (e) => {
  const p = eventWorld(e);
  hover = p;
  if (!drag) {
    updateStatus();
    if (tool === 'select') canvas.style.cursor = handleAt(p) ? 'pointer' : hitTest(p) ? 'move' : 'grab';
    if (tool === 'door') draw();
    return;
  }
  if (drag.kind === 'pan') {
    view.x = drag.vx - (e.clientX - drag.sx) / view.scale;
    view.z = drag.vz - (e.clientY - drag.sz) / view.scale;
  } else if (drag.kind === 'move') {
    moveSelection(p);
  } else if (drag.kind === 'handle') {
    dragHandle(p);
  } else if (drag.kind === 'create') {
    drag.now = { x: snap(p.x), z: snap(p.z) };
    drag.raw = p;
  }
  updateStatus();
  draw();
});

const endDrag = () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.kind === 'move' || d.kind === 'handle') commit();
  else if (d.kind === 'create') finishCreate(d);
  else draw();
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
  },
  { passive: false }
);

function moveSelection(p) {
  const o = selectedObject();
  if (!o) return;
  const total = { x: snap(p.x - drag.start.x), z: snap(p.z - drag.start.z) };
  const dx = total.x - drag.applied.x;
  const dz = total.z - drag.applied.z;
  if (!dx && !dz) return;
  drag.applied = total;
  const t = selection.type;
  if (t === 'rooms') M.moveRoomWithContents(data, o, dx, dz);
  else if (t === 'doors') {
    const g = M.doorGeometry(data, o);
    if (g && !g.broken) {
      const along = g.edge.orient === 'h' ? p.x : p.z;
      const max = (g.edge.to - g.edge.from - g.width) / 2 - data.defaults.wallThickness;
      o.offset = r3(Math.max(-max, Math.min(max, snap(along - (g.edge.from + g.edge.to) / 2))));
      if (o.offset === 0) delete o.offset;
    }
  } else if (t === 'spawn' || t === 'respawn') {
    o.x = r3(o.x + dx);
    o.z = r3(o.z + dz);
  } else M.moveObject(t, o, dx, dz);
}

function dragHandle(p) {
  const o = selectedObject();
  const t = selection.type;
  const sp = { x: snap(p.x), z: snap(p.z) };
  const min = t === 'rooms' ? 1 : 0.5;
  if (RECT_TYPES.has(t)) {
    const a = drag.orig;
    let x0 = a.x;
    let z0 = a.z;
    let x1 = a.x + a.w;
    let z1 = a.z + a.d;
    if (drag.id.includes('w')) x0 = Math.min(sp.x, x1 - min);
    if (drag.id.includes('e')) x1 = Math.max(sp.x, x0 + min);
    if (drag.id.includes('n')) z0 = Math.min(sp.z, z1 - min);
    if (drag.id.includes('s')) z1 = Math.max(sp.z, z0 + min);
    Object.assign(o, { x: r3(x0), z: r3(z0), w: r3(x1 - x0), d: r3(z1 - z0) });
  } else if (t === 'walls') {
    const other = drag.id === 'p1' ? { x: o.x2, z: o.z2 } : { x: o.x1, z: o.z1 };
    const horizontal = Math.abs(sp.x - other.x) >= Math.abs(sp.z - other.z);
    const np = horizontal ? { x: sp.x, z: other.z } : { x: other.x, z: sp.z };
    if (drag.id === 'p1') Object.assign(o, { x1: np.x, z1: np.z, x2: other.x, z2: other.z });
    else Object.assign(o, { x2: np.x, z2: np.z, x1: other.x, z1: other.z });
  } else if (t === 'curves') {
    const ang = Math.round(M.compassAngle(o.cx, o.cz, p.x, p.z) / 5) * 5 % 360;
    if (drag.id === 'start') o.start = ang;
    else if (drag.id === 'end') o.end = ang;
    else if (drag.id === 'radius') o.r = Math.max(0.5, snap(Math.hypot(p.x - o.cx, p.z - o.cz)));
    else if (drag.id === 'centre') {
      o.cx = sp.x;
      o.cz = sp.z;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Creating things
// ---------------------------------------------------------------------------------------------
function rectFrom(a, b) {
  return { x: r3(Math.min(a.x, b.x)), z: r3(Math.min(a.z, b.z)), w: r3(Math.abs(b.x - a.x)), d: r3(Math.abs(b.z - a.z)) };
}
function added(type, obj) {
  data[type].push(obj);
  selection = { type, index: data[type].length - 1 };
  commit();
  setTool('select');
}

function finishCreate(d) {
  const r = rectFrom(d.start, d.now);
  const dx = d.now.x - d.start.x;
  const dz = d.now.z - d.start.z;
  const tooSmall = (min) => r.w < min || r.d < min;
  if (tool === 'room') {
    if (tooSmall(1)) return setHint('Drag a bigger rectangle (at least 1 m × 1 m) to draw a room.', true);
    const id = M.nextId(data.rooms);
    return added('rooms', { id, name: `Room ${id}`, ...r, color: M.ROOM_COLORS[(id - 1) % M.ROOM_COLORS.length] });
  }
  if (tool === 'stairs' || tool === 'ramp') {
    if (tooSmall(0.9)) return setHint('Drag a bigger area (at least 0.9 m wide) for stairs or a ramp.', true);
    const up = Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 'east' : 'west') : dz >= 0 ? 'south' : 'north';
    const room = M.roomAt(data, r.x + r.w / 2, r.z + r.d / 2);
    const floor = room?.floor ?? 0;
    // If the top end leads into a higher room, climb to its floor; otherwise rise 1 m.
    const ends = { north: [r.x + r.w / 2, r.z - 0.5], south: [r.x + r.w / 2, r.z + r.d + 0.5], east: [r.x + r.w + 0.5, r.z + r.d / 2], west: [r.x - 0.5, r.z + r.d / 2] };
    const beyond = M.roomAt(data, ...ends[up]);
    const top = beyond && beyond !== room && (beyond.floor ?? 0) > floor ? beyond.floor : floor + 1;
    return added(tool === 'stairs' ? 'stairs' : 'ramps', { ...r, up, top: r3(top) });
  }
  if (tool === 'chasm') {
    if (tooSmall(0.5)) return setHint('Drag a bigger area for the chasm.', true);
    const chasm = { room: M.roomAt(data, r.x + r.w / 2, r.z + r.d / 2)?.id ?? 0, ...r };
    chasm.respawn = M.autoRespawn(data, chasm);
    return added('chasms', chasm);
  }
  if (tool === 'pillars') {
    if (tooSmall(0.5)) return setHint('Drag a bigger area for the pillar grid.', true);
    return added('pillars', { ...r, rows: Math.max(1, Math.round(r.d / 3)), cols: Math.max(1, Math.round(r.w / 3)), size: 0.6, shape: 'round' });
  }
  if (tool === 'wall') {
    const horizontal = Math.abs(dx) >= Math.abs(dz);
    const w = horizontal ? { x1: Math.min(d.start.x, d.now.x), z1: d.start.z, x2: Math.max(d.start.x, d.now.x), z2: d.start.z } : { x1: d.start.x, z1: Math.min(d.start.z, d.now.z), x2: d.start.x, z2: Math.max(d.start.z, d.now.z) };
    if (Math.abs(w.x2 - w.x1) + Math.abs(w.z2 - w.z1) < 0.5) return setHint('Drag a longer line to draw a wall.', true);
    return added('walls', w);
  }
  if (tool === 'curve') {
    const raw = d.raw || d.now;
    const radius = snap(Math.hypot(raw.x - d.start.x, raw.z - d.start.z));
    if (radius < 0.5) return setHint('Drag further from the centre to set the curve’s radius.', true);
    const ang = Math.round(M.compassAngle(d.start.x, d.start.z, raw.x, raw.z) / 5) * 5;
    return added('curves', { cx: d.start.x, cz: d.start.z, r: radius, start: (ang + 270) % 360, end: (ang + 90) % 360 });
  }
  draw();
}

function placeDoor(p) {
  const spot = M.doorSpotAt(data, p.x, p.z, Math.max(0.6, 12 / view.scale));
  if (!spot) return setHint('No shared wall here. Doorways go on a wall between two rooms that touch.', true);
  const door = { between: spot.between };
  const width = data.defaults.doorWidth;
  const max = (spot.edge.to - spot.edge.from - width) / 2 - data.defaults.wallThickness;
  if (max < 0) return setHint(`That shared wall is too short for a ${width} m doorway.`, true);
  const off = r3(Math.max(-max, Math.min(max, snap(spot.offset))));
  if (off) door.offset = off;
  added('doors', door);
}
function placeItem(p) {
  const room = M.roomAt(data, p.x, p.z);
  if (!room) return setHint('Item spots go inside a room.', true);
  added('items', { id: M.nextId(data.items), room: room.id, x: p.x, z: p.z });
}

// ---------------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------------
function resizeCanvas() {
  const k = dpr();
  canvas.width = Math.round(canvas.clientWidth * k);
  canvas.height = Math.round(canvas.clientHeight * k);
  draw();
}

function draw() {
  const k = dpr();
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const Wc = canvas.clientWidth;
  const Hc = canvas.clientHeight;
  ctx.clearRect(0, 0, Wc, Hc);
  const s = view.scale;
  const t = data.defaults.wallThickness;

  // grid
  const tl = S2W(0, 0);
  const br = S2W(Wc, Hc);
  const step = s >= 8 ? 1 : 5;
  ctx.lineWidth = 1;
  for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
    ctx.strokeStyle = x % 5 === 0 ? '#c9d1dc' : '#e3e8ef';
    const [sx] = W2S(x, 0);
    ctx.beginPath();
    ctx.moveTo(Math.round(sx) + 0.5, 0);
    ctx.lineTo(Math.round(sx) + 0.5, Hc);
    ctx.stroke();
  }
  for (let z = Math.floor(tl.z / step) * step; z <= br.z; z += step) {
    ctx.strokeStyle = z % 5 === 0 ? '#c9d1dc' : '#e3e8ef';
    const [, sz] = W2S(0, z);
    ctx.beginPath();
    ctx.moveTo(0, Math.round(sz) + 0.5);
    ctx.lineTo(Wc, Math.round(sz) + 0.5);
    ctx.stroke();
  }
  // north arrow + scale bar
  ctx.fillStyle = '#5e6b7d';
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('N ↑', Wc - 40, 22);
  const barM = s >= 20 ? 1 : s >= 6 ? 5 : 10;
  ctx.fillRect(Wc - 20 - barM * s, 32, barM * s, 3);
  ctx.fillText(`${barM} m`, Wc - 20 - barM * s, 50);

  const rect = (o) => {
    const [x0, z0] = W2S(o.x, o.z);
    return [x0, z0, o.w * s, o.d * s];
  };

  // rooms: floors
  for (const r of data.rooms) {
    ctx.fillStyle = r.color || '#e8e2d4';
    ctx.fillRect(...rect(r));
  }
  // stairs and ramps
  for (const type of ['stairs', 'ramps']) {
    for (const st of data[type]) {
      const [x0, z0, w, d] = rect(st);
      ctx.fillStyle = type === 'stairs' ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.55)';
      ctx.fillRect(x0, z0, w, d);
      const ns = st.up === 'north' || st.up === 'south';
      const room = M.roomAt(data, st.x + st.w / 2, st.z + st.d / 2);
      const rise = st.top - (st.bottom ?? room?.floor ?? 0);
      const n = type === 'stairs' ? Math.max(1, Math.round(rise / data.defaults.stepHeight)) : 0;
      ctx.strokeStyle = 'rgba(29,43,62,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < n; i++) {
        if (ns) {
          ctx.moveTo(x0, z0 + (i * d) / n);
          ctx.lineTo(x0 + w, z0 + (i * d) / n);
        } else {
          ctx.moveTo(x0 + (i * w) / n, z0);
          ctx.lineTo(x0 + (i * w) / n, z0 + d);
        }
      }
      ctx.stroke();
      if (type === 'ramps') {
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x0, z0, w, d);
        ctx.setLineDash([]);
      }
      arrow(x0 + w / 2, z0 + d / 2, st.up, Math.min(w, d, 60) * 0.4);
      if (w > 80 && d > 36) label(`${type === 'stairs' ? 'stairs' : 'ramp'} ↑ ${st.top} m`, x0 + w / 2, z0 + d - 9, 11, '#1d2b3e');
    }
  }
  // chasms
  for (const c of data.chasms) {
    const [x0, z0, w, d] = rect(c);
    ctx.fillStyle = '#15161c';
    ctx.fillRect(x0, z0, w, d);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, z0, w, d);
    ctx.clip();
    ctx.strokeStyle = '#e63946';
    ctx.lineWidth = 1.5;
    for (let k2 = -d; k2 < w; k2 += 10) {
      ctx.beginPath();
      ctx.moveTo(x0 + k2, z0);
      ctx.lineTo(x0 + k2 + d, z0 + d);
      ctx.stroke();
    }
    ctx.restore();
    if (c.respawn) {
      const [rx, rz] = W2S(c.respawn.x, c.respawn.z);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = '#2a9d8f';
      ctx.beginPath();
      ctx.moveTo(rx, rz);
      ctx.lineTo(x0 + w / 2, z0 + d / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      dot(rx, rz, Math.max(7, 0.4 * s), '#2a9d8f', 'R', '#fff');
    }
  }
  // pillars
  for (const pg of data.pillars) {
    const size = (pg.size ?? 0.6) * s;
    ctx.fillStyle = '#1d2b3e';
    for (const pp of pillarPositions(pg)) {
      const [px, pz] = W2S(pp.x, pp.z);
      ctx.beginPath();
      if ((pg.shape ?? 'round') === 'square') ctx.rect(px - size / 2, pz - size / 2, size, size);
      else ctx.arc(px, pz, Math.max(1.5, size / 2), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // room walls (centred on each edge, like in the game)
  ctx.strokeStyle = '#1d2b3e';
  ctx.lineWidth = Math.max(1.5, t * s);
  for (const r of data.rooms) ctx.strokeRect(...rect(r));
  // free walls and curves
  ctx.lineCap = 'butt';
  for (const w of data.walls) {
    const [a, b] = W2S(w.x1, w.z1);
    const [c2, d2] = W2S(w.x2, w.z2);
    ctx.beginPath();
    ctx.moveTo(a, b);
    ctx.lineTo(c2, d2);
    ctx.stroke();
  }
  for (const c of data.curves) {
    const [cx, cz] = W2S(c.cx, c.cz);
    const sweep = arcSweep(c.start, c.end);
    // compass angle -> canvas angle: canvas 0 = east, clockwise; compass 0 = north, clockwise
    const a0 = ((c.start - 90) * Math.PI) / 180;
    const a1 = ((c.start + sweep - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.arc(cx, cz, c.r * s, a0, a1);
    ctx.stroke();
  }
  // doors: gaps in the walls
  for (const [i, dr] of data.doors.entries()) {
    const g = M.doorGeometry(data, dr);
    if (!g) continue;
    if (g.broken) {
      const [ax, az] = W2S(g.a.x + g.a.w / 2, g.a.z + g.a.d / 2);
      const [bx, bz] = W2S(g.b.x + g.b.w / 2, g.b.z + g.b.d / 2);
      ctx.strokeStyle = '#c62828';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(ax, az);
      ctx.lineTo(bx, bz);
      ctx.stroke();
      ctx.setLineDash([]);
      label('door: rooms don’t touch', (ax + bx) / 2, (az + bz) / 2, 12, '#c62828');
      continue;
    }
    const sel = selection?.type === 'doors' && selection.index === i;
    ctx.fillStyle = sel ? '#1e6bff' : '#ffffff';
    const half = Math.max(2, (t * s) / 2 + 1);
    if (g.edge.orient === 'h') {
      const [x0, z0] = W2S(g.from, g.edge.line);
      ctx.fillRect(x0, z0 - half, g.width * s, half * 2);
    } else {
      const [x0, z0] = W2S(g.edge.line, g.from);
      ctx.fillRect(x0 - half, z0, half * 2, g.width * s);
    }
  }
  // room labels
  for (const r of data.rooms) {
    const [x0, z0, w, d] = rect(r);
    const big = Math.max(11, Math.min(64, Math.min(w, d) * 0.32));
    label(String(r.id), x0 + w / 2, z0 + d / 2 - big * 0.2, big, '#1d3557', true);
    if (Math.min(w, d) > 70) {
      label(r.name || '', x0 + w / 2, z0 + d / 2 + big * 0.55, 12, '#1d3557');
      const floor = r.floor ?? 0;
      const h = r.height ?? data.defaults.height;
      label(`floor ${floor} m · ceiling ${r3(floor + h)} m`, x0 + w / 2, z0 + d / 2 + big * 0.55 + 15, 11, '#5e6b7d');
    }
  }
  // items + spawn
  for (const it of data.items) {
    const [x, z] = W2S(it.x, it.z);
    dot(x, z, Math.max(8, 0.45 * s), '#d4a62a', String(it.id), '#1d2b3e');
  }
  {
    const [x, z] = W2S(data.spawn.x, data.spawn.z);
    const facing = { north: 0, east: 90, south: 180, west: 270 }[data.spawn.facing ?? 'north'] ?? (data.spawn.facing || 0);
    const a = ((facing - 90) * Math.PI) / 180;
    const L = Math.max(12, 0.9 * s);
    ctx.fillStyle = '#2a9d8f';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * L, z + Math.sin(a) * L);
    ctx.lineTo(x + Math.cos(a + 2.5) * L * 0.7, z + Math.sin(a + 2.5) * L * 0.7);
    ctx.lineTo(x + Math.cos(a - 2.5) * L * 0.7, z + Math.sin(a - 2.5) * L * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    label('START', x, z + L + 8, 10, '#2a9d8f', true);
  }

  // selection outline + handles
  const o = selectedObject();
  if (o) {
    ctx.strokeStyle = '#1e6bff';
    ctx.lineWidth = 2;
    const tp = selection.type;
    if (RECT_TYPES.has(tp)) ctx.strokeRect(...rect(o));
    else if (tp === 'walls' || tp === 'curves') {
      /* handles show it */
    } else if (tp !== 'doors') {
      const [x, z] = W2S(o.x, o.z);
      ctx.beginPath();
      ctx.arc(x, z, Math.max(12, 0.7 * s), 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const h of handles()) {
      const [x, z] = W2S(h.x, h.z);
      ctx.fillStyle = h.id === 'centre' ? '#1e6bff' : '#fff';
      ctx.strokeStyle = '#1e6bff';
      ctx.lineWidth = 1.5;
      ctx.fillRect(x - 5, z - 5, 10, 10);
      ctx.strokeRect(x - 5, z - 5, 10, 10);
    }
  }

  // door tool: highlight the shared wall under the mouse
  if (tool === 'door' && hover && !drag) {
    const spot = M.doorSpotAt(data, hover.x, hover.z, Math.max(0.6, 12 / view.scale));
    if (spot) {
      const e = spot.edge;
      ctx.strokeStyle = 'rgba(30,107,255,0.6)';
      ctx.lineWidth = Math.max(4, t * s + 4);
      ctx.beginPath();
      if (e.orient === 'h') {
        ctx.moveTo(...W2S(e.from, e.line));
        ctx.lineTo(...W2S(e.to, e.line));
      } else {
        ctx.moveTo(...W2S(e.line, e.from));
        ctx.lineTo(...W2S(e.line, e.to));
      }
      ctx.stroke();
    }
  }

  // ghost of the thing being drawn
  if (drag?.kind === 'create') {
    ctx.strokeStyle = '#1e6bff';
    ctx.fillStyle = 'rgba(30,107,255,0.12)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    const a = drag.start;
    const b = drag.now;
    if (tool === 'wall') {
      const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.z - a.z);
      ctx.beginPath();
      ctx.moveTo(...W2S(a.x, a.z));
      ctx.lineTo(...W2S(horizontal ? b.x : a.x, horizontal ? a.z : b.z));
      ctx.stroke();
    } else if (tool === 'curve') {
      const raw = drag.raw || b;
      const rr = snap(Math.hypot(raw.x - a.x, raw.z - a.z));
      const ang = M.compassAngle(a.x, a.z, raw.x, raw.z);
      const [cx, cz] = W2S(a.x, a.z);
      ctx.beginPath();
      ctx.arc(cx, cz, rr * s, ((ang - 180) * Math.PI) / 180, (ang * Math.PI) / 180);
      ctx.stroke();
      label(`radius ${rr} m`, cx, cz - 10, 12, '#1e6bff', true);
    } else {
      const r = rectFrom(a, b);
      const [x0, z0, w, d] = rect(r);
      ctx.fillRect(x0, z0, w, d);
      ctx.strokeRect(x0, z0, w, d);
      label(`${r.w} × ${r.d} m`, x0 + w / 2, z0 - 10, 12, '#1e6bff', true);
      if (tool === 'stairs' || tool === 'ramp') {
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const up = Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 'east' : 'west') : dz >= 0 ? 'south' : 'north';
        arrow(x0 + w / 2, z0 + d / 2, up, Math.min(w, d, 60) * 0.4, '#1e6bff');
      }
    }
    ctx.setLineDash([]);
  }
}

function label(text, x, z, size, color, bold = false) {
  ctx.font = `${bold ? 800 : 600} ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, size * 0.18);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.strokeText(text, x, z);
  ctx.fillStyle = color;
  ctx.fillText(text, x, z);
}
function dot(x, z, r, fill, text, textColor) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, z, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = textColor;
  ctx.font = `800 ${Math.max(9, r * 1.1)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, z + 0.5);
}
function arrow(x, z, dir, L, color = '#1d2b3e') {
  const [ax, az] = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[dir] || [0, -1];
  L = Math.max(L, 8);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - ax * L, z - az * L);
  ctx.lineTo(x + ax * L, z + az * L);
  ctx.moveTo(x + ax * L, z + az * L);
  ctx.lineTo(x + ax * L * 0.4 - az * L * 0.45, z + az * L * 0.4 + ax * L * 0.45);
  ctx.moveTo(x + ax * L, z + az * L);
  ctx.lineTo(x + ax * L * 0.4 + az * L * 0.45, z + az * L * 0.4 - ax * L * 0.45);
  ctx.stroke();
}

function updateStatus() {
  if (!hover) return;
  const room = M.roomAt(data, hover.x, hover.z);
  $('#status').textContent = `x ${hover.x.toFixed(2)}  ·  z ${hover.z.toFixed(2)}  ·  ${room ? `Room ${room.id}: ${room.name || ''}` : 'outside the palace'}  ·  ${data.rooms.length} rooms`;
}

// ---------------------------------------------------------------------------------------------
// Side panel: properties of the selection, or the whole level
// ---------------------------------------------------------------------------------------------
const num = (key, label, extra = {}) => ({ key, label, kind: 'num', ...extra });
const opt = (key, label, placeholder, extra = {}) => ({ key, label, kind: 'num', optional: true, placeholder, ...extra });
const rectFields = [num('x', 'West edge, x (m)'), num('z', 'North edge, z (m)'), num('w', 'Width, east–west (m)'), num('d', 'Depth, north–south (m)')];
const FACINGS = ['north', 'east', 'south', 'west'];

const SCHEMAS = {
  rooms: {
    title: (o) => `Room ${o.id}`,
    fields: () => [
      { key: 'id', label: 'Room number', kind: 'int' },
      { key: 'name', label: 'Name', kind: 'text' },
      ...rectFields,
      opt('floor', 'Floor height (m)', '0', { rec: 'Raise or lower a whole room. Connect different heights with stairs or a ramp.' }),
      opt('height', 'Ceiling height above floor (m)', () => String(data.defaults.height), { rec: 'Recommended: 3–3.5 ordinary room, 3 corridor, 5–8 grand hall.' }),
      { key: 'color', label: 'Floor colour', kind: 'color' },
    ],
    info: (o) => {
      const floor = o.floor ?? 0;
      const h = o.height ?? data.defaults.height;
      const narrow = Math.min(o.w, o.d) < 2.2 ? `<br>⚠ Only <b>${Math.min(o.w, o.d)} m</b> wide: corridors feel best at 2.5–3 m.` : '';
      return `Size <b>${o.w} × ${o.d} m</b> (${r3(o.w * o.d)} m²). Ceiling at <b>${r3(floor + h)} m</b>.${narrow}`;
    },
  },
  doors: {
    title: (o) => `Doorway: Room ${o.between[0]} ↔ Room ${o.between[1]}`,
    fields: () => [
      opt('width', 'Width (m)', () => String(data.defaults.doorWidth), { rec: 'Recommended 1.2 m (wide, comfortable). 0.9 m feels tight.' }),
      opt('height', 'Height (m)', () => String(data.defaults.doorHeight), { rec: 'Recommended 2.4 m.' }),
      opt('offset', 'Slide along the wall (m)', '0', { rec: 'Or drag the doorway along its wall.' }),
    ],
    info: (o) => {
      const a = data.rooms.find((r) => r.id === o.between[0]);
      const b = data.rooms.find((r) => r.id === o.between[1]);
      if (!a || !b) return 'One of the rooms no longer exists.';
      const diff = Math.abs((a.floor ?? 0) - (b.floor ?? 0));
      return diff > 0.35
        ? `The floors differ by <b>${r3(diff)} m</b>. The doorway sits at the higher floor, so add <b>stairs or a ramp</b> on the lower side leading up to it.`
        : 'Both rooms are at the same height.';
    },
  },
  stairs: {
    title: () => 'Stairs',
    fields: () => [...rectFields, { key: 'up', label: 'Goes up towards', kind: 'select', options: FACINGS }, opt('bottom', 'Bottom height (m)', 'room floor'), num('top', 'Top height (m)')],
    info: (o) => M.slopeInfo(data, o, 'stairs') + '<br>Comfortable stairs: steps ~18 cm high, 28–30 cm deep.',
  },
  ramps: {
    title: () => 'Ramp',
    fields: () => [...rectFields, { key: 'up', label: 'Goes up towards', kind: 'select', options: FACINGS }, opt('bottom', 'Bottom height (m)', 'room floor'), num('top', 'Top height (m)')],
    info: (o) => M.slopeInfo(data, o, 'ramps') + '<br>Gentle ramps are 5–15°. The limit is 40°.',
  },
  chasms: {
    title: () => 'Chasm',
    fields: () => [...rectFields, opt('depth', 'Depth (m)', () => String(data.defaults.chasmDepth)), num('respawn.x', 'Respawn point x (m)'), num('respawn.z', 'Respawn point z (m)'), { key: 'respawn.facing', label: 'Respawn facing', kind: 'select', options: FACINGS }],
    info: (o) => `Players who fall in come back at the green <b>R</b> marker (drag it to move it). A running jump crosses about 3.5 m.${o.w > 3.5 && o.d > 3.5 ? '<br>⚠ This chasm is wider than a running jump in both directions.' : ''}`,
  },
  curves: {
    title: () => 'Curved wall',
    fields: () => [num('cx', 'Centre x (m)'), num('cz', 'Centre z (m)'), num('r', 'Radius (m)'), num('start', 'Start angle (° from north)'), num('end', 'End angle (° from north)'), opt('height', 'Height (m)', 'to ceiling')],
    info: (o) => `Goes clockwise from ${o.start}° to ${o.end}° (${arcSweep(o.start, o.end)}° of a circle). 0° = north, 90° = east. Use 0 → 360 for a full circle. Drag the white squares to reshape.`,
  },
  walls: {
    title: () => 'Straight wall',
    fields: () => [num('x1', 'Start x (m)'), num('z1', 'Start z (m)'), num('x2', 'End x (m)'), num('z2', 'End z (m)'), opt('height', 'Height (m)', 'to ceiling')],
    info: (o) => `Length ${r3(Math.hypot(o.x2 - o.x1, o.z2 - o.z1))} m. Walls run straight north–south or east–west; use a curved wall for anything else.`,
  },
  pillars: {
    title: () => 'Pillar grid',
    fields: () => [...rectFields, { key: 'rows', label: 'Rows (north–south)', kind: 'int' }, { key: 'cols', label: 'Columns (east–west)', kind: 'int' }, opt('size', 'Pillar thickness (m)', '0.6'), { key: 'shape', label: 'Shape', kind: 'select', options: ['round', 'square'] }, opt('height', 'Height (m)', 'to ceiling')],
    info: (o) => {
      const gx = o.w / o.cols - (o.size ?? 0.6);
      const gz = o.d / o.rows - (o.size ?? 0.6);
      return `${o.rows * o.cols} pillars. Gaps between them: ${r3(gx)} m × ${r3(gz)} m.${Math.min(gx, gz) < 0.8 ? '<br>⚠ Gaps under 0.8 m are too narrow to walk through.' : ''}`;
    },
  },
  items: {
    title: (o) => `Item spot ${o.id}`,
    fields: () => [{ key: 'id', label: 'Spot number', kind: 'int' }, num('x', 'x (m)'), num('z', 'z (m)')],
    info: (o) => `In Room ${o.room}. A mnemonic object will stand here.`,
  },
  spawn: {
    title: () => 'Start point',
    fields: () => [num('x', 'x (m)'), num('z', 'z (m)'), { key: 'facing', label: 'Facing', kind: 'select', options: FACINGS }],
    info: () => 'Where the player appears when the game starts.',
  },
  respawn: {
    title: () => 'Chasm respawn point',
    fields: () => [num('x', 'x (m)'), num('z', 'z (m)'), { key: 'facing', label: 'Facing', kind: 'select', options: FACINGS }],
    info: () => 'Players who fall into the chasm come back here. It must be on solid floor.',
  },
};

const getPath = (o, path) => path.split('.').reduce((v, k) => v?.[k], o);
function setPath(o, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((v, k) => (v[k] ??= {}), o);
  if (value === undefined) delete target[last];
  else target[last] = value;
}

function fieldRow(f, obj, onChange) {
  const row = document.createElement('div');
  row.className = 'field';
  const id = `f-${f.key.replace('.', '-')}`;
  const lab = document.createElement('label');
  lab.htmlFor = id;
  lab.textContent = f.label;
  row.appendChild(lab);
  let input;
  if (f.kind === 'select') {
    input = document.createElement('select');
    for (const o of f.options) input.add(new Option(o, o));
    input.value = getPath(obj, f.key) ?? f.options[0];
  } else {
    input = document.createElement('input');
    input.type = f.kind === 'text' ? 'text' : f.kind === 'color' ? 'color' : 'number';
    if (f.kind === 'num') input.step = 'any';
    if (f.kind === 'int') input.step = '1';
    const v = getPath(obj, f.key);
    input.value = v ?? '';
    if (f.kind === 'color' && !v) input.value = '#e8e2d4';
    if (f.placeholder) input.placeholder = typeof f.placeholder === 'function' ? f.placeholder() : f.placeholder;
  }
  input.id = id;
  input.addEventListener('change', () => {
    let v = input.value;
    if (f.kind === 'num' || f.kind === 'int') {
      if (v === '' && f.optional) v = undefined;
      else {
        v = Number(v);
        if (!Number.isFinite(v)) return refreshPanel();
        if (f.kind === 'int') v = Math.round(v);
      }
    }
    onChange(f, v);
  });
  row.appendChild(input);
  if (f.rec) {
    const rec = document.createElement('div');
    rec.className = 'rec';
    rec.textContent = f.rec;
    row.appendChild(rec);
  }
  return row;
}

function refreshPanel() {
  const box = $('#props');
  box.innerHTML = '';
  const o = selectedObject();
  if (!o) return levelPanel(box);
  const schema = SCHEMAS[selection.type];
  const h = document.createElement('h3');
  h.textContent = schema.title(o);
  box.appendChild(h);
  for (const f of schema.fields()) {
    box.appendChild(
      fieldRow(f, o, (field, v) => {
        if (selection.type === 'rooms' && field.key === 'id') {
          const err = M.renumberRoom(data, o, v);
          if (err) {
            setHint(err, true);
            return refreshPanel();
          }
        } else if (selection.type === 'items' && field.key === 'id' && data.items.some((it) => it !== o && it.id === v)) {
          setHint(`Item spot ${v} already exists.`, true);
          return refreshPanel();
        } else {
          setPath(o, field.key, v);
        }
        commit();
      })
    );
  }
  const info = document.createElement('div');
  info.className = 'info';
  info.innerHTML = schema.info(o);
  box.appendChild(info);
  const actions = document.createElement('div');
  actions.className = 'actions';
  const roomId = previewRoomId();
  if (roomId) actions.appendChild(button(`▶ Preview from Room ${roomId}`, () => preview(roomId), 'go'));
  if (selection.type !== 'spawn' && selection.type !== 'respawn') actions.appendChild(button('Delete', deleteSelection, 'danger'));
  actions.appendChild(button('Deselect', () => select(null)));
  box.appendChild(actions);
}

function levelPanel(box) {
  box.innerHTML = '<h3>Level</h3>';
  box.appendChild(
    fieldRow({ key: 'name', label: 'Level name', kind: 'text' }, data, (f, v) => {
      data.name = v;
      commit();
    })
  );
  const h4 = document.createElement('h4');
  h4.textContent = 'Default proportions';
  box.appendChild(h4);
  const recs = {
    height: ['Ceiling height (m)', 'Recommended 3.5'],
    doorWidth: ['Door width (m)', 'Recommended 1.2'],
    doorHeight: ['Door height (m)', 'Recommended 2.4'],
    wallThickness: ['Wall thickness (m)', 'Recommended 0.3 (minimum 0.2)'],
    stepHeight: ['Stair step height (m)', 'Recommended 0.18'],
    chasmDepth: ['Chasm depth (m)', 'Recommended 14'],
  };
  for (const [key, [lab, rec]] of Object.entries(recs)) {
    box.appendChild(
      fieldRow({ key, label: lab, kind: 'num', rec }, data.defaults, (f, v) => {
        data.defaults[f.key] = v;
        commit();
      })
    );
  }
  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.appendChild(
    button('Use recommended proportions', () => {
      data.defaults = { ...data.defaults, ...DEFAULTS };
      commit();
    })
  );
  box.appendChild(actions);
  const info = document.createElement('div');
  info.className = 'info';
  info.innerHTML =
    `<b>${data.rooms.length}</b> rooms, <b>${data.doors.length}</b> doorways, <b>${data.items.length}</b> item spots.<br>` +
    'The player is 1.7 m tall with eyes at 1.6 m, and 0.6 m wide. Rooms are measured to the middle of their walls.<br>' +
    'Click anything on the map to edit it. Press <b>?</b> Help for publishing steps.';
  box.appendChild(info);
}

function button(text, fn, cls = '') {
  const b = document.createElement('button');
  b.textContent = text;
  if (cls) b.className = cls;
  b.addEventListener('click', fn);
  return b;
}

function refreshProblems() {
  const box = $('#problems');
  const problems = validateLevel(M.tidy(data));
  const warnings = [];
  for (const r of data.rooms) if (Math.min(r.w, r.d) < 1.8) warnings.push(`Room ${r.id} is only ${Math.min(r.w, r.d)} m wide (2.5–3 m recommended for corridors).`);
  for (const pg of data.pillars) {
    const gap = Math.min(pg.w / pg.cols, pg.d / pg.rows) - (pg.size ?? 0.6);
    if (gap < 0.8 && pg.rows * pg.cols > 1) warnings.push(`A pillar grid has gaps of only ${r3(gap)} m; the player can't fit between its pillars.`);
  }
  for (const d of data.doors) {
    const a = data.rooms.find((r) => r.id === d.between[0]);
    const b = data.rooms.find((r) => r.id === d.between[1]);
    if (!a || !b) continue;
    const low = (a.floor ?? 0) < (b.floor ?? 0) ? a : b;
    const diff = Math.abs((a.floor ?? 0) - (b.floor ?? 0));
    const climb = [...data.stairs, ...data.ramps].some((s) => M.roomAt(data, s.x + s.w / 2, s.z + s.d / 2) === low);
    if (diff > 0.35 && !climb) warnings.push(`The doorway between Rooms ${a.id} and ${b.id} is ${r3(diff)} m above Room ${low.id}'s floor, and Room ${low.id} has no stairs or ramp.`);
  }
  let html = '<h4>Problems</h4>';
  if (!problems.length && !warnings.length) html += '<p class="ok">✓ No problems. The level is ready to preview and publish.</p>';
  else {
    html += '<ul>';
    for (const p of problems) html += `<li class="bad">✖ ${escapeHtml(p)}</li>`;
    for (const w of warnings) html += `<li class="warn">⚠ ${escapeHtml(w)}</li>`;
    html += '</ul>';
    if (problems.length) html += '<p class="bad" style="font-size:12px">Red problems must be fixed before the level can be published (the website tests would reject it).</p>';
  }
  box.innerHTML = html;
}
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function select(sel) {
  selection = sel;
  refresh();
}
function deleteSelection() {
  const o = selectedObject();
  if (!o || selection.type === 'spawn' || selection.type === 'respawn') return;
  if (selection.type === 'rooms') M.deleteRoom(data, o);
  else data[selection.type].splice(selection.index, 1);
  selection = null;
  commit();
}
function refresh() {
  refreshPanel();
  refreshProblems();
  updatePreviewButton();
  $('[data-action="undo"]').disabled = !undoStack.length;
  $('[data-action="redo"]').disabled = !redoStack.length;
  draw();
}

// ---------------------------------------------------------------------------------------------
// Preview, files
// ---------------------------------------------------------------------------------------------
function previewRoomId() {
  const o = selectedObject();
  if (!o) return null;
  if (selection.type === 'rooms') return o.id;
  const a = M.anchor(selection.type, o) || (o.x !== undefined ? { x: o.x, z: o.z } : null);
  return a ? (M.roomAt(data, a.x, a.z)?.id ?? null) : null;
}
function updatePreviewButton() {
  const id = previewRoomId();
  $('[data-action="preview"]').textContent = id ? `▶ Preview from Room ${id}` : '▶ Preview';
}
function preview(roomId = previewRoomId()) {
  const ok = store.set(PREVIEW_KEY, JSON.stringify({ level: M.tidy(data), room: roomId, at: Date.now() }));
  if (!ok) return setHint('This browser blocked storage, so the preview cannot be opened.', true);
  window.open(`/?preview${roomId ? `&room=${roomId}` : ''}`, 'epipalace-preview');
}

function download() {
  const text = toPalaceJS(M.tidy(data));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  a.download = 'palace.js';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  setHint('Downloaded palace.js. To publish it, see ? Help → "Put your level on epipalace.com".');
}

$('#file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const parsed = await parseLevelText(await file.text(), browserImporter);
    replaceLevel(parsed, `Opened ${file.name}.`);
  } catch (err) {
    setHint(`Could not open ${file.name}: ${err.message}`, true);
  }
});

const ACTIONS = {
  open: () => $('#file').click(),
  download,
  site: () => {
    if (confirm('Replace this draft with the level currently on the website? (You can undo this.)')) replaceLevel(sitePalace, 'Loaded the level from the website.');
  },
  blank: () => {
    if (confirm('Start a new, empty level? (You can undo this.)')) replaceLevel(M.blankLevel(), 'Started a blank level.');
  },
  undo,
  redo,
  preview: () => preview(),
  help: () => $('#help').showModal(),
  'zoom-in': () => zoomAt(1.25, canvas.clientWidth / 2, canvas.clientHeight / 2),
  'zoom-out': () => zoomAt(0.8, canvas.clientWidth / 2, canvas.clientHeight / 2),
  fit: () => {
    fitView();
    draw();
  },
};
for (const b of document.querySelectorAll('[data-action]')) b.addEventListener('click', () => ACTIONS[b.dataset.action]());
$('#snap').addEventListener('change', (e) => (snapStep = Number(e.target.value)));

// ---------------------------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    if (typing) return;
    e.preventDefault();
    return e.shiftKey ? redo() : undo();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    if (typing) return;
    e.preventDefault();
    return redo();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    return download();
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Space') {
    spaceHeld = true;
    e.preventDefault();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    return deleteSelection();
  }
  if (e.key === 'Escape') {
    drag = null;
    setTool('select');
    return select(null);
  }
  if (e.key === '?') return $('#help').showModal();
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[e.key] && selection) {
    e.preventDefault();
    const [dx, dz] = arrows[e.key].map((v) => v * snapStep);
    const o = selectedObject();
    if (selection.type === 'rooms') M.moveRoomWithContents(data, o, dx, dz);
    else if (selection.type === 'spawn' || selection.type === 'respawn') {
      o.x += dx;
      o.z += dz;
    } else if (selection.type !== 'doors') M.moveObject(selection.type, o, dx, dz);
    return commit();
  }
  const t = TOOLS.find((x) => x.key === e.key.toUpperCase());
  if (t) setTool(t.id);
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') spaceHeld = false;
});

// ---------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------
buildToolbar();
setTool('select');
new ResizeObserver(resizeCanvas).observe(canvas);
fitView();
refresh();
saveDraft();
if (restored) setHint('Restored your draft from this browser. Use "Load site version" to start from the website’s level instead.');

// For automated tests and the browser console.
window.__editor = {
  get data() {
    return data;
  },
  get selection() {
    return selection;
  },
  get view() {
    return view;
  },
  get drag() {
    return drag;
  },
  W2S,
  select,
  setTool,
  toPalaceJS: () => toPalaceJS(M.tidy(data)),
  compassPoint,
};
