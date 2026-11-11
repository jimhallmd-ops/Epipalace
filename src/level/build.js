// Turns a level file (see palace.js) into solid boxes plus a few lists for drawing.
//
// The SAME list of boxes is used for:
//   - drawing most of the 3D world (src/render/scene.js)
//   - collision (src/core/physics.js)
//   - the walls drawn on the debug map (src/ui/map.js)
// so what you see is what blocks you.
//
// A box is { min: [x, y, z], max: [x, y, z], kind, room }, where y is height above the ground.
// Kinds drawn as plain boxes:
//   'floor' | 'ceiling' | 'wall' | 'lintel' (wall above a door/opening) | 'sill' (under one)
//   'pit-wall' | 'pit-floor' (chasms) | 'pool-wall' | 'pool-floor' (water) | 'item' | 'stair' | 'platform'
// Collision-only kinds (drawn from the lists instead, or invisible):
//   'ramp-step' (small steps under a smooth ramp) | 'curve' / 'diag' (posts along curved and
//   diagonal walls) | 'pillar' | 'railing' | 'barrier' (invisible edge of an open-air side)
// Doors with a leaf (swing/slide/secret) are NOT in this list: the game adds their box while closed.

import { validateLevel, DEFAULTS } from './validate.js';
import { rectContains, rectInside, subtractRect, sharedEdge, facingToYaw, EPS, sliceRect, runLength, compassPoint, arcSweep, edgeSideOf, DIR_VEC } from './geometry.js';

export const RAILING_HEIGHT = 1.0; // the player's jump (~0.9 m) can't clear it

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
  const roomOfRect = (rect) => rooms.find((r) => rectInside(rect, r));
  const boxes = [];
  const box = (x0, y0, z0, x1, y1, z1, kind, room = null) =>
    boxes.push({
      min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
      max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
      kind,
      room,
    });
  const railings = []; // segments drawn as posts + rails: { x1, z1, x2, z2, y }

  /** Collision for a straight segment at any angle: a chain of overlapping posts. */
  const postChain = (x1, z1, x2, z2, y0, y1, kind, room) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(1, Math.ceil(len / (t / 2)));
    for (let i = 0; i <= n; i++) {
      const x = x1 + ((x2 - x1) * i) / n;
      const z = z1 + ((z2 - z1) * i) / n;
      box(x - t / 2, y0, z - t / 2, x + t / 2, y1, z + t / 2, kind, room);
    }
  };
  /** A railing along a straight line: collision box (or posts if diagonal) + drawing. */
  const railing = (x1, z1, x2, z2, y, room = null) => {
    if (Math.hypot(x2 - x1, z2 - z1) < 0.05) return;
    if (Math.abs(z1 - z2) < EPS) box(x1, y, z1 - t / 2, x2, y + RAILING_HEIGHT, z1 + t / 2, 'railing', room);
    else if (Math.abs(x1 - x2) < EPS) box(x1 - t / 2, y, z1, x1 + t / 2, y + RAILING_HEIGHT, z2, 'railing', room);
    else postChain(x1, z1, x2, z2, y, y + RAILING_HEIGHT, 'railing', room);
    railings.push({ x1, z1, x2, z2, y });
  };

  // ---- Where stairs, ramps and ladders arrive at the top: railings leave a gap there ----
  const arrivals = []; // { orient, line, from, to }
  for (const st of [...(data.stairs || []), ...(data.ramps || [])]) {
    if (st.up === 'north') arrivals.push({ orient: 'h', line: st.z, from: st.x, to: st.x + st.w });
    if (st.up === 'south') arrivals.push({ orient: 'h', line: st.z + st.d, from: st.x, to: st.x + st.w });
    if (st.up === 'east') arrivals.push({ orient: 'v', line: st.x + st.w, from: st.z, to: st.z + st.d });
    if (st.up === 'west') arrivals.push({ orient: 'v', line: st.x, from: st.z, to: st.z + st.d });
  }
  for (const l of data.ladders || []) {
    const w = (l.w ?? 0.8) + 0.4;
    if (l.facing === 'north' || l.facing === 'south') arrivals.push({ orient: 'h', line: l.z, from: l.x - w / 2, to: l.x + w / 2 });
    else arrivals.push({ orient: 'v', line: l.x, from: l.z - w / 2, to: l.z + w / 2 });
  }
  /** Splits [p, q] on a line into the parts NOT covered by an arrival (railing gaps). */
  const minusArrivals = (orient, line, p, q) => {
    let parts = [[p, q]];
    for (const a of arrivals) {
      if (a.orient !== orient || Math.abs(a.line - line) > 0.05) continue;
      parts = parts.flatMap(([u, v]) => {
        if (a.to <= u || a.from >= v) return [[u, v]];
        const out = [];
        if (a.from > u) out.push([u, a.from]);
        if (a.to < v) out.push([a.to, v]);
        return out;
      });
    }
    return parts.filter(([u, v]) => v - u > 0.05);
  };

  // ---- Doors: find the wall the two rooms share and cut a gap in it ----
  const doors = (data.doors || []).map((door, index) => {
    const [a, b] = door.between.map((id) => byId.get(id));
    const edge = sharedEdge(a, b);
    const width = door.width ?? d.doorWidth;
    const centre = (edge.from + edge.to) / 2 + (door.offset ?? 0);
    const aLow = edge.orient === 'h' ? a.z < edge.line : a.x < edge.line; // low = north / west side
    const floor = Math.max(a.floor, b.floor); // a door between different heights sits at the higher floor
    const height = door.height ?? d.doorHeight;
    const leaf = door.leaf ?? 'none';
    const from = centre - width / 2;
    const to = centre + width / 2;
    // The box that blocks the doorway while a door is closed (the game adds/removes it).
    const lt = leaf === 'secret' ? t : 0.2;
    const leafBox =
      edge.orient === 'h'
        ? { min: [from, floor, edge.line - lt / 2], max: [to, floor + height, edge.line + lt / 2], kind: 'door' }
        : { min: [edge.line - lt / 2, floor, from], max: [edge.line + lt / 2, floor + height, to], kind: 'door' };
    return {
      index,
      rooms: [a.id, b.id],
      lowRoom: aLow ? a.id : b.id,
      highRoom: aLow ? b.id : a.id,
      orient: edge.orient,
      line: edge.line,
      from,
      to,
      centre,
      width,
      floor,
      height,
      leaf,
      opens: door.opens ?? 'use',
      trigger: door.trigger ?? null,
      leafBox: leaf === 'none' ? null : leafBox,
    };
  });

  // ---- Walls: collect every room edge onto shared "wall lines" ----
  // Two rooms that touch put their edges on the same line, so the wall between them is built
  // once (no double walls). Door gaps are cut from it, and open-air sides are left open.
  const lines = new Map();
  const lineFor = (orient, coord) => {
    const key = `${orient}:${Math.round(coord * 1000)}`;
    if (!lines.has(key)) lines.set(key, { orient, coord, spans: [], doors: [] });
    return lines.get(key);
  };
  for (const r of rooms) {
    const span = (side, a, b) => ({ a, b, floor: r.floor, top: r.floor + r.height, sky: !!r.sky, mode: r.sides?.[side] ?? 'wall', room: r.id });
    lineFor('h', r.z).spans.push(span('north', r.x, r.x + r.w));
    lineFor('h', r.z + r.d).spans.push(span('south', r.x, r.x + r.w));
    lineFor('v', r.x).spans.push(span('west', r.z, r.z + r.d));
    lineFor('v', r.x + r.w).spans.push(span('east', r.z, r.z + r.d));
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
      const bottom = Math.min(...covering.map((s) => s.floor)) - d.floorThickness;
      const top = Math.max(...covering.map((s) => s.top)) + d.ceilingThickness;
      const modes = covering.map((s) => s.mode);
      // An edge is open if either room opens it; a railing wins over plain open.
      const open = modes.includes('railing') ? 'railing' : modes.includes('open') ? 'open' : null;
      let piece;
      if (open) {
        const roofed = covering.filter((s) => !s.sky);
        piece = {
          p,
          q,
          bottom,
          top,
          door: null,
          open,
          bandBottom: Math.max(...covering.map((s) => s.floor)),
          bandTop: roofed.length ? Math.min(...roofed.map((s) => s.top)) : Infinity,
          outside: covering.length === 1,
        };
      } else {
        const door = line.doors.find((dr) => dr.from <= mid && dr.to >= mid) || null;
        piece = { p, q, bottom, top, door, open: null };
      }
      const last = pieces[pieces.length - 1];
      const same =
        last &&
        Math.abs(last.q - p) < EPS &&
        last.bottom === piece.bottom &&
        last.top === piece.top &&
        last.door === piece.door &&
        last.open === piece.open &&
        last.bandBottom === piece.bandBottom &&
        last.bandTop === piece.bandTop &&
        last.outside === piece.outside;
      if (same) last.q = q;
      else pieces.push(piece);
    }

    const c = line.coord;
    const emit = (p, q, y0, y1, kind) => {
      if (y1 - y0 < EPS || q - p < EPS) return;
      if (line.orient === 'h') box(p, y0, c - t / 2, q, y1, c + t / 2, kind);
      else box(c - t / 2, y0, p, c + t / 2, y1, q, kind);
    };
    for (let i = 0; i < pieces.length; i++) {
      const pc = pieces[i];
      if (pc.open) {
        // Open side: keep the wall below the higher floor and above the lower ceiling.
        const lowest = pc.bottom + d.floorThickness;
        emit(pc.p, pc.q, pc.bottom, pc.bandBottom, pc.bandBottom - lowest > 0.05 ? 'wall' : 'sill');
        if (Number.isFinite(pc.bandTop)) emit(pc.p, pc.q, pc.bandTop, pc.top, 'lintel');
        if (pc.open === 'railing') {
          for (const [u, v] of minusArrivals(line.orient, c, pc.p, pc.q)) {
            if (line.orient === 'h') railing(u, c, v, c, pc.bandBottom);
            else railing(c, u, c, v, pc.bandBottom);
          }
        } else if (pc.outside) {
          emit(pc.p, pc.q, pc.bandBottom, pc.bandBottom + 8, 'barrier'); // you can't walk off the palace
        }
      } else if (pc.door) {
        emit(pc.p, pc.q, pc.door.floor + pc.door.height, pc.top, 'lintel');
        emit(pc.p, pc.q, pc.bottom, pc.door.floor, 'sill');
      } else {
        // East-west walls are stretched by half a wall thickness at each end so corners are
        // closed, except where the end touches a door gap or an open side.
        let p = pc.p;
        let q = pc.q;
        if (line.orient === 'h') {
          const prev = pieces[i - 1];
          const next = pieces[i + 1];
          if (!(prev && (prev.door || prev.open) && Math.abs(prev.q - p) < EPS)) p -= t / 2;
          if (!(next && (next.door || next.open) && Math.abs(next.p - q) < EPS)) q += t / 2;
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
      respawn: { x: rs.x, y: 0, z: rs.z, yaw: facingToYaw(rs.facing) },
    };
  });

  // ---- Water: a pool cut into a room floor, filled to just below the floor ----
  const water = (data.water || []).map((wt) => {
    const room = roomOfRect(wt);
    const surface = room.floor - 0.15;
    return { x: wt.x, z: wt.z, w: wt.w, d: wt.d, room: room.id, floor: room.floor, depth: wt.depth, surface, bottom: room.floor - wt.depth };
  });

  // ---- Floors (with chasm and pool holes cut out) and ceilings (unless open to the sky) ----
  for (const r of rooms) {
    let pieces = [{ x: r.x, z: r.z, w: r.w, d: r.d }];
    for (const hole of [...chasms, ...water].filter((h) => h.room === r.id)) pieces = pieces.flatMap((p) => subtractRect(p, hole));
    for (const p of pieces) box(p.x, r.floor - d.floorThickness, p.z, p.x + p.w, r.floor, p.z + p.d, 'floor', r.id);
    if (!r.sky) {
      const ceil = r.floor + r.height;
      box(r.x, ceil, r.z, r.x + r.w, ceil + d.ceilingThickness, r.z + r.d, 'ceiling', r.id);
    }
  }

  // ---- Pits for chasms and pools: walls all round the hole and a floor at the bottom ----
  const pit = (c, bottom, wallKind, floorKind) => {
    const top = c.floor - d.floorThickness;
    box(c.x - t, bottom, c.z - t, c.x + c.w + t, top, c.z, wallKind, c.room); // north
    box(c.x - t, bottom, c.z + c.d, c.x + c.w + t, top, c.z + c.d + t, wallKind, c.room); // south
    box(c.x - t, bottom, c.z, c.x, top, c.z + c.d, wallKind, c.room); // west
    box(c.x + c.w, bottom, c.z, c.x + c.w + t, top, c.z + c.d, wallKind, c.room); // east
    box(c.x - t, bottom - d.floorThickness, c.z - t, c.x + c.w + t, bottom, c.z + c.d + t, floorKind, c.room);
  };
  for (const c of chasms) pit(c, c.floor - c.depth, 'pit-wall', 'pit-floor');
  for (const w of water) pit(w, w.bottom, 'pool-wall', 'pool-floor');

  // ---- Free-standing walls, straight at any angle; style 'railing' makes a see-through railing ----
  const diagonals = []; // diagonal solid walls, drawn as rotated boxes
  for (const w of data.walls || []) {
    const r = roomAt((w.x1 + w.x2) / 2, (w.z1 + w.z2) / 2);
    if (w.style === 'railing') {
      railing(w.x1, w.z1, w.x2, w.z2, r.floor, r.id);
      continue;
    }
    const y0 = r.floor - d.floorThickness;
    const y1 = w.height ? r.floor + w.height : r.floor + r.height + (r.sky ? 0 : d.ceilingThickness);
    if (Math.abs(w.z1 - w.z2) < EPS) box(Math.min(w.x1, w.x2), y0, w.z1 - t / 2, Math.max(w.x1, w.x2), y1, w.z1 + t / 2, 'wall', r.id);
    else if (Math.abs(w.x1 - w.x2) < EPS) box(w.x1 - t / 2, y0, Math.min(w.z1, w.z2), w.x1 + t / 2, y1, Math.max(w.z1, w.z2), 'wall', r.id);
    else {
      postChain(w.x1, w.z1, w.x2, w.z2, y0, y1, 'diag', r.id);
      diagonals.push({ x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2, y0, y1, thickness: t, room: r.id });
    }
  }

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

  // ---- Platforms: a raised area inside a room, optionally with railings on its edges ----
  const platforms = (data.platforms || []).map((pf) => {
    const room = roomOfRect(pf);
    const under = pf.under ?? 'solid';
    const y0 = under === 'open' ? pf.top - d.floorThickness : room.floor;
    box(pf.x, y0, pf.z, pf.x + pf.w, pf.top, pf.z + pf.d, 'platform', room.id);
    const edges = {
      north: ['h', pf.z, pf.x, pf.x + pf.w],
      south: ['h', pf.z + pf.d, pf.x, pf.x + pf.w],
      west: ['v', pf.x, pf.z, pf.z + pf.d],
      east: ['v', pf.x + pf.w, pf.z, pf.z + pf.d],
    };
    for (const side of pf.railings || []) {
      const [orient, c, p, q] = edges[side];
      // Railings sit just inside the platform edge.
      const inset = side === 'north' || side === 'west' ? t / 2 : -t / 2;
      for (const [u, v] of minusArrivals(orient, c, p, q)) {
        if (orient === 'h') railing(u, c + inset, v, c + inset, pf.top, room.id);
        else railing(c + inset, u, c + inset, v, pf.top, room.id);
      }
    }
    return { ...pf, under, y0, room: room.id };
  });

  // ---- Curved walls: drawn smooth; collision is a chain of overlapping posts along the curve ----
  const curves = (data.curves || []).map((c) => {
    const sweep = arcSweep(c.start, c.end);
    const mid = compassPoint(c.cx, c.cz, c.r, c.start + sweep / 2);
    const room = roomAt(mid.x, mid.z) || roomAt(c.cx, c.cz);
    const style = c.style ?? 'solid';
    const y0 = style === 'railing' ? room.floor : room.floor - d.floorThickness;
    const y1 = style === 'railing' ? room.floor + RAILING_HEIGHT : c.height ? room.floor + c.height : room.floor + room.height + (room.sky ? 0 : d.ceilingThickness);
    const len = (Math.PI * 2 * c.r * sweep) / 360;
    const n = Math.max(2, Math.ceil(len / (t / 2))); // posts every half wall-thickness -> no gaps
    for (let i = 0; i <= n; i++) {
      const p = compassPoint(c.cx, c.cz, c.r, c.start + (sweep * i) / n);
      box(p.x - t / 2, y0, p.z - t / 2, p.x + t / 2, y1, p.z + t / 2, style === 'railing' ? 'railing' : 'curve', room.id);
    }
    if (style === 'railing') {
      const segs = Math.max(4, Math.ceil(sweep / 8));
      for (let i = 0; i < segs; i++) {
        const a = compassPoint(c.cx, c.cz, c.r, c.start + (sweep * i) / segs);
        const b = compassPoint(c.cx, c.cz, c.r, c.start + (sweep * (i + 1)) / segs);
        railings.push({ x1: a.x, z1: a.z, x2: b.x, z2: b.z, y: room.floor });
      }
    }
    return { ...c, style, sweep, y0, y1, room: room.id, thickness: t };
  });

  // ---- Pillar grids: rows x cols pillars spread evenly over a rectangle ----
  const pillars = [];
  for (const pg of data.pillars || []) {
    const room = roomOfRect(pg);
    const size = pg.size ?? 0.6;
    const shape = pg.shape ?? 'round';
    const y0 = room.floor - d.floorThickness;
    const y1 = pg.height ? room.floor + pg.height : room.floor + room.height + (room.sky ? 0 : d.ceilingThickness);
    for (let i = 0; i < pg.cols; i++) {
      for (let j = 0; j < pg.rows; j++) {
        const x = pg.x + ((i + 0.5) * pg.w) / pg.cols;
        const z = pg.z + ((j + 0.5) * pg.d) / pg.rows;
        box(x - size / 2, y0, z - size / 2, x + size / 2, y1, z + size / 2, 'pillar', room.id);
        pillars.push({ x, z, size, shape, y0, y1, room: room.id });
      }
    }
  }

  // ---- Ladders: climb by walking into them (see physics.js) ----
  const ladders = (data.ladders || []).map((l) => {
    const room = roomAt(l.x - DIR_VEC[l.facing][0] * 0.3, l.z - DIR_VEC[l.facing][1] * 0.3) || roomAt(l.x, l.z);
    const bottom = l.bottom ?? room.floor;
    const w = l.w ?? 0.8;
    const [fx, fz] = DIR_VEC[l.facing];
    // The climbing zone: the ladder's width, reaching 0.75 m back from the ladder line.
    const across = fx === 0 ? [l.x - w / 2, l.x + w / 2] : [l.z - w / 2, l.z + w / 2];
    const back = fx === 0 ? [l.z, l.z - fz * 0.75] : [l.x, l.x - fx * 0.75];
    const zone =
      fx === 0
        ? { x0: across[0], x1: across[1], z0: Math.min(...back), z1: Math.max(...back) }
        : { x0: Math.min(...back), x1: Math.max(...back), z0: across[0], z1: across[1] };
    return { ...l, w, bottom, top: l.top, fx, fz, zone, room: room.id };
  });

  // ---- Triggers: levers you pull (Use) and plates you step on ----
  const triggers = (data.triggers || []).map((tr) => {
    const room = roomAt(tr.x, tr.z);
    return { ...tr, type: tr.type ?? 'lever', y: room.floor, room: room.id };
  });
  for (const tr of triggers) if (tr.type === 'lever') box(tr.x - 0.15, tr.y, tr.z - 0.15, tr.x + 0.15, tr.y + 0.9, tr.z + 0.15, 'item', tr.room);

  // ---- Item pedestals ----
  const items = (data.items || []).map((it) => {
    const r = byId.get(it.room);
    box(it.x - 0.3, r.floor, it.z - 0.3, it.x + 0.3, r.floor + 1.0, it.z + 0.3, 'item', r.id);
    return { ...it, y: r.floor };
  });

  // Height of the walkable surface at a point (floor, or the top of a stair/ramp/platform there).
  const walkable = new Set(['stair', 'ramp-step', 'platform']);
  const groundAt = (x, z) => {
    const room = roomAt(x, z);
    if (!room) return 0;
    let y = room.floor;
    for (const b of boxes) {
      if (walkable.has(b.kind) && x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2]) y = Math.max(y, b.max[1]);
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
    water,
    stairs,
    ramps,
    platforms,
    ladders,
    curves,
    diagonals,
    railings,
    pillars,
    triggers,
    items,
    spawn,
    boxes,
    bounds,
    minFloor,
    // Last-resort safety net: anyone below this is sent back to the start.
    globalKillY: minFloor - 40,
    roomAt,
    groundAt,
    edgeSideOf,
  };
}
