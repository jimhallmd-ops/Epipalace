// Checks a level file for mistakes and returns a list of plain-English problems.
// An empty list means the level is fine. The game refuses to start (and the
// Netlify deploy fails its tests) if any problem is found.

import { rectsOverlap, rectInside, rectContains, sharedEdge, EPS, DIRECTIONS, runLength, compassPoint, arcSweep, edgeSideOf } from './geometry.js';

// Recommended proportions (see PROJECT.md, "Proportions"). A level file can override any of them.
export const DEFAULTS = {
  height: 3.5, // floor to ceiling, ordinary room
  wallThickness: 0.3,
  floorThickness: 0.3,
  ceilingThickness: 0.3,
  doorWidth: 1.2,
  doorHeight: 2.4,
  chasmDepth: 14,
  stepHeight: 0.18, // target height of one stair step
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function validateLevel(data) {
  const errors = [];
  const d = { ...DEFAULTS, ...(data.defaults || {}) };

  if (d.wallThickness < 0.2) errors.push('defaults.wallThickness must be at least 0.2 m.');
  if (!Array.isArray(data.rooms) || data.rooms.length === 0) {
    errors.push('The level needs at least one room.');
    return errors;
  }

  const byId = new Map();
  for (const r of data.rooms) {
    const label = `Room ${r.id ?? '?'}`;
    if (!Number.isInteger(r.id) || r.id < 1) errors.push(`${label}: id must be a whole number 1 or higher.`);
    else if (byId.has(r.id)) errors.push(`${label}: the id ${r.id} is used twice.`);
    else byId.set(r.id, r);
    for (const k of ['x', 'z', 'w', 'd']) if (!isNum(r[k])) errors.push(`${label}: "${k}" must be a number.`);
    if (isNum(r.w) && r.w < 1) errors.push(`${label}: width w must be at least 1 m.`);
    if (isNum(r.d) && r.d < 1) errors.push(`${label}: depth d must be at least 1 m.`);
    const h = r.height ?? d.height;
    if (!isNum(h) || h < d.doorHeight + 0.2) errors.push(`${label}: height must be at least ${d.doorHeight + 0.2} m.`);
  }
  if (errors.length) return errors;

  const SIDE_MODES = ['wall', 'open', 'railing'];
  for (const r of data.rooms) {
    for (const [side, mode] of Object.entries(r.sides || {})) {
      if (!DIRECTIONS.includes(side)) errors.push(`Room ${r.id}: unknown side "${side}" (use north, east, south or west).`);
      else if (!SIDE_MODES.includes(mode)) errors.push(`Room ${r.id}: the ${side} side must be "wall", "open" or "railing".`);
    }
  }
  const rooms = [...byId.values()];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (rectsOverlap(rooms[i], rooms[j])) errors.push(`Room ${rooms[i].id} and Room ${rooms[j].id} overlap.`);
    }
  }

  const doorWidthOk = [];
  for (const [n, door] of (data.doors || []).entries()) {
    const label = `Door ${n + 1} (between ${JSON.stringify(door.between)})`;
    const [a, b] = (door.between || []).map((id) => byId.get(id));
    if (!a || !b || door.between.length !== 2 || a === b) {
      errors.push(`${label}: "between" must name two different existing rooms.`);
      continue;
    }
    const edge = sharedEdge(a, b);
    if (!edge) {
      errors.push(`${label}: Room ${a.id} and Room ${b.id} do not touch, so there is no wall to put a door in.`);
      continue;
    }
    for (const r of [a, b]) {
      const mode = r.sides?.[edgeSideOf(r, edge)];
      if (mode === 'open' || mode === 'railing') errors.push(`${label}: Room ${r.id}'s side there is ${mode}, so there is no wall to put a door in.`);
    }
    if (door.leaf && !['none', 'swing', 'slide', 'secret'].includes(door.leaf)) errors.push(`${label}: "leaf" must be none, swing, slide or secret.`);
    if (door.opens && !['use', 'auto'].includes(door.opens)) errors.push(`${label}: "opens" must be use or auto.`);
    const triggerNames = new Set((data.triggers || []).map((tr) => tr.name));
    if (door.trigger && !triggerNames.has(door.trigger)) errors.push(`${label}: there is no trigger called "${door.trigger}".`);
    if (door.leaf === 'secret' && !door.trigger) errors.push(`${label}: a secret door needs a trigger (a lever or plate), or it could never open.`);
    const doorFloor = Math.max(a.floor ?? 0, b.floor ?? 0);
    const doorTop = doorFloor + (door.height ?? d.doorHeight);
    for (const r of [a, b]) {
      if (doorTop > (r.floor ?? 0) + (r.height ?? d.height) - 0.1) {
        errors.push(`${label}: the door is too tall for Room ${r.id} (its ceiling is lower than the top of the door).`);
      }
    }
    const width = door.width ?? d.doorWidth;
    const centre = (edge.from + edge.to) / 2 + (door.offset ?? 0);
    const lo = centre - width / 2;
    const hi = centre + width / 2;
    if (width < 0.9) errors.push(`${label}: width must be at least 0.9 m so the player fits.`);
    if (lo < edge.from + d.wallThickness - EPS || hi > edge.to - d.wallThickness + EPS) {
      errors.push(
        `${label}: the door (${width} m wide) does not fit in the shared wall, which is ${(edge.to - edge.from).toFixed(2)} m long. ` +
          `Leave at least ${d.wallThickness} m of wall on each side.`
      );
    }
    doorWidthOk.push(door);
  }

  const roomAt = (x, z) => rooms.find((r) => rectContains(r, x, z));
  const chasms = data.chasms || [];
  const inChasm = (x, z, margin = 0) => chasms.some((c) => rectContains(c, x, z, margin));

  for (const [n, c] of chasms.entries()) {
    const label = `Chasm ${n + 1}`;
    const room = byId.get(c.room);
    if (!room) {
      errors.push(`${label}: "room" must name an existing room.`);
      continue;
    }
    for (const k of ['x', 'z', 'w', 'd']) if (!isNum(c[k])) errors.push(`${label}: "${k}" must be a number.`);
    if (!rectInside(c, room)) errors.push(`${label}: must lie completely inside Room ${room.id}.`);
    if (!c.respawn || !isNum(c.respawn.x) || !isNum(c.respawn.z)) {
      errors.push(`${label}: needs a respawn point { x, z } on solid floor.`);
    } else {
      const rr = roomAt(c.respawn.x, c.respawn.z);
      if (!rr) errors.push(`${label}: respawn point is not inside any room.`);
      else if (inChasm(c.respawn.x, c.respawn.z, 0.5)) errors.push(`${label}: respawn point is too close to a chasm.`);
    }
  }

  for (const [n, w] of (data.walls || []).entries()) {
    const label = `Wall ${n + 1}`;
    for (const k of ['x1', 'z1', 'x2', 'z2']) if (!isNum(w[k])) errors.push(`${label}: "${k}" must be a number.`);
    if (Math.hypot(w.x2 - w.x1, w.z2 - w.z1) < 0.3) errors.push(`${label}: must be at least 0.3 m long.`);
    if (w.style && !['solid', 'railing'].includes(w.style)) errors.push(`${label}: style must be "solid" or "railing".`);
    if (!roomAt((w.x1 + w.x2) / 2, (w.z1 + w.z2) / 2)) errors.push(`${label}: its middle is not inside any room.`);
  }

  const itemIds = new Set();
  for (const it of data.items || []) {
    const label = `Item ${it.id}`;
    if (itemIds.has(it.id)) errors.push(`${label}: the id is used twice.`);
    itemIds.add(it.id);
    const room = byId.get(it.room);
    if (!room) errors.push(`${label}: "room" must name an existing room.`);
    else if (!rectContains(room, it.x, it.z, -0.6)) errors.push(`${label}: must be inside Room ${room.id}, at least 0.6 m from its walls.`);
    if (inChasm(it.x, it.z, 0.5)) errors.push(`${label}: is in or too close to a chasm.`);
  }

  const inOneRoom = (rect) => rooms.find((r) => rectInside(rect, r));

  for (const [kind, list] of [
    ['Stairs', data.stairs || []],
    ['Ramp', data.ramps || []],
  ]) {
    for (const [n, st] of list.entries()) {
      const label = `${kind} ${n + 1}`;
      const bad = ['x', 'z', 'w', 'd', 'top'].filter((k) => !isNum(st[k]));
      if (bad.length) {
        errors.push(`${label}: ${bad.join(', ')} must be numbers.`);
        continue;
      }
      if (!DIRECTIONS.includes(st.up)) errors.push(`${label}: "up" must be north, east, south or west.`);
      const room = inOneRoom(st);
      if (!room) {
        errors.push(`${label}: must lie completely inside one room.`);
        continue;
      }
      const bottom = st.bottom ?? room.floor ?? 0;
      const rise = st.top - bottom;
      if (rise <= 0.05) errors.push(`${label}: its top (${st.top} m) must be higher than its bottom (${bottom} m).`);
      if (st.top > (room.floor ?? 0) + (room.height ?? d.height) - 2) {
        errors.push(`${label}: the top is too close to Room ${room.id}'s ceiling to stand on (needs 2 m of head room).`);
      }
      if (st.w < 0.9 || st.d < 0.9) errors.push(`${label}: must be at least 0.9 m wide.`);
      if (DIRECTIONS.includes(st.up) && rise > 0) {
        const run = runLength(st, st.up);
        if (kind === 'Stairs') {
          const steps = Math.max(1, Math.round(rise / d.stepHeight));
          if (run / steps < 0.2) {
            errors.push(`${label}: too steep (${steps} steps in ${run} m). Make it at least ${(steps * 0.25).toFixed(1)} m long, or lower.`);
          }
        } else {
          const deg = (Math.atan2(rise, run) * 180) / Math.PI;
          if (deg > 40) errors.push(`${label}: too steep (${deg.toFixed(0)}°). Keep ramps under 40°; make it longer.`);
        }
      }
    }
  }

  for (const [n, c] of (data.curves || []).entries()) {
    const label = `Curved wall ${n + 1}`;
    const bad = ['cx', 'cz', 'r', 'start', 'end'].filter((k) => !isNum(c[k]));
    if (bad.length) {
      errors.push(`${label}: ${bad.join(', ')} must be numbers.`);
      continue;
    }
    if (c.r < 0.5) errors.push(`${label}: radius must be at least 0.5 m.`);
    const mid = compassPoint(c.cx, c.cz, c.r, c.start + arcSweep(c.start, c.end) / 2);
    if (!roomAt(mid.x, mid.z)) errors.push(`${label}: the middle of the curve is not inside any room.`);
  }

  for (const [n, pg] of (data.pillars || []).entries()) {
    const label = `Pillar grid ${n + 1}`;
    const bad = ['x', 'z', 'w', 'd', 'rows', 'cols'].filter((k) => !isNum(pg[k]));
    if (bad.length) {
      errors.push(`${label}: ${bad.join(', ')} must be numbers.`);
      continue;
    }
    if (!Number.isInteger(pg.rows) || !Number.isInteger(pg.cols) || pg.rows < 1 || pg.cols < 1 || pg.rows * pg.cols > 400) {
      errors.push(`${label}: rows and columns must be whole numbers (1 or more, at most 400 pillars).`);
    }
    const size = pg.size ?? 0.6;
    if (size < 0.2 || size > 4) errors.push(`${label}: pillar size must be between 0.2 and 4 m.`);
    if (!inOneRoom(pg)) errors.push(`${label}: must lie completely inside one room.`);
  }

  for (const [n, pf] of (data.platforms || []).entries()) {
    const label = `Platform ${n + 1}`;
    const bad = ['x', 'z', 'w', 'd', 'top'].filter((k) => !isNum(pf[k]));
    if (bad.length) {
      errors.push(`${label}: ${bad.join(', ')} must be numbers.`);
      continue;
    }
    const room = inOneRoom(pf);
    if (!room) {
      errors.push(`${label}: must lie completely inside one room.`);
      continue;
    }
    const floor = room.floor ?? 0;
    if (pf.top <= floor + 0.05) errors.push(`${label}: its top (${pf.top} m) must be above Room ${room.id}'s floor (${floor} m).`);
    if (!room.sky && pf.top > floor + (room.height ?? d.height) - 2) errors.push(`${label}: too close to Room ${room.id}'s ceiling to stand on (needs 2 m of head room).`);
    if (pf.under === 'open' && pf.top - floor < 2.3) errors.push(`${label}: to walk underneath ("under: open") its top must be at least 2.3 m above the floor.`);
    for (const side of pf.railings || []) if (!DIRECTIONS.includes(side)) errors.push(`${label}: railing side "${side}" must be north, east, south or west.`);
  }

  for (const [n, l] of (data.ladders || []).entries()) {
    const label = `Ladder ${n + 1}`;
    const bad = ['x', 'z', 'top'].filter((k) => !isNum(l[k]));
    if (bad.length) {
      errors.push(`${label}: ${bad.join(', ')} must be numbers.`);
      continue;
    }
    if (!DIRECTIONS.includes(l.facing)) {
      errors.push(`${label}: "facing" must be north, east, south or west (the way you face while climbing).`);
      continue;
    }
    const room = roomAt(l.x, l.z);
    if (!room) errors.push(`${label}: is not inside any room.`);
    else if (l.top <= (l.bottom ?? room.floor ?? 0) + 0.3) errors.push(`${label}: its top must be at least 0.3 m above its bottom.`);
  }

  for (const [n, wt] of (data.water || []).entries()) {
    const label = `Water ${n + 1}`;
    const bad = ['x', 'z', 'w', 'd', 'depth'].filter((k) => !isNum(wt[k]));
    if (bad.length) {
      errors.push(`${label}: ${bad.join(', ')} must be numbers.`);
      continue;
    }
    if (!inOneRoom(wt)) errors.push(`${label}: must lie completely inside one room.`);
    if (wt.depth < 0.3 || wt.depth > 20) errors.push(`${label}: depth must be between 0.3 and 20 m.`);
    for (const c of chasms) if (rectsOverlap(wt, c)) errors.push(`${label}: overlaps a chasm.`);
  }

  const triggerNames = new Set();
  for (const [n, tr] of (data.triggers || []).entries()) {
    const label = `Trigger ${n + 1}${tr.name ? ` ("${tr.name}")` : ''}`;
    if (!tr.name || typeof tr.name !== 'string') errors.push(`${label}: needs a name, so doors can refer to it.`);
    else if (triggerNames.has(tr.name)) errors.push(`${label}: the name "${tr.name}" is used twice.`);
    triggerNames.add(tr.name);
    if (!['lever', 'plate'].includes(tr.type ?? 'lever')) errors.push(`${label}: type must be "lever" or "plate".`);
    if (!isNum(tr.x) || !isNum(tr.z) || !roomAt(tr.x, tr.z)) errors.push(`${label}: must be inside a room.`);
  }

  const s = data.spawn;
  if (!s || !isNum(s.x) || !isNum(s.z)) errors.push('spawn needs { x, z }.');
  else if (!roomAt(s.x, s.z)) errors.push('spawn is not inside any room.');
  else if (inChasm(s.x, s.z, 0.5)) errors.push('spawn is in or too close to a chasm.');

  return errors;
}
