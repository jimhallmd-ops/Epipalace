// Keyboard + mouse controls.
// WASD / arrow keys move, Shift runs, Space jumps, mouse looks (after clicking into the game),
// ESC frees the mouse cursor (the browser does this automatically for pointer lock).

const MOUSE_SENSITIVITY = 0.0022; // radians per pixel

export function createDesktopInput(canvas) {
  const keys = new Set();
  let usePressed = false; // E is acted on once per press, not while held
  let lookX = 0;
  let lookY = 0;
  let dragging = false;
  let lastX = null;
  let lastY = null;

  const isLocked = () => document.pointerLockElement === canvas;

  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'KeyE' && !e.repeat) usePressed = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear()); // avoid "stuck" keys after alt-tab

  // Chrome sends one bogus, huge mouse movement right when the mouse is captured.
  // Ignore movement for a moment after capture changes, and any impossible jump.
  let ignoreUntil = 0;
  document.addEventListener('pointerlockchange', () => (ignoreUntil = performance.now() + 120));

  document.addEventListener('mousemove', (e) => {
    if (isLocked()) {
      const mx = e.movementX || 0;
      const my = e.movementY || 0;
      if (performance.now() < ignoreUntil || Math.abs(mx) > 300 || Math.abs(my) > 300) return;
      lookX += mx;
      lookY += my;
    } else if (dragging) {
      // Some browsers do not report movementX while dragging, so measure it ourselves.
      if (lastX !== null) {
        lookX += e.clientX - lastX;
        lookY += e.clientY - lastY;
      }
      lastX = e.clientX;
      lastY = e.clientY;
    }
  });
  // Fallback when the browser refuses pointer lock: hold the mouse button and drag to look.
  canvas.addEventListener('mousedown', (e) => {
    if (!isLocked()) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    }
  });
  window.addEventListener('mouseup', () => {
    dragging = false;
    lastX = lastY = null;
  });

  return {
    isLocked,
    requestLock() {
      try {
        const res = canvas.requestPointerLock?.();
        if (res && typeof res.catch === 'function') res.catch(() => {});
      } catch {
        /* drag-to-look still works */
      }
    },
    /** Returns this frame's input and resets the mouse movement. */
    sample() {
      const k = (...codes) => codes.some((c) => keys.has(c));
      const out = {
        forward: (k('KeyW', 'ArrowUp') ? 1 : 0) - (k('KeyS', 'ArrowDown') ? 1 : 0),
        strafe: (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0),
        run: k('ShiftLeft', 'ShiftRight'),
        jump: k('Space'),
        down: k('KeyC'),
        use: usePressed,
        lookX: lookX * MOUSE_SENSITIVITY,
        lookY: lookY * MOUSE_SENSITIVITY,
      };
      lookX = lookY = 0;
      usePressed = false;
      return out;
    },
  };
}
