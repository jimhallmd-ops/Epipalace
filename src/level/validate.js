// Checks a level file for mistakes and returns a list of plain-English problems.
// An empty list means the level is fine. The game refuses to start (and the
// Netlify deploy fails its tests) if any problem is found.

import { rectsOverlap, rectInside, rectContains, sharedEdge, EPS } from './geometry.js';

export const DEFAULTS = {
  height: 4,
  wallThickness: 0.3,
  floorThickness: 0.3,
  ceilingThickness: 0.3,
  doorWidth: 1.6,
  doorHeight: 2.6,
  chasmDepth: 14,
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
    if (Math.abs((a.floor ?? 0) - (b.floor ?? 0)) > EPS) {
      errors.push(`${label}: both rooms must have the same floor height (stairs are not supported yet).`);
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
    if (Math.abs(w.x1 - w.x2) > EPS && Math.abs(w.z1 - w.z2) > EPS) {
      errors.push(`${label}: must run straight east-west or north-south.`);
    }
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

  const s = data.spawn;
  if (!s || !isNum(s.x) || !isNum(s.z)) errors.push('spawn needs { x, z }.');
  else if (!roomAt(s.x, s.z)) errors.push('spawn is not inside any room.');
  else if (inChasm(s.x, s.z, 0.5)) errors.push('spawn is in or too close to a chasm.');

  return errors;
}
