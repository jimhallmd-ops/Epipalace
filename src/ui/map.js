// Debug top-down map with numbered rooms. Press M (or the Map button on phones) to cycle:
// off -> small corner map -> full screen map -> off.
// Walls are drawn from the same boxes the collision uses, so gaps on the map are real gaps.

const MODES = ['off', 'corner', 'full'];

export function createMap(root, level) {
  const canvas = document.createElement('canvas');
  canvas.className = 'debug-map';
  root.appendChild(canvas);
  const g = canvas.getContext('2d');
  let mode = 'off';

  const pad = 2; // metres of margin
  const b = level.bounds;
  const worldW = b.maxX - b.minX + pad * 2;
  const worldD = b.maxZ - b.minZ + pad * 2;

  function setMode(m) {
    mode = m;
    canvas.dataset.mode = m;
    canvas.style.display = m === 'off' ? 'none' : 'block';
  }
  setMode('off');

  function draw(player, currentRoom) {
    if (mode === 'off') return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    const s = Math.min(canvas.width / worldW, canvas.height / worldD); // pixels per metre
    const ox = (canvas.width - worldW * s) / 2 - (b.minX - pad) * s;
    const oz = (canvas.height - worldD * s) / 2 - (b.minZ - pad) * s;
    const X = (x) => ox + x * s;
    const Z = (z) => oz + z * s;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = 'rgba(20, 30, 45, 0.93)';
    g.fillRect(0, 0, canvas.width, canvas.height);

    // Rooms
    for (const r of level.rooms) {
      g.fillStyle = r.color || '#e8e2d4';
      g.globalAlpha = currentRoom && currentRoom.id === r.id ? 1 : 0.8;
      g.fillRect(X(r.x), Z(r.z), r.w * s, r.d * s);
      g.globalAlpha = 1;
      if (currentRoom && currentRoom.id === r.id) {
        g.strokeStyle = '#ffb703';
        g.lineWidth = Math.max(2, s * 0.25);
        g.strokeRect(X(r.x), Z(r.z), r.w * s, r.d * s);
      }
    }

    // Chasms
    for (const c of level.chasms) {
      g.fillStyle = '#111';
      g.fillRect(X(c.x), Z(c.z), c.w * s, c.d * s);
      g.strokeStyle = '#e63946';
      g.lineWidth = Math.max(1, s * 0.08);
      g.beginPath();
      for (let k = -c.d; k < c.w; k += 0.8) {
        g.moveTo(X(c.x + Math.max(k, 0)), Z(c.z + Math.max(-k, 0)));
        g.lineTo(X(c.x + Math.min(k + c.d, c.w)), Z(c.z + Math.min(c.d, c.w - k)));
      }
      g.stroke();
      // respawn marker
      g.fillStyle = '#2a9d8f';
      g.beginPath();
      g.arc(X(c.respawn.x), Z(c.respawn.z), Math.max(3, s * 0.3), 0, Math.PI * 2);
      g.fill();
    }

    // Walls (from collision boxes)
    g.fillStyle = '#1b263b';
    for (const bx of level.boxes) {
      if (bx.kind !== 'wall') continue;
      g.fillRect(X(bx.min[0]), Z(bx.min[2]), (bx.max[0] - bx.min[0]) * s, (bx.max[2] - bx.min[2]) * s);
    }

    // Room numbers and names
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const r of level.rooms) {
      const cx = X(r.x + r.w / 2);
      const cz = Z(r.z + r.d / 2);
      const numSize = Math.max(12, Math.min(r.w, r.d) * s * 0.4);
      g.font = `bold ${numSize}px system-ui, sans-serif`;
      g.lineWidth = Math.max(2, numSize * 0.15);
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.strokeText(String(r.id), cx, cz);
      g.fillStyle = '#1d3557';
      g.fillText(String(r.id), cx, cz);
      if (mode === 'full') {
        const nameSize = Math.max(7, Math.min(numSize * 0.3, (r.w * s) / (r.name.length * 0.62)));
        g.font = `600 ${nameSize}px system-ui, sans-serif`;
        g.fillText(r.name, cx, cz + numSize * 0.65);
      }
    }

    // Items
    for (const it of level.items) {
      g.fillStyle = '#d4a62a';
      g.beginPath();
      g.arc(X(it.x), Z(it.z), Math.max(5, s * 0.5), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#000';
      g.font = `bold ${Math.max(9, s * 0.6)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(it.id), X(it.x), Z(it.z));
    }

    // Player arrow
    const px = X(player.x);
    const pz = Z(player.z);
    const len = Math.max(10, s * 1.2);
    // facing direction on the map: forward = (-sin yaw, -cos yaw)
    const fx = -Math.sin(player.yaw);
    const fz = -Math.cos(player.yaw);
    g.fillStyle = '#e63946';
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(px + fx * len, pz + fz * len);
    g.lineTo(px - fx * len * 0.5 + fz * len * 0.5, pz - fz * len * 0.5 - fx * len * 0.5);
    g.lineTo(px - fx * len * 0.5 - fz * len * 0.5, pz - fz * len * 0.5 + fx * len * 0.5);
    g.closePath();
    g.fill();
    g.stroke();

    if (mode === 'full') {
      g.fillStyle = '#fff';
      g.font = `600 ${14 * dpr}px system-ui, sans-serif`;
      g.textAlign = 'left';
      g.textBaseline = 'bottom';
      const h = canvas.height;
      g.fillText('N ↑   Debug map: press M or tap Map to close', 12 * dpr, h - 30 * dpr);
      g.fillText(`You: x ${player.x.toFixed(1)}, z ${player.z.toFixed(1)}`, 12 * dpr, h - 10 * dpr);
    }
  }

  return {
    draw,
    cycle() {
      setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
    },
    setMode,
    get mode() {
      return mode;
    },
  };
}
