// These tests FAIL if the player can get through a wall, floor or ceiling.
// They run on every Netlify deploy (see netlify.toml); a failure stops the deploy.

import { describe, it, expect } from 'vitest';
import { buildLevel } from '../src/level/build.js';
import { createPlayer, stepPlayer, moveAndCollide, playerOverlaps, PLAYER } from '../src/core/physics.js';
import { createGame } from '../src/core/game.js';
import palace from '../src/level/palace.js';

const level = buildLevel(palace);
const R = PLAYER.radius;
// Walls are centred on room edges, so the inside face of a wall is half a wall thickness in.
const HALF_WALL = 0.15;
const IN = R + HALF_WALL; // closest the player's centre can get to a room edge

// A tiny one-room level, 6 m x 6 m, with no doors.
const boxLevel = buildLevel({
  rooms: [{ id: 1, name: 'Box', x: 0, z: 0, w: 6, d: 6 }],
  spawn: { x: 3, z: 3 },
});

function settle(p, boxes) {
  for (let i = 0; i < 30; i++) stepPlayer(p, {}, boxes, 1 / 60);
}

/** Walk with a fixed input for `seconds`, checking `check` after every frame. */
function walk(p, boxes, input, seconds, dt, check) {
  for (let t = 0; t < seconds; t += dt) {
    stepPlayer(p, input, boxes, dt);
    check?.(p);
  }
}

const YAWS = { north: 0, west: Math.PI / 2, south: Math.PI, east: -Math.PI / 2 };

describe('simple closed room', () => {
  for (const [dir, yaw] of Object.entries(YAWS)) {
    for (const dt of [1 / 144, 1 / 60, 1 / 20, 0.05, 0.5]) {
      it(`cannot walk out through the ${dir} wall (frame time ${dt.toFixed(3)} s)`, () => {
        const p = createPlayer({ ...boxLevel.spawn, yaw });
        settle(p, boxLevel.boxes);
        walk(p, boxLevel.boxes, { forward: 1, run: true }, 4, dt, (pl) => {
          expect(pl.x).toBeGreaterThanOrEqual(IN - 1e-6);
          expect(pl.x).toBeLessThanOrEqual(6 - IN + 1e-6);
          expect(pl.z).toBeGreaterThanOrEqual(IN - 1e-6);
          expect(pl.z).toBeLessThanOrEqual(6 - IN + 1e-6);
        });
        // ...and it actually reached the wall rather than being stuck
        const dist = { north: p.z - IN, south: 6 - IN - p.z, west: p.x - IN, east: 6 - IN - p.x }[dir];
        expect(dist).toBeLessThan(0.01);
      });
    }
  }

  it('cannot be teleported through a wall by one enormous movement', () => {
    const p = createPlayer(boxLevel.spawn);
    settle(p, boxLevel.boxes);
    moveAndCollide(p, 500, 0, 0, boxLevel.boxes);
    expect(p.x).toBeLessThanOrEqual(6 - IN + 1e-6);
    moveAndCollide(p, 0, 0, -500, boxLevel.boxes);
    expect(p.z).toBeGreaterThanOrEqual(IN - 1e-6);
  });

  it('cannot walk diagonally out through a corner', () => {
    const p = createPlayer({ ...boxLevel.spawn, yaw: Math.PI / 4 }); // facing north-west
    settle(p, boxLevel.boxes);
    walk(p, boxLevel.boxes, { forward: 1, run: true }, 4, 1 / 60);
    expect(p.x).toBeCloseTo(IN, 5);
    expect(p.z).toBeCloseTo(IN, 5);
  });

  it('stands on the floor and does not sink through it', () => {
    const p = createPlayer(boxLevel.spawn);
    walk(p, boxLevel.boxes, {}, 3, 1 / 60);
    expect(p.y).toBe(0);
    expect(p.grounded).toBe(true);
  });

  it('jumps about 1.2 m and cannot pass through the ceiling', () => {
    const p = createPlayer(boxLevel.spawn);
    settle(p, boxLevel.boxes);
    let peak = 0;
    walk(p, boxLevel.boxes, { jump: true }, 0.4, 1 / 60, (pl) => (peak = Math.max(peak, pl.y)));
    expect(peak).toBeGreaterThan(1.0);
    expect(peak).toBeLessThan(1.5);

    // A low ceiling: a 3 m tall room. Even a huge upward push stops at the ceiling.
    const low = buildLevel({ rooms: [{ id: 1, x: 0, z: 0, w: 4, d: 4, height: 3 }], spawn: { x: 2, z: 2 } });
    const q = createPlayer(low.spawn);
    settle(q, low.boxes);
    moveAndCollide(q, 0, 100, 0, low.boxes);
    expect(q.y + PLAYER.height).toBeLessThanOrEqual(3 + 1e-6);
  });
});

describe('the real palace level', () => {
  it('every room keeps the player in, in every direction, except through doors', () => {
    let checkedRuns = 0;
    for (const room of level.rooms) {
      const doorsHere = level.doors.filter((d) => d.rooms.includes(room.id));
      const chasmsHere = level.chasms.filter((c) => c.room === room.id);
      for (const [dir, yaw] of Object.entries(YAWS)) {
        const ns = dir === 'north' || dir === 'south';
        // Walk along many parallel lines across the room.
        const span = ns ? [room.x, room.x + room.w] : [room.z, room.z + room.d];
        for (let s = span[0] + IN + 0.05; s <= span[1] - IN - 0.05; s += 0.4) {
          // Skip lines that would pass through a door in this direction.
          const throughDoor = doorsHere.some(
            (d) => d.orient === (ns ? 'h' : 'v') && s + R > d.from - 1e-6 && s - R < d.to + 1e-6
          );
          if (throughDoor) continue;
          // Start in the middle of the room (on solid floor).
          const startOther = ns ? room.z + room.d / 2 : room.x + room.w / 2;
          let x = ns ? s : startOther;
          let z = ns ? startOther : s;
          if (chasmsHere.some((c) => x > c.x - R - 0.1 && x < c.x + c.w + R + 0.1 && z > c.z - R - 0.1 && z < c.z + c.d + R + 0.1)) continue;
          const p = createPlayer({ x, y: room.floor, z, yaw });
          if (level.boxes.some((b) => playerOverlaps(p.x, p.y, p.z, b))) continue; // started inside a pedestal/partition
          walk(p, level.boxes, { forward: 1, run: true }, 6, 1 / 30, (pl) => {
            // never outside this room's walls
            expect(pl.x).toBeGreaterThanOrEqual(room.x + IN - 1e-6);
            expect(pl.x).toBeLessThanOrEqual(room.x + room.w - IN + 1e-6);
            expect(pl.z).toBeGreaterThanOrEqual(room.z + IN - 1e-6);
            expect(pl.z).toBeLessThanOrEqual(room.z + room.d - IN + 1e-6);
          });
          checkedRuns++;
        }
      }
    }
    expect(checkedRuns).toBeGreaterThan(300);
  });

  it('every door can be walked through, in both directions', () => {
    for (const d of level.doors) {
      for (const [fromRoom, toRoom, sign] of [
        [d.lowRoom, d.highRoom, 1],
        [d.highRoom, d.lowRoom, -1],
      ]) {
        // Stand 1.5 m in front of the door, facing it.
        const x = d.orient === 'h' ? d.centre : d.line - 1.5 * sign;
        const z = d.orient === 'h' ? d.line - 1.5 * sign : d.centre;
        const yaw = d.orient === 'h' ? (sign > 0 ? YAWS.south : YAWS.north) : sign > 0 ? YAWS.east : YAWS.west;
        const p = createPlayer({ x, y: d.floor, z, yaw });
        expect(level.roomAt(p.x, p.z).id).toBe(fromRoom);
        settle(p, level.boxes);
        walk(p, level.boxes, { forward: 1 }, 0.8, 1 / 60);
        const now = level.roomAt(p.x, p.z);
        expect(now?.id, `door between ${d.rooms} from Room ${fromRoom}`).toBe(toRoom);
      }
    }
  });

  it('random wandering for a long time never leaves the palace or ends up inside anything solid', () => {
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const game = createGame(level);
    const p = game.player;
    const inSomeRoom = (x, z) => level.rooms.some((r) => x >= r.x - 1e-6 && x <= r.x + r.w + 1e-6 && z >= r.z - 1e-6 && z <= r.z + r.d + 1e-6);
    let input = {};
    for (let frame = 0; frame < 60 * 60 * 3; frame++) {
      if (frame % 45 === 0) {
        input = { forward: rand() * 2 - 1, strafe: rand() * 2 - 1, run: rand() < 0.5, jump: rand() < 0.2 };
        p.yaw += (rand() - 0.5) * 3;
      }
      game.update(1 / 60, input);
      expect(inSomeRoom(p.x, p.z), `left the palace at frame ${frame}: ${p.x}, ${p.z}`).toBe(true);
      for (const b of level.boxes) {
        if (playerOverlaps(p.x, p.y, p.z, b, R - 0.001, PLAYER.height - 0.002)) {
          throw new Error(`Player is inside a ${b.kind} box at frame ${frame}`);
        }
      }
    }
  });
});
