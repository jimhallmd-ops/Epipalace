// Phone / tablet controls.
// Left half of the screen: a virtual joystick appears where your thumb lands; drag to move
// (push it all the way out to run). Right half: drag to look around. Buttons: Jump, Map.

const LOOK_SENSITIVITY = 0.006; // radians per pixel
const STICK_RADIUS = 60; // pixels

export function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0 || window.matchMedia?.('(pointer: coarse)').matches;
}

function capture(e) {
  try {
    e.target.setPointerCapture?.(e.pointerId);
  } catch {
    /* not critical: events still reach the controls */
  }
}

export function createTouchInput(root, { onMap } = {}) {
  root.classList.add('touch');
  const ui = document.createElement('div');
  ui.className = 'touch-ui';
  ui.innerHTML = `
    <div class="zone zone-move" data-zone="move"></div>
    <div class="zone zone-look" data-zone="look"></div>
    <div class="stick-base"><div class="stick-knob"></div></div>
    <button class="touch-btn btn-jump" type="button">Jump</button>
    <button class="touch-btn btn-map" type="button">Map</button>
  `;
  root.appendChild(ui);

  const base = ui.querySelector('.stick-base');
  const knob = ui.querySelector('.stick-knob');
  const jumpBtn = ui.querySelector('.btn-jump');
  const mapBtn = ui.querySelector('.btn-map');

  let move = null; // { id, ox, oy, dx, dy }
  const looks = new Map(); // pointerId -> {x, y}
  let lookX = 0;
  let lookY = 0;
  let jump = false;

  ui.querySelector('.zone-move').addEventListener('pointerdown', (e) => {
    if (move) return;
    move = { id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 };
    base.style.left = `${e.clientX}px`;
    base.style.top = `${e.clientY}px`;
    knob.style.transform = 'translate(-50%, -50%)';
    base.classList.add('on');
    capture(e);
    e.preventDefault();
  });
  ui.querySelector('.zone-look').addEventListener('pointerdown', (e) => {
    looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
    capture(e);
    e.preventDefault();
  });

  ui.addEventListener('pointermove', (e) => {
    if (move && e.pointerId === move.id) {
      let dx = e.clientX - move.ox;
      let dy = e.clientY - move.oy;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) {
        dx = (dx / len) * STICK_RADIUS;
        dy = (dy / len) * STICK_RADIUS;
      }
      move.dx = dx;
      move.dy = dy;
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    }
    const l = looks.get(e.pointerId);
    if (l) {
      lookX += e.clientX - l.x;
      lookY += e.clientY - l.y;
      l.x = e.clientX;
      l.y = e.clientY;
    }
  });
  const end = (e) => {
    if (move && e.pointerId === move.id) {
      move = null;
      base.classList.remove('on');
    }
    looks.delete(e.pointerId);
  };
  ui.addEventListener('pointerup', end);
  ui.addEventListener('pointercancel', end);

  jumpBtn.addEventListener('pointerdown', (e) => {
    jump = true;
    e.preventDefault();
  });
  const jumpOff = () => (jump = false);
  jumpBtn.addEventListener('pointerup', jumpOff);
  jumpBtn.addEventListener('pointercancel', jumpOff);
  jumpBtn.addEventListener('pointerleave', jumpOff);
  mapBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    onMap?.();
  });

  // Stop the page from scrolling/zooming while playing.
  ui.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  ui.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  return {
    sample() {
      const fx = move ? move.dx / STICK_RADIUS : 0;
      const fy = move ? -move.dy / STICK_RADIUS : 0;
      const out = {
        forward: Math.abs(fy) < 0.15 ? 0 : fy,
        strafe: Math.abs(fx) < 0.15 ? 0 : fx,
        run: move ? Math.hypot(fx, fy) > 0.95 : false,
        jump,
        lookX: lookX * LOOK_SENSITIVITY,
        lookY: lookY * LOOK_SENSITIVITY,
      };
      lookX = lookY = 0;
      return out;
    },
  };
}
