// Entry point: wires the level, game rules, graphics, controls and HUD together.
import './style.css';
import palace from './level/palace.js';
import { buildLevel } from './level/build.js';
import { createGame } from './core/game.js';
import { PLAYER, playerOverlaps } from './core/physics.js';
import { createScene } from './render/scene.js';
import { createDesktopInput } from './input/desktop.js';
import { createTouchInput } from './input/touch.js';
import { createMap } from './ui/map.js';

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
const AUTOTEST = params.has('autotest'); // used by the automated browser test: skips the start screen
const PREVIEW = params.has('preview'); // opened from the map editor's Preview button

// In preview mode, play the level the editor stored in this browser instead of the published one.
let levelData = palace;
let previewRoom = null;
if (PREVIEW) {
  try {
    const stored = JSON.parse(localStorage.getItem('epipalace.preview'));
    if (stored?.level) levelData = stored.level;
    previewRoom = Number(params.get('room')) || null;
  } catch {
    /* fall back to the published level */
  }
}

let level;
try {
  level = buildLevel(levelData);
} catch (err) {
  // Show level-file mistakes on screen instead of a blank page.
  app.innerHTML = `<div class="level-error"><h1>Level file problem</h1><p>Fix these in the map editor (red items under "Problems"), then preview again.</p><pre></pre></div>`;
  app.querySelector('pre').textContent = err.message;
  throw err;
}

// "Preview from Room N": start in that room, on a free spot as close to its centre as possible.
if (previewRoom) {
  const room = level.rooms.find((r) => r.id === previewRoom);
  if (room) {
    const spot = freeSpotIn(room);
    if (spot) Object.assign(level.spawn, spot);
  }
}
function freeSpotIn(room) {
  const cx = room.x + room.w / 2;
  const cz = room.z + room.d / 2;
  const t = level.settings.wallThickness / 2 + PLAYER.radius + 0.05;
  const candidates = [];
  for (let x = room.x + t; x <= room.x + room.w - t; x += 0.25) {
    for (let z = room.z + t; z <= room.z + room.d - t; z += 0.25) candidates.push({ x, z, dist: Math.hypot(x - cx, z - cz) });
  }
  candidates.sort((a, b) => a.dist - b.dist);
  for (const c of candidates) {
    if (level.chasms.some((ch) => c.x > ch.x - 0.6 && c.x < ch.x + ch.w + 0.6 && c.z > ch.z - 0.6 && c.z < ch.z + ch.d + 0.6)) continue;
    const y = level.groundAt(c.x, c.z);
    if (!level.boxes.some((b) => playerOverlaps(c.x, y, c.z, b))) return { x: c.x, z: c.z, y, yaw: openestYaw(c.x, y, c.z) };
  }
  return null;
}
// Face whichever of north/east/south/west has the most open floor ahead.
function openestYaw(x, y, z) {
  let best = { yaw: 0, dist: -1 };
  for (const [yaw, dx, dz] of [
    [0, 0, -1],
    [-Math.PI / 2, 1, 0],
    [Math.PI, 0, 1],
    [Math.PI / 2, -1, 0],
  ]) {
    let d = 0;
    while (d < 20 && !level.boxes.some((b) => playerOverlaps(x + dx * (d + 0.25), y + 0.4, z + dz * (d + 0.25), b))) d += 0.25;
    if (d > best.dist) best = { yaw, dist: d };
  }
  return best.yaw;
}

const game = createGame(level);
const view = createScene(app, level);
const canvas = view.renderer.domElement;
const desktop = createDesktopInput(canvas);
const map = createMap(app, level);
if (params.has('map')) map.setMode('full');

// ---- HUD ----
const hud = document.createElement('div');
hud.className = 'hud';
hud.innerHTML = `<div class="hud-room"></div><div class="hud-hint">M: map</div>`;
app.appendChild(hud);
const hudRoom = hud.querySelector('.hud-room');
const toast = document.createElement('div');
toast.className = 'toast';
app.appendChild(toast);
let toastTimer = 0;
function showToast(text, kind = '') {
  toast.textContent = text;
  toast.className = `toast ${kind}`;
  toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('on'), 1800);
}
const prompt = document.createElement('div');
prompt.className = 'prompt';
app.appendChild(prompt);
const underwater = document.createElement('div');
underwater.className = 'underwater';
app.appendChild(underwater);
const crosshair = document.createElement('div');
crosshair.className = 'crosshair';
app.appendChild(crosshair);

// ---- Touch controls (phones/tablets) ----
let touch = null;
const coarse = window.matchMedia?.('(pointer: coarse)').matches;
function enableTouch() {
  if (!touch) {
    touch = createTouchInput(app, { onMap: () => map.cycle() });
    hud.querySelector('.hud-hint').textContent = '';
  }
}
if (coarse || params.has('touch')) enableTouch();
window.addEventListener('touchstart', enableTouch, { once: true, passive: true });

// ---- Start / pause screen ----
const overlay = document.createElement('div');
overlay.className = 'overlay';
overlay.innerHTML = `
  <div class="panel">
    <h1>EpiPalace</h1>
    <p class="sub">${PREVIEW ? 'Editor preview: this level is not published yet' : 'Placeholder layout'}</p>
    <div class="controls desktop-only">
      <p><b>W A S D</b> or arrows: move &nbsp;·&nbsp; <b>Shift</b>: run</p>
      <p><b>Mouse</b>: look &nbsp;·&nbsp; <b>Space</b>: jump</p>
      <p><b>E</b>: open doors, pull levers &nbsp;·&nbsp; <b>C</b>: dive (in water)</p>
      <p><b>M</b>: debug map &nbsp;·&nbsp; <b>Esc</b>: free the mouse</p>
    </div>
    <div class="controls touch-only">
      <p><b>Left thumb</b>: drag to move (push far to run)</p>
      <p><b>Right thumb</b>: drag to look</p>
      <p><b>Jump</b> and <b>Map</b> buttons on screen; <b>Use</b> and <b>Dive</b> appear when needed</p>
    </div>
    <button type="button" class="start">Click to enter</button>
    <p class="editor-link"><a href="/editor/">Open the map editor</a></p>
  </div>`;
app.appendChild(overlay);
const startBtn = overlay.querySelector('.start');
let active = false;

function setActive(on) {
  active = on;
  overlay.style.display = on ? 'none' : 'flex';
}
function start() {
  setActive(true);
  if (!touch) desktop.requestLock();
}
overlay.addEventListener('click', start);
document.addEventListener('pointerlockchange', () => {
  if (!desktop.isLocked() && !touch && !AUTOTEST) {
    setActive(false);
    startBtn.textContent = 'Paused: click to continue';
  }
});
// Clicking the game again re-captures the mouse.
canvas.addEventListener('click', () => {
  if (active && !touch && !desktop.isLocked()) desktop.requestLock();
});
if (touch) startBtn.textContent = 'Tap to enter';
setActive(AUTOTEST);

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat) map.cycle();
});

// ---- Main loop ----
let last = performance.now();
function frame(now) {
  const dt = (now - last) / 1000;
  last = now;

  const a = desktop.sample();
  const b = touch ? touch.sample() : null;
  const input = {
    forward: a.forward + (b?.forward || 0),
    strafe: a.strafe + (b?.strafe || 0),
    run: a.run || !!b?.run,
    jump: a.jump || !!b?.jump,
    down: a.down || !!b?.down,
    use: a.use || !!b?.use,
  };
  const p = game.player;
  if (active) {
    p.yaw -= a.lookX + (b?.lookX || 0);
    p.pitch -= a.lookY + (b?.lookY || 0);
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
    game.update(dt, input);
  } else {
    game.update(dt, {}); // keep gravity running, but ignore controls
  }

  for (const ev of game.state.events.splice(0)) {
    if (ev.type === 'respawn') showToast('You fell! Back to the top.');
    if (ev.type === 'trigger' && ev.opened) showToast('Somewhere, a hidden door opens…', 'secret');
  }

  const room = game.state.room;
  const label = room ? `Room ${room.id}: ${room.name}` : '';
  if (hudRoom.textContent !== label) hudRoom.textContent = label;

  // What can be used right now ("E: Open door"), and the underwater tint
  const st = game.state;
  const promptText = active && st.target ? st.target.label : '';
  const promptHtml = promptText ? (st.target.kind === 'locked' || touch ? promptText : `<kbd>E</kbd>${promptText}`) : '';
  if (prompt.innerHTML !== promptHtml) prompt.innerHTML = promptHtml;
  underwater.classList.toggle('on', !!st.underwater);
  touch?.setContext({ canUse: st.target && st.target.kind !== 'locked', inWater: p.swimming });

  view.render(p, st);
  map.draw(p, room);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handle used by the automated browser test (scripts/e2e.mjs) and handy for debugging in the console.
window.__epipalace = { game, level, map, view, get active() { return active; } };
