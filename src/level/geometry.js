// Small 2D helpers for the floor plan. Everything is axis-aligned rectangles.
// Coordinates: x grows to the east (right on the map), z grows to the south (down on the map).
// A rectangle is { x, z, w, d }: (x, z) is its top-left (north-west) corner on the map,
// w is its width (east-west) and d is its depth (north-south). Units are metres.

export const EPS = 1e-6;

export function rectContains(r, x, z, margin = 0) {
  return (
    x >= r.x - margin - EPS &&
    x <= r.x + r.w + margin + EPS &&
    z >= r.z - margin - EPS &&
    z <= r.z + r.d + margin + EPS
  );
}

/** True when the insides of two rectangles overlap (touching edges do not count). */
export function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.w - EPS &&
    b.x < a.x + a.w - EPS &&
    a.z < b.z + b.d - EPS &&
    b.z < a.z + a.d - EPS
  );
}

/** True when rectangle `inner` lies completely inside rectangle `outer`. */
export function rectInside(inner, outer) {
  return (
    inner.x >= outer.x - EPS &&
    inner.z >= outer.z - EPS &&
    inner.x + inner.w <= outer.x + outer.w + EPS &&
    inner.z + inner.d <= outer.z + outer.d + EPS
  );
}

/** Returns the parts of rectangle `r` that are not covered by rectangle `hole` (0 to 4 rectangles). */
export function subtractRect(r, hole) {
  if (!rectsOverlap(r, hole)) return [r];
  const ix0 = Math.max(r.x, hole.x);
  const iz0 = Math.max(r.z, hole.z);
  const ix1 = Math.min(r.x + r.w, hole.x + hole.w);
  const iz1 = Math.min(r.z + r.d, hole.z + hole.d);
  const pieces = [
    { x: r.x, z: r.z, w: r.w, d: iz0 - r.z }, // north strip
    { x: r.x, z: iz1, w: r.w, d: r.z + r.d - iz1 }, // south strip
    { x: r.x, z: iz0, w: ix0 - r.x, d: iz1 - iz0 }, // west strip
    { x: ix1, z: iz0, w: r.x + r.w - ix1, d: iz1 - iz0 }, // east strip
  ];
  return pieces.filter((p) => p.w > EPS && p.d > EPS);
}

/**
 * If rooms a and b touch along an edge, returns that shared edge:
 * { orient: 'h' | 'v', line, from, to }
 *   orient 'h' = an east-west wall at z = line, running from x = from to x = to
 *   orient 'v' = a north-south wall at x = line, running from z = from to z = to
 * Returns null if the rooms do not share an edge.
 */
export function sharedEdge(a, b) {
  const near = (p, q) => Math.abs(p - q) < 1e-4;
  // a west of b, or b west of a -> vertical shared wall
  for (const [w, e] of [
    [a, b],
    [b, a],
  ]) {
    if (near(w.x + w.w, e.x)) {
      const from = Math.max(w.z, e.z);
      const to = Math.min(w.z + w.d, e.z + e.d);
      if (to - from > EPS) return { orient: 'v', line: e.x, from, to };
    }
  }
  // a north of b, or b north of a -> horizontal shared wall
  for (const [n, s] of [
    [a, b],
    [b, a],
  ]) {
    if (near(n.z + n.d, s.z)) {
      const from = Math.max(n.x, s.x);
      const to = Math.min(n.x + n.w, s.x + s.w);
      if (to - from > EPS) return { orient: 'h', line: s.z, from, to };
    }
  }
  return null;
}

/** Converts a facing ("north", "east", ... or degrees clockwise from north) into a camera yaw in radians. */
export function facingToYaw(facing) {
  const named = { north: 0, east: 90, south: 180, west: 270 };
  const deg = typeof facing === 'number' ? facing : named[facing ?? 'north'];
  // Camera yaw turns counter-clockwise, compass degrees turn clockwise.
  return (-deg * Math.PI) / 180;
}

/** Point on a circle. `deg` is a compass angle: 0 = north, 90 = east (clockwise). */
export function compassPoint(cx, cz, r, deg) {
  const a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(a), z: cz - r * Math.cos(a) };
}

/** Sweep of an arc in degrees, going clockwise from start to end (0 < sweep <= 360). */
export function arcSweep(start, end) {
  let s = (((end - start) % 360) + 360) % 360;
  if (s === 0) s = 360;
  return s;
}

export const DIRECTIONS = ['north', 'east', 'south', 'west'];

/**
 * Splits rectangle r into n equal slices along direction `dir` (the direction you walk to go UP
 * the stairs/ramp). Slice 0 is at the bottom end, slice n-1 at the top end.
 */
export function sliceRect(r, dir, n, i) {
  if (dir === 'north') return { x: r.x, w: r.w, z: r.z + r.d - ((i + 1) * r.d) / n, d: r.d / n };
  if (dir === 'south') return { x: r.x, w: r.w, z: r.z + (i * r.d) / n, d: r.d / n };
  if (dir === 'east') return { z: r.z, d: r.d, x: r.x + (i * r.w) / n, w: r.w / n };
  return { z: r.z, d: r.d, x: r.x + r.w - ((i + 1) * r.w) / n, w: r.w / n }; // west
}

/** Length of a stairs/ramp rectangle in its "up" direction. */
export function runLength(r, dir) {
  return dir === 'north' || dir === 'south' ? r.d : r.w;
}
