// Turns a level file (see palace.js) into solid boxes.
//
// The SAME list of boxes is used for:
//   - drawing the 3D world (src/render/scene.js)
//   - collision (src/core/physics.js)
//   - the walls drawn on the debug map (src/ui/map.js)
// so what you see is always exactly what blocks you.
//
// A box is { min: [x, y, z], max: [x, y, z], kind, room }, where y is height
// above the ground and kind is one of:
//   'floor' | 'ceiling' | 'wall' | 'lintel' (wall above a door) | 'sill' (under a door)
//   'pit-wall' | 'pit-floor' (inside chasms) | 'item' (pedestal)
//   'stair' (one step) | 'ramp-step' (invisible small steps under a sloped ramp surface)
//   'curve' (one short piece of a curved wall) | 'pillar'
// Ramps, curved walls and round pillars are DRAWN smoothly from level.ramps / level.curves /
// level.pillars, while their collision uses these boxes (within a few centimetres of the surface).

import { validateLevel, DEFAULTS } from './validate.js';
import { rectContains, rectInside, subtractRect, sharedEdge, facingToYaw, EPS, sliceRect, runLength, compassPoint, arcSweep } from './geometry.js';

export function buildLevel(data) {
  const errors = validateLevel(data);
  if (errors.length) {
    const err = new Error('The level file has problems:\n- ' + errors.join('\n- '));
    err.levelErrors = errors;
    throw err;
  }

  const d = { ...DEFAULTS, ...(data.defaults || {}) };
  const t = d.wallThickness;
  const rooms = data.rooms.map((r) => ({ floor: 0, height: d.height, ...r }));
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const roomAt = (x, z) => rooms.find((r) => rectContains(r, x, z)) || null;
  const boxes = [];
  const box = (x0, y0, z0, x1, y1, z1, kind, room = null) =>
    boxes.push({
      min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
      max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
      kind,
      room,
    });

  // ---- Doors: find the wall the two rooms share and cut a gap in it ----
  const doors = (data.doors || []).map((door) => {
    const [a, b] = door.between.map((id) => byId.get(id));
    const edge = sharedEdge(a, b);
    const width = door.width ?? d.doorWidth;
    const centre = (edge.from + edge.to) / 2 + (door.offset ?? 0);
    // which room is on the low side (north for 'h', west for 'v')
    const aLow = edge.orient === 'h' ? a.z < edge.line : a.x < edge.line;
    return {
      rooms: [a.id, b.id],
      lowRoom: aLow ? a.id : b.id,
      highRoom: aLow ? b.id : a.id,
      orient: edge.orient,
      line: edge.line,
      from: centre - width / 2,
      to: centre + width / 2,
      centre,
      width,
      floor: Math.max(a.floor, b.floor), // a door between different heights sits at the higher floor
      height: door.height ?? d.doorHeight,
    };
  });

  // ---- Walls: collect every room edge onto shared "wall lines" ----
  // Two rooms that touch put their edges on the same line, so the wall between
  // them is built once (no double walls), and door gaps are cut from it.
  const lines = new Map();
  const lineFor = (orient, coord) => {
    const key = `${orient}:${Math.round(coord * 1000)}`;
    if (!lines.has(key)) lines.set(key, { orient, coord, spans: [], doors: [] });
    return lines.get(key);
  };
  for (const r of rooms) {
    const bottom = r.floor;
    const top = r.floor + r.height;
    lineFor('h', r.z).spans.push({ a: r.x, b: r.x + r.w, bottom, top });
    lineFor('h', r.z + r.d).spans.push({ a: r.x, b: r.x + r.w, bottom, top });
    lineFor('v', r.x).spans.push({ a: r.z, b: r.z + r.d, bottom, top });
    lineFor('v', r.x + r.w).spans.push({ a: r.z, b: r.z + r.d, bottom, top });
  }
  for (const door of doors) lineFor(door.orient, door.line).doors.push(door);

  for (const line of lines.values()) {
    const pts = new Set();
    for (const s of line.spans) pts.add(s.a).add(s.b);
    for (const dr of line.doors) pts.add(dr.from).add(dr.to);
    const sorted = [...pts].sort((p, q) => p - q);

    // Split the line into small pieces, then glue neighbouring pieces that are identical.
    const pieces = [];
    for (let i = 0; i + 1 < sorted.length; i++) {
      const p = sorted[i];
      const q = sorted[i + 1];
      if (q - p < EPS) continue;
      const mid = (p + q) / 2;
      const covering = line.spans.filter((s) => s.a <= mid && s.b >= mid);
      if (!covering.length) continue;
      const bottom = Math.min(...covering.map((s) => s.bottom)) - d.floorThickness;
      const top = Math.max(...covering.map((s) => s.top)) + d.ceilingThickness;
      const door = line.doors.find((dr) => dr.from <= mid && dr.to >= mid) || null;
      const last = pieces[pieces.length - 1];
      if (last && Math.abs(last.q - p) < EPS && last.bottom === bottom && last.top === top && last.door === door) {
        last.q = q;
      } else {
        pieces.push({ p, q, bottom, top, door });
      }
    }

    for (let i = 0; i < pieces.length; i++) {
      const pc = pieces[i];
      const c = line.coord;
      const emit = (p, q, y0, y1, kind) => {
        if (y1 - y0 < EPS) return;
        if (line.orient === 'h') box(p, y0, c - t / 2, q, y1, c + t / 2, kind);
        else box(c - t / 2, y0, p, c + t / 2, y1, q, kind);
      };
      if (pc.door) {
        emit(pc.p, pc.q, pc.door.floor + pc.door.height, pc.top, 'lintel');
        emit(pc.p, pc.q, pc.bottom, pc.door.floor, 'sill');
      } else {
        // East-west walls are stretched by half a wall thickness at each end so corners
        // are closed, except where the end touches a door gap (keeps doors full width).
        let p = pc.p;
        let q = pc.q;
        if (line.orient === 'h') {
          const prev = pieces[i - 1];
          const next = pieces[i + 1];
          if (!(prev && prev.door && Math.abs(prev.q - p) < EPS)) p -= t / 2;
          if (!(next && next.door && Math.abs(next.p - q) < EPS)) q += t / 2;
        }
        emit(p, q, pc.bottom, pc.top, 'wall');
      }
    }
  }

  // ---- Chasms ----
  const chasms = (data.chasms || []).map((c) => {
    const room = byId.get(c.room);
    const depth = c.depth ?? d.chasmDepth;
    const rs = c.respawn;
    const rsRoom = roomAt(rs.x, rs.z);
    return {
      x: c.x,
      z: c.z,
      w: c.w,
      d: c.d,
      room: room.id,
      floor: room.floor,
      depth,
      // The player is sent back once they have fallen this far below the floor.
      killY: room.floor - Math.min(5, depth / 2),
      respawn: { x: rs.x, y: rsRoom.floor, z: rs.z, yaw: facingToYaw(rs.facing) },
    };
  });

  // ---- Floors (with chasm holes cut out) and ceilings ----
  for (const r of rooms) {
    let pieces = [{ x: r.x, z: r.z, w: r.w, d: r.d }];
    for (const c of chasms.filter((ch) => ch.room === r.id)) {
      pieces = pieces.flatMap((p) => subtractRect(p, c));
    }
    for (const p of pieces) box(p.x, r.floor - d.floorThickness, p.z, p.x + p.w, r.floor, p.z + p.d, 'floor', r.id);
    const ceil = r.floor + r.height;
    box(r.x, ceil, r.z, r.x + r.w, ceil + d.ceilingThickness, r.z + r.d, 'ceiling', r.id);
  }

  // ---- Chasm pits: walls all round the hole and a floor far below ----
  for (const c of chasms) {
    const top = c.floor - d.floorThickness;
    const bottom = c.floor - c.depth;
    box(c.x - t, bottom, c.z - t, c.x + c.w + t, top, c.z, 'pit-wall', c.room); // north
    box(c.x - t, bottom, c.z + c.d, c.x + c.w + t, top, c.z + c.d + t, 'pit-wall', c.room); // south
    box(c.x - t, bottom, c.z, c.x, top, c.z + c.d, 'pit-wall', c.room); // west
    box(c.x + c.w, bottom, c.z, c.x + c.w + t, top, c.z + c.d, 'pit-wall', c.room); // east
    box(c.x - t, bottom - d.floorThickness, c.z - t, c.x + c.w + t, bottom, c.z + c.d + t, 'pit-floor', c.room);
  }

  // ---- Free-standing walls ----
  for (const w of data.walls || []) {
    const r = roomAt((w.x1 + w.x2) / 2, (w.z1 + w.z2) / 2);
    const h = w.height ?? r.height;
    const y1 = r.floor + h + (w.height ? 0 : d.ceilingThickness);
    if (Math.abs(w.z1 - w.z2) < EPS) box(w.x1, r.floor - d.floorThickness, w.z1 - t / 2, w.x2, y1, w.z1 + t / 2, 'wall', r.id);
    else box(w.x1 - t / 2, r.floor - d.floorThickness, w.z1, w.x1 + t / 2, y1, w.z2, 'wall', r.id);
  }

  const roomOfRect = (rect) => rooms.find((r) => rectInside(rect, r));

  // ---- Stairs: solid steps, each about defaults.stepHeight high ----
  const stairs = (data.stairs || []).map((st) => {
    const room = roomOfRect(st);
    const bottom = st.bottom ?? room.floor;
    const rise = st.top - bottom;
    const n = Math.max(1, Math.round(rise / d.stepHeight));
    for (let i = 0; i < n; i++) {
      const s = sliceRect(st, st.up, n, i);
      box(s.x, Math.min(bottom, room.floor), s.z, s.x + s.w, bottom + (rise * (i + 1)) / n, s.z + s.d, 'stair', room.id);
    }
    return { ...st, bottom, steps: n, room: room.id };
  });

  // ---- Ramps: a smooth slope on screen; underneath, invisible 5 cm steps the player glides up ----
  const ramps = (data.ramps || []).map((rp) => {
    const room = roomOfRect(rp);
    const bottom = rp.bottom ?? room.floor;
    const rise = rp.top - bottom;
    const n = Math.max(1, Math.ceil(rise / 0.05));
    for (let i = 0; i < n; i++) {
      const s = sliceRect(rp, rp.up, n, i);
      box(s.x, Math.min(bottom, room.floor), s.z, s.x + s.w, bottom + (rise * (i + 0.5)) / n, s.z + s.d, 'ramp-step', room.id);
    }
    return { ...rp, bottom, base: Math.min(bottom, room.floor), room: room.id, length: runLength(rp, rp.up) };
  });

  // ---- Curved walls: drawn smooth; collision is a chain of overlapping 0.3 m posts along the curve ----
  const curves = (data.curves || []).map((c) => {
    const sweep = arcSweep(c.start, c.end);
    const mid = compassPoint(c.cx, c.cz, c.r, c.start + sweep / 2);
    const room = roomAt(mid.x, mid.z) || roomAt(c.cx, c.cz);
    const y0 = room.floor - d.floorThickness;
    const y1 = c.height ? room.floor + c.height : room.floor + room.height + d.ceilingThickness;
    const len = (Math.PI * 2 * c.r * sweep) / 360;
    const n = Math.max(2, Math.ceil(len / (t / 2))); // posts every half wall-thickness -> no gaps
    for (let i = 0; i <= n; i++) {
      const p = compassPoint(c.cx, c.cz, c.r, c.start + (sweep * i) / n);
      box(p.x - t / 2, y0, p.z - t / 2, p.x + t / 2, y1, p.z + t / 2, 'curve', room.id);
    }
    return { ...c, sweep, y0, y1, room: room.id, thickness: t };
  });

  // ---- Pillar grids: rows x cols pillars spread evenly over a rectangle ----
  const pillars = [];
  for (const pg of data.pillars || []) {
    const room = roomOfRect(pg);
    const size = pg.size ?? 0.6;
    const shape = pg.shape ?? 'round';
    const y0 = room.floor - d.floorThickness;
    const y1 = pg.height ? room.floor + pg.height : room.floor + room.height + d.ceilingThickness;
    for (let i = 0; i < pg.cols; i++) {
      for (let j = 0; j < pg.rows; j++) {
        const x = pg.x + ((i + 0.5) * pg.w) / pg.cols;
        const z = pg.z + ((j + 0.5) * pg.d) / pg.rows;
        box(x - size / 2, y0, z - size / 2, x + size / 2, y1, z + size / 2, 'pillar', room.id);
        pillars.push({ x, z, size, shape, y0, y1, room: room.id });
      }
    }
  }

  // ---- Item pedestals ----
  const items = (data.items || []).map((it) => {
    const r = byId.get(it.room);
    box(it.x - 0.3, r.floor, it.z - 0.3, it.x + 0.3, r.floor + 1.0, it.z + 0.3, 'item', r.id);
    return { ...it, y: r.floor };
  });

  // Height of the walkable surface at a point (floor, or the top of a stair/ramp there).
  const groundAt = (x, z) => {
    const room = roomAt(x, z);
    if (!room) return 0;
    let y = room.floor;
    for (const b of boxes) {
      if ((b.kind === 'stair' || b.kind === 'ramp-step') && x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2]) {
        y = Math.max(y, b.max[1]);
      }
    }
    return y;
  };
  for (const c of chasms) c.respawn.y = groundAt(c.respawn.x, c.respawn.z);

  const spawn = { x: data.spawn.x, y: groundAt(data.spawn.x, data.spawn.z), z: data.spawn.z, yaw: facingToYaw(data.spawn.facing) };

  const minFloor = Math.min(...rooms.map((r) => r.floor));
  const bounds = {
    minX: Math.min(...rooms.map((r) => r.x)),
    maxX: Math.max(...rooms.map((r) => r.x + r.w)),
    minZ: Math.min(...rooms.map((r) => r.z)),
    maxZ: Math.max(...rooms.map((r) => r.z + r.d)),
  };

  return {
    name: data.name,
    settings: d,
    rooms,
    doors,
    chasms,
    stairs,
    ramps,
    curves,
    pillars,
    items,
    spawn,
    boxes,
    bounds,
    // Last-resort safety net: anyone below this is sent back to the start.
    globalKillY: minFloor - 40,
    roomAt,
    groundAt,
  };
}
