// Editing operations on level data (no drawing code here, so they can be tested).
import { rectContains, sharedEdge, compassPoint, arcSweep, DIRECTIONS } from '../level/geometry.js';
import { DEFAULTS } from '../level/validate.js';

export const SECTIONS = ['rooms', 'doors', 'triggers', 'chasms', 'water', 'walls', 'stairs', 'ramps', 'platforms', 'ladders', 'curves', 'pillars', 'items'];
const CONTENT_TYPES = ['chasms', 'water', 'walls', 'stairs', 'ramps', 'platforms', 'ladders', 'curves', 'pillars', 'items', 'triggers'];

export const ROOM_COLORS = ['#f2e2b8', '#cfe6d2', '#d6dcf5', '#f5d6dc', '#d2ecef', '#efe0f5', '#e3f0d0', '#f7e3cc', '#dfe3e8', '#e8d8f0'];

/** Makes sure every section exists, so the editor can add to it. */
export function normalize(data) {
  const out = structuredClone(data || {});
  out.name ??= 'EpiPalace';
  out.defaults = { ...DEFAULTS, ...(out.defaults || {}) };
  for (const k of SECTIONS) out[k] ??= [];
  out.spawn ??= { x: 0, z: 0, facing: 'north' };
  return out;
}

/** Drops empty optional sections so the saved file stays tidy. */
export function tidy(data) {
  const out = structuredClone(data);
  for (const k of CONTENT_TYPES) {
    if (Array.isArray(out[k]) && out[k].length === 0) delete out[k];
  }
  return out;
}

export function blankLevel() {
  return normalize({
    name: 'New palace',
    rooms: [{ id: 1, name: 'Room 1', x: 0, z: 0, w: 10, d: 8, color: ROOM_COLORS[0] }],
    spawn: { x: 5, z: 6, facing: 'north' },
  });
}

export const nextId = (list) => list.reduce((m, o) => Math.max(m, o.id || 0), 0) + 1;

export function roomAt(data, x, z) {
  return data.rooms.find((r) => rectContains(r, x, z)) || null;
}

const inside = (r, x, z) => x >= r.x - 1e-6 && x <= r.x + r.w + 1e-6 && z >= r.z - 1e-6 && z <= r.z + r.d + 1e-6;

/** A representative point for any object (used to decide which room it belongs to). */
export function anchor(type, o) {
  switch (type) {
    case 'rooms':
    case 'chasms':
    case 'stairs':
    case 'ramps':
    case 'pillars':
    case 'platforms':
    case 'water':
      return { x: o.x + o.w / 2, z: o.z + o.d / 2 };
    case 'walls':
      return { x: (o.x1 + o.x2) / 2, z: (o.z1 + o.z2) / 2 };
    case 'curves':
      return { x: o.cx, z: o.cz };
    case 'items':
    case 'ladders':
    case 'triggers':
      return { x: o.x, z: o.z };
    default:
      return null;
  }
}

/** Moves any object by (dx, dz). */
export function moveObject(type, o, dx, dz) {
  if (type === 'walls') {
    o.x1 += dx;
    o.x2 += dx;
    o.z1 += dz;
    o.z2 += dz;
  } else if (type === 'curves') {
    o.cx += dx;
    o.cz += dz;
  } else if ('x' in o) {
    o.x += dx;
    o.z += dz;
  }
  if (type === 'chasms' && o.respawn) {
    o.respawn.x += dx;
    o.respawn.z += dz;
  }
}

/** Moves a room together with everything inside it (stairs, items, pillars, ...). */
export function moveRoomWithContents(data, room, dx, dz) {
  const before = { ...room };
  for (const type of CONTENT_TYPES) {
    for (const o of data[type]) {
      const a = anchor(type, o);
      if (a && inside(before, a.x, a.z)) moveObject(type, o, dx, dz);
    }
  }
  if (inside(before, data.spawn.x, data.spawn.z)) {
    data.spawn.x += dx;
    data.spawn.z += dz;
  }
  room.x += dx;
  room.z += dz;
}

/** Changes a room's number and updates every reference to it. */
export function renumberRoom(data, room, newId) {
  if (!Number.isInteger(newId) || newId < 1) return 'Room numbers must be whole numbers, 1 or more.';
  if (data.rooms.some((r) => r !== room && r.id === newId)) return `Room ${newId} already exists.`;
  const old = room.id;
  room.id = newId;
  for (const d of data.doors) d.between = d.between.map((id) => (id === old ? newId : id));
  for (const c of data.chasms) if (c.room === old) c.room = newId;
  for (const it of data.items) if (it.room === old) it.room = newId;
  return null;
}

/** Deletes a room and the doors that led to it. */
export function deleteRoom(data, room) {
  data.rooms = data.rooms.filter((r) => r !== room);
  data.doors = data.doors.filter((d) => !d.between.includes(room.id));
}

/** After objects move, re-attach chasms and items to whichever room they are now in. */
export function reattach(data) {
  for (const c of data.chasms) {
    const r = roomAt(data, c.x + c.w / 2, c.z + c.d / 2);
    if (r) c.room = r.id;
  }
  for (const it of data.items) {
    const r = roomAt(data, it.x, it.z);
    if (r) it.room = r.id;
  }
}

/**
 * Finds the wall shared by two rooms near point (x, z), for placing a door.
 * Returns { between: [a, b], offset, edge } or null.
 */
export function doorSpotAt(data, x, z, tolerance = 0.6) {
  let best = null;
  for (let i = 0; i < data.rooms.length; i++) {
    for (let j = i + 1; j < data.rooms.length; j++) {
      const a = data.rooms[i];
      const b = data.rooms[j];
      const e = sharedEdge(a, b);
      if (!e) continue;
      const along = e.orient === 'h' ? x : z;
      const across = e.orient === 'h' ? z : x;
      const dist = Math.abs(across - e.line);
      if (dist > tolerance || along < e.from || along > e.to) continue;
      if (!best || dist < best.dist) {
        best = { between: [a.id, b.id], offset: along - (e.from + e.to) / 2, edge: e, dist };
      }
    }
  }
  return best;
}

/** Where a door is drawn: its edge and the gap's start/end along the edge. */
export function doorGeometry(data, door) {
  const a = data.rooms.find((r) => r.id === door.between[0]);
  const b = data.rooms.find((r) => r.id === door.between[1]);
  if (!a || !b) return null;
  const edge = sharedEdge(a, b);
  if (!edge) return { broken: true, a, b };
  const width = door.width ?? data.defaults.doorWidth;
  const centre = (edge.from + edge.to) / 2 + (door.offset ?? 0);
  return { edge, from: centre - width / 2, to: centre + width / 2, centre, width };
}

/** Picks a safe respawn spot for a chasm: on the room's floor, 1 m clear of the hole. */
export function autoRespawn(data, chasm) {
  const room = roomAt(data, chasm.x + chasm.w / 2, chasm.z + chasm.d / 2);
  if (!room) return { x: chasm.x - 1.5, z: chasm.z + chasm.d / 2, facing: 'east' };
  const candidates = [
    { x: chasm.x - 1.5, z: chasm.z + chasm.d / 2, facing: 'east' },
    { x: chasm.x + chasm.w + 1.5, z: chasm.z + chasm.d / 2, facing: 'west' },
    { x: chasm.x + chasm.w / 2, z: chasm.z - 1.5, facing: 'south' },
    { x: chasm.x + chasm.w / 2, z: chasm.z + chasm.d + 1.5, facing: 'north' },
  ];
  const ok = candidates.filter((p) => p.x > room.x + 0.6 && p.x < room.x + room.w - 0.6 && p.z > room.z + 0.6 && p.z < room.z + room.d - 0.6);
  return ok[0] || candidates[0];
}

/** Distance from point to a curved wall's centre line, or Infinity if outside its sweep. */
export function distanceToCurve(c, x, z) {
  const ang = ((Math.atan2(x - c.cx, -(z - c.cz)) * 180) / Math.PI + 360) % 360;
  const rel = (((ang - c.start) % 360) + 360) % 360;
  if (rel > arcSweep(c.start, c.end)) return Infinity;
  return Math.abs(Math.hypot(x - c.cx, z - c.cz) - c.r);
}

export function distanceToSegment(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const L = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / L));
  return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
}

export function curveEnds(c) {
  const sweep = arcSweep(c.start, c.end);
  return {
    start: compassPoint(c.cx, c.cz, c.r, c.start),
    end: compassPoint(c.cx, c.cz, c.r, c.start + sweep),
    mid: compassPoint(c.cx, c.cz, c.r, c.start + sweep / 2),
    sweep,
  };
}

/** Compass angle (0 = north, clockwise) from a centre to a point. */
export function compassAngle(cx, cz, x, z) {
  return ((Math.atan2(x - cx, -(z - cz)) * 180) / Math.PI + 360) % 360;
}

/** Stairs/ramp facts for the info line. */
export function slopeInfo(data, st, kind) {
  const room = roomAt(data, st.x + st.w / 2, st.z + st.d / 2);
  const bottom = st.bottom ?? room?.floor ?? 0;
  const rise = st.top - bottom;
  const run = st.up === 'north' || st.up === 'south' ? st.d : st.w;
  const deg = (Math.atan2(rise, run) * 180) / Math.PI;
  if (kind === 'stairs') {
    const n = Math.max(1, Math.round(rise / data.defaults.stepHeight));
    return `${n} steps, each ${((rise / n) * 100).toFixed(0)} cm high and ${((run / n) * 100).toFixed(0)} cm deep (${deg.toFixed(0)}°), from ${bottom} m up to ${st.top} m.`;
  }
  return `Slope ${deg.toFixed(0)}° (rises ${rise.toFixed(2)} m over ${run} m), from ${bottom} m up to ${st.top} m.`;
}

export { DIRECTIONS };

// ---------------------------------------------------------------------------------------------
// Rotating a room a quarter-turn clockwise (as seen on the map), with everything inside it
// ---------------------------------------------------------------------------------------------
const CW = { north: 'east', east: 'south', south: 'west', west: 'north' };
const turnFacing = (f) => (typeof f === 'number' ? (f + 90) % 360 : CW[f ?? 'north']);

export function rotateRoom90(data, room) {
  const cx = room.x + room.w / 2;
  const cz = room.z + room.d / 2;
  const before = { ...room };
  const P = (x, z) => ({ x: r3(cx - (z - cz)), z: r3(cz + (x - cx)) }); // clockwise on the map
  const R = (o) => {
    const a = P(o.x, o.z);
    const b = P(o.x + o.w, o.z + o.d);
    return { x: Math.min(a.x, b.x), z: Math.min(a.z, b.z), w: o.d, d: o.w };
  };
  for (const type of CONTENT_TYPES) {
    for (const o of data[type]) {
      const a = anchor(type, o);
      if (!a || !inside(before, a.x, a.z)) continue;
      if (['chasms', 'water', 'stairs', 'ramps', 'platforms', 'pillars'].includes(type)) {
        Object.assign(o, R(o));
        if (o.up) o.up = CW[o.up];
        if (type === 'pillars') [o.rows, o.cols] = [o.cols, o.rows];
        if (o.railings) o.railings = o.railings.map((sd) => CW[sd]);
        if (o.respawn) Object.assign(o.respawn, P(o.respawn.x, o.respawn.z), { facing: turnFacing(o.respawn.facing) });
      } else if (type === 'walls') {
        const a1 = P(o.x1, o.z1);
        const a2 = P(o.x2, o.z2);
        Object.assign(o, { x1: a1.x, z1: a1.z, x2: a2.x, z2: a2.z });
      } else if (type === 'curves') {
        Object.assign(o, (({ x, z }) => ({ cx: x, cz: z }))(P(o.cx, o.cz)));
        o.start = (o.start + 90) % 360;
        o.end = (o.end + 90) % 360;
      } else {
        Object.assign(o, P(o.x, o.z));
        if (o.facing) o.facing = turnFacing(o.facing);
      }
    }
  }
  if (inside(before, data.spawn.x, data.spawn.z)) Object.assign(data.spawn, P(data.spawn.x, data.spawn.z), { facing: turnFacing(data.spawn.facing) });
  if (room.sides) room.sides = Object.fromEntries(Object.entries(room.sides).map(([k, v]) => [CW[k], v]));
  Object.assign(room, { x: r3(cx - room.d / 2), z: r3(cz - room.w / 2), w: room.d, d: room.w });
}
const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Where a ladder clicked at (x, z) should go: on the nearest room wall or platform edge
 * (within 1.2 m), facing it. Returns { x, z, facing, top } or null.
 */
export function ladderSpotAt(data, x, z) {
  const room = roomAt(data, x, z);
  if (!room) return null;
  const t = data.defaults.wallThickness / 2;
  const cands = [];
  const edgesOf = (o, inner, topFor) => {
    // inner: the ladder stands inside the rectangle (room walls); otherwise outside (platform edges)
    const s = inner ? 1 : -1;
    cands.push({ d: Math.abs(z - o.z), x, z: o.z + s * (inner ? t : 0), facing: inner ? 'north' : 'south', top: topFor, along: [o.x, o.x + o.w], v: x });
    cands.push({ d: Math.abs(z - (o.z + o.d)), x, z: o.z + o.d - s * (inner ? t : 0), facing: inner ? 'south' : 'north', top: topFor, along: [o.x, o.x + o.w], v: x });
    cands.push({ d: Math.abs(x - o.x), x: o.x + s * (inner ? t : 0), z, facing: inner ? 'west' : 'east', top: topFor, along: [o.z, o.z + o.d], v: z });
    cands.push({ d: Math.abs(x - (o.x + o.w)), x: o.x + o.w - s * (inner ? t : 0), z, facing: inner ? 'east' : 'west', top: topFor, along: [o.z, o.z + o.d], v: z });
  };
  for (const pf of data.platforms) if (roomAt(data, pf.x + pf.w / 2, pf.z + pf.d / 2) === room) edgesOf(pf, false, pf.top);
  edgesOf(room, true, r3((room.floor ?? 0) + 3));
  const ok = cands.filter((c) => c.d <= 1.2 && c.v >= c.along[0] + 0.4 && c.v <= c.along[1] - 0.4).sort((a, b) => a.d - b.d);
  if (!ok.length) return null;
  const c = ok[0];
  return { x: r3(c.x), z: r3(c.z), facing: c.facing, top: c.top };
}
