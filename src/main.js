// Entry point: wires the level, game rules, graphics, controls and HUD together.
import './style.css';
import palace from './level/palace.js';
import { buildLevel } from './level/build.js';
import { createGame } from './core/game.js';
import { createScene } from './render/scene.js';
import { createDesktopInput } from './input/desktop.js';
import { createTouchInput } from './input/touch.js';
import { createMap } from './ui/map.js';

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
const AUTOTEST = params.has('autotest'); // used by the automated browser test: skips the start screen

let level;
try {
  level = buildLevel(palace);
} catch (err) {
  // Show level-file mistakes on screen instead of a blank page.
  app.innerHTML = `<div class="level-error"><h1>Level file problem</h1><pre></pre></div>`;
  app.querySelector('pre').textContent = err.message;
  throw err;
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
function showToast(text) {
  toast.textContent = text;
  toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('on'), 1800);
}
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
    <p class="sub">Foundation build: placeholder layout</p>
    <div class="controls desktop-only">
      <p><b>W A S D</b> or arrows: move &nbsp;·&nbsp; <b>Shift</b>: run</p>
      <p><b>Mouse</b>: look &nbsp;·&nbsp; <b>Space</b>: jump</p>
      <p><b>M</b>: debug map &nbsp;·&nbsp; <b>Esc</b>: free the mouse</p>
    </div>
    <div class="controls touch-only">
      <p><b>Left thumb</b>: drag to move (push far to run)</p>
      <p><b>Right thumb</b>: drag to look</p>
      <p><b>Jump</b> and <b>Map</b> buttons on screen</p>
    </div>
    <button type="button" class="start">Click to enter</button>
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
  }

  const room = game.state.room;
  const label = room ? `Room ${room.id}: ${room.name}` : '';
  if (hudRoom.textContent !== label) hudRoom.textContent = label;

  view.render(p);
  map.draw(p, room);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handle used by the automated browser test (scripts/e2e.mjs) and handy for debugging in the console.
window.__epipalace = { game, level, map, view, get active() { return active; } };
