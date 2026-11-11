// Tests for open-air rooms, railings, platforms, diagonal walls, ladders, water, doors and triggers.
import { describe, it, expect } from 'vitest';
import { buildLevel } from '../src/level/build.js';
import { validateLevel } from '../src/level/validate.js';
import { createPlayer, stepPlayer, PLAYER } from '../src/core/physics.js';
import { createGame } from '../src/core/game.js';
import palace from '../src/level/palace.js';

const level = buildLevel(palace);
const R = PLAYER.radius;
const YAW = { north: 0, west: Math.PI / 2, south: Math.PI, east: -Math.PI / 2 };
const room = (id) => level.rooms.find((r) => r.id === id);

/** A fresh game with the player placed at (x, z) facing `yaw`, settled on the ground. */
function gameAt(x, z, yaw = 0, lvl = level) {
  const g = createGame(lvl);
  g.placeAt({ x, y: lvl.groundAt(x, z), z, yaw });
  run(g, {}, 0.3);
  return g;
}
function run(g, input, seconds, each) {
  for (let t = 0; t < seconds; t += 1 / 60) {
    g.update(1 / 60, input);
    each?.(g.player);
  }
}

describe('open-air rooms and open sides', () => {
  it('a room open to the sky has no ceiling, but its neighbours do', () => {
    expect(level.boxes.some((b) => b.kind === 'ceiling' && b.room === 10)).toBe(false);
    expect(level.boxes.some((b) => b.kind === 'ceiling' && b.room === 3)).toBe(true);
  });

  it('an open side facing outside has an invisible barrier: you cannot walk off the palace', () => {
    const c = room(10);
    const g = gameAt(c.x + c.w - 2, 26, YAW.east);
    run(g, { forward: 1, run: true }, 2, (p) => expect(p.x).toBeLessThanOrEqual(c.x + c.w - 0.15 - R + 1e-6));
    expect(g.player.x).toBeGreaterThan(c.x + c.w - 0.5); // it reached the edge
  });

  it('a railing side blocks the player, and is too high to jump over', () => {
    const c = room(10);
    const g = gameAt(c.x + 1.5, 19.5, YAW.west);
    run(g, { forward: 1, run: true, jump: true }, 2, (p) => expect(p.x).toBeGreaterThanOrEqual(c.x + 0.15 + R - 1e-6));
  });

  it('a balcony railing (Room 9 over Room 4) blocks, except where the stairs arrive', () => {
    // north of the stairs: blocked by the railing
    const g = gameAt(26, 9, YAW.west);
    run(g, { forward: 1, run: true }, 2, (p) => {
      expect(p.x).toBeGreaterThanOrEqual(24 + 0.15 + R - 1e-6);
      expect(p.y).toBeCloseTo(1.8, 5);
    });
    // in line with the stairs: the gap lets you walk down
    const h = gameAt(26, 13, YAW.west);
    run(h, { forward: 1 }, 2.5);
    expect(h.state.room.id).toBe(4);
  });

  it('from the lower room you cannot walk under the balcony', () => {
    const g = gameAt(21, 9, YAW.east);
    run(g, { forward: 1, run: true }, 2, (p) => expect(p.x).toBeLessThanOrEqual(24 - 0.15 - R + 1e-6));
  });

  it('two rooms joined by an open side can be walked between freely', () => {
    const lvl = buildLevel({
      rooms: [
        { id: 1, x: 0, z: 0, w: 6, d: 6, sides: { east: 'open' } },
        { id: 2, x: 6, z: 0, w: 6, d: 6 },
      ],
      spawn: { x: 3, z: 3 },
    });
    const g = gameAt(3, 3, YAW.east, lvl);
    run(g, { forward: 1 }, 2);
    expect(g.state.room.id).toBe(2);
    expect(lvl.boxes.some((b) => b.kind === 'barrier')).toBe(false); // no barrier between rooms
  });
});

describe('platforms', () => {
  const pf = level.platforms[0];

  it('a railing on the platform edge stops you walking off', () => {
    const g = gameAt(pf.x + 2, pf.z + 2, YAW.south);
    g.placeAt({ x: pf.x + 2, y: pf.top, z: pf.z + 2, yaw: YAW.south });
    run(g, { forward: 1, run: true, jump: true }, 2, (p) => expect(p.z).toBeLessThanOrEqual(pf.z + pf.d - 0.3 - R + 1e-6));
    run(g, {}, 1); // land
    expect(g.player.y).toBeCloseTo(pf.top, 5);
  });

  it('a platform with open space under it can be walked beneath', () => {
    const lvl = buildLevel({
      rooms: [{ id: 1, x: 0, z: 0, w: 10, d: 6, height: 6 }],
      platforms: [{ x: 4, z: 0, w: 3, d: 6, top: 2.6, under: 'open' }],
      spawn: { x: 1, z: 3 },
    });
    const g = gameAt(1, 3, YAW.east, lvl);
    run(g, { forward: 1 }, 3);
    expect(g.player.x).toBeGreaterThan(8);
    expect(g.player.y).toBe(0);
  });

  it('rejects a platform too close to the ceiling, or too low to walk under', () => {
    const base = { rooms: [{ id: 1, x: 0, z: 0, w: 10, d: 6 }], spawn: { x: 1, z: 1 } };
    expect(validateLevel({ ...base, platforms: [{ x: 4, z: 0, w: 3, d: 3, top: 3 }] }).some((e) => e.includes('head room'))).toBe(true);
    expect(validateLevel({ ...base, platforms: [{ x: 4, z: 0, w: 3, d: 3, top: 1, under: 'open' }] }).some((e) => e.includes('2.3 m'))).toBe(true);
  });
});

describe('diagonal walls', () => {
  const w = palace.walls.find((x) => x.x1 !== x.x2 && x.z1 !== x.z2);
  // which side of the wall line a point is on
  const side = (x, z) => Math.sign((w.x2 - w.x1) * (z - w.z1) - (w.z2 - w.z1) * (x - w.x1));

  it('blocks the player along its whole length, at every angle of approach', () => {
    let checked = 0;
    for (let k = 0.1; k <= 0.9; k += 0.1) {
      const mx = w.x1 + (w.x2 - w.x1) * k;
      const mz = w.z1 + (w.z2 - w.z1) * k;
      for (const yaw of [YAW.north, YAW.west, Math.PI / 4]) {
        const g = gameAt(mx + 1.6, mz + 1.6, yaw); // start on the room side, south-east of the wall
        const s0 = side(g.player.x, g.player.z);
        run(g, { forward: 1, run: true }, 1.5, (p) => expect(side(p.x, p.z)).toBe(s0));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe('ladders', () => {
  const l = level.ladders[0];

  it('walking into the ladder climbs it, and you step off onto the platform at the top', () => {
    const g = gameAt(l.x - 1.5, l.z, YAW.east);
    run(g, { forward: 1 }, 3);
    expect(g.player.y).toBeCloseTo(l.top, 5);
    expect(g.player.x).toBeGreaterThan(l.x); // on the platform
    expect(g.player.grounded).toBe(true);
  });

  it('you can climb back down, facing away from the ladder', () => {
    const g = gameAt(l.x + 1, l.z, YAW.west);
    g.placeAt({ x: l.x + 1, y: l.top, z: l.z, yaw: YAW.west });
    run(g, { forward: 1 }, 4);
    expect(g.player.y).toBeCloseTo(room(10).floor, 5);
  });

  it('walking past the ladder sideways does not grab it', () => {
    const g = gameAt(l.x - 0.4, l.z - 2, YAW.south);
    run(g, { forward: 1 }, 1.5, (p) => expect(p.y).toBeLessThan(0.05));
  });
});

describe('water', () => {
  const pool = level.water[0];
  const cx = pool.x + pool.w / 2;
  const cz = pool.z + pool.d / 2;

  it('falling into deep water: you float with your eyes just above the surface', () => {
    const g = gameAt(cx, cz);
    run(g, {}, 4);
    const eyes = g.player.y + PLAYER.eyeHeight;
    expect(eyes).toBeGreaterThan(pool.surface);
    expect(eyes).toBeLessThan(pool.surface + 0.4);
    expect(g.state.respawns).toBe(0);
  });

  it('diving (C) takes you down, and you float back up when you let go', () => {
    const g = gameAt(cx, cz);
    run(g, {}, 3);
    run(g, { down: true }, 1.5);
    expect(g.state.underwater).toBe(true);
    expect(g.player.y).toBeLessThan(pool.surface - 2);
    run(g, {}, 4);
    expect(g.state.underwater).toBe(false);
  });

  it('you can swim to the edge and climb out', () => {
    const g = gameAt(cx, cz, YAW.east);
    run(g, {}, 3);
    run(g, { forward: 1 }, 5);
    expect(g.player.x).toBeGreaterThan(pool.x + pool.w);
    expect(g.player.y).toBeCloseTo(pool.floor, 5);
  });

  it('shallow water is waded through, slower than walking', () => {
    const lvl = buildLevel({
      rooms: [{ id: 1, x: 0, z: 0, w: 20, d: 6 }],
      water: [{ x: 4, z: 0, w: 12, d: 6, depth: 0.5 }],
      spawn: { x: 1, z: 3 },
    });
    const g = gameAt(6, 3, YAW.east, lvl);
    const x0 = g.player.x;
    run(g, { forward: 1 }, 1);
    expect(g.player.x - x0).toBeLessThan(PLAYER.walkSpeed * 0.75);
    expect(g.player.x - x0).toBeGreaterThan(1);
    run(g, { forward: 1 }, 4);
    expect(g.player.x).toBeGreaterThan(16); // walked out the far side
  });
});

describe('doors', () => {
  const doorOf = (a, b) => level.doors.find((d) => d.rooms.includes(a) && d.rooms.includes(b));

  it('a closed swing door blocks; Use opens it; you can walk through; Use closes it', () => {
    const d = doorOf(3, 10);
    const g = gameAt(d.centre, d.line - 1.2, YAW.south);
    run(g, { forward: 1 }, 1.5, (p) => expect(p.z).toBeLessThan(d.line));
    expect(g.state.target?.label).toBe('Open door');
    g.update(1 / 60, { use: true });
    run(g, {}, 0.8);
    run(g, { forward: 1 }, 0.6);
    expect(g.state.room.id).toBe(10);
    // turn round and close it behind you
    g.player.yaw = YAW.north;
    run(g, {}, 0.1);
    g.update(1 / 60, { use: true });
    run(g, {}, 1);
    expect(g.state.doors.find((x) => x.def === d).open).toBe(false);
  });

  it('a door never closes on the player standing in the doorway', () => {
    const d = doorOf(3, 10);
    const g = gameAt(d.centre, d.line - 1, YAW.south);
    g.update(1 / 60, { use: true });
    run(g, {}, 1);
    g.placeAt({ x: d.centre, y: d.floor, z: d.line, yaw: YAW.north });
    g.state.doors.find((x) => x.def === d).open = false;
    run(g, {}, 1.5);
    expect(g.state.doors.find((x) => x.def === d).open).toBe(true);
  });

  it('an automatic sliding door opens as you walk up to it', () => {
    const d = doorOf(2, 7);
    const g = gameAt(d.centre, d.line + 4, YAW.north);
    run(g, { forward: 1 }, 2.5);
    expect(g.state.room.id).toBe(7);
  });

  it('a secret door blocks, gives no hint, and opens when its lever is pulled', () => {
    const d = doorOf(9, 11);
    const g = gameAt(d.line - 1.2, d.centre, YAW.east);
    expect(g.state.target).toBeNull(); // no "Open door" prompt for a secret door
    run(g, { forward: 1 }, 1.5, (p) => expect(p.x).toBeLessThan(d.line));
    // go and pull the lever
    const lever = level.triggers.find((t) => t.name === 'gallery-lever');
    g.placeAt({ x: lever.x, y: lever.y, z: lever.z - 1.2, yaw: YAW.south });
    run(g, {}, 0.2);
    expect(g.state.target?.label).toBe('Pull lever');
    g.update(1 / 60, { use: true });
    expect(g.state.events.some((e) => e.type === 'trigger' && e.opened === 1)).toBe(true);
    run(g, {}, 2);
    g.placeAt({ x: d.line - 1.2, y: d.floor, z: d.centre, yaw: YAW.east });
    run(g, { forward: 1 }, 1.5);
    expect(g.state.room.id).toBe(11);
  });

  it('a pressure plate opens its secret door when stepped on', () => {
    const d = doorOf(10, 12);
    const plate = level.triggers.find((t) => t.type === 'plate');
    const g = gameAt(plate.x, plate.z - 2, YAW.south);
    expect(g.state.doors.find((x) => x.def === d).open).toBe(false);
    run(g, { forward: 1 }, 0.6);
    expect(g.state.doors.find((x) => x.def === d).open).toBe(true);
  });

  it('rejects a secret door without a trigger, unknown triggers, and doors on open sides', () => {
    const data = structuredClone(palace);
    data.doors.find((x) => x.leaf === 'secret').trigger = undefined;
    expect(validateLevel(data).some((e) => e.includes('needs a trigger'))).toBe(true);
    const data2 = structuredClone(palace);
    data2.doors.find((x) => x.leaf === 'secret').trigger = 'nope';
    expect(validateLevel(data2).some((e) => e.includes('no trigger called'))).toBe(true);
    const data3 = structuredClone(palace);
    data3.rooms.find((r) => r.id === 10).sides.north = 'open';
    expect(validateLevel(data3).some((e) => e.includes('no wall to put a door in'))).toBe(true);
  });
});
