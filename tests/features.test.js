// Tests for stairs, ramps, curved walls, pillar grids and doors between different floor heights.
import { describe, it, expect } from 'vitest';
import { buildLevel } from '../src/level/build.js';
import { validateLevel } from '../src/level/validate.js';
import { createPlayer, stepPlayer, playerOverlaps, PLAYER } from '../src/core/physics.js';
import { compassPoint } from '../src/level/geometry.js';
import palace from '../src/level/palace.js';

const level = buildLevel(palace);
const R = PLAYER.radius;
const YAW = { north: 0, west: Math.PI / 2, south: Math.PI, east: -Math.PI / 2 };

function run(p, input, seconds, boxes = level.boxes, each) {
  for (let t = 0; t < seconds; t += 1 / 60) {
    stepPlayer(p, input, boxes, 1 / 60);
    each?.(p);
  }
}
const at = (x, z, yaw = 0) => {
  const p = createPlayer({ x, y: level.groundAt(x, z), z, yaw });
  run(p, {}, 0.2);
  return p;
};

describe('stairs', () => {
  const st = level.stairs[0];

  it('walking up the stairs reaches the upper room, without jumping', () => {
    const p = at(st.x - 1.5, st.z + st.d / 2, YAW.east);
    let maxRisePerFrame = 0;
    let lastY = p.y;
    run(p, { forward: 1 }, 3, level.boxes, (pl) => {
      maxRisePerFrame = Math.max(maxRisePerFrame, pl.y - lastY);
      lastY = pl.y;
    });
    expect(level.roomAt(p.x, p.z).id).toBe(9);
    expect(p.y).toBeCloseTo(1.8, 5);
    expect(maxRisePerFrame).toBeLessThan(0.36); // one step at a time
  });

  it('walking down the stairs keeps the player on the ground (no bouncing)', () => {
    const p = at(26, st.z + st.d / 2, YAW.west);
    let airborneFrames = 0;
    run(p, { forward: 1 }, 2.5, level.boxes, (pl) => {
      if (!pl.grounded) airborneFrames++;
    });
    expect(level.roomAt(p.x, p.z).id).toBe(4);
    expect(p.y).toBeCloseTo(0, 5);
    expect(airborneFrames).toBe(0);
  });

  it('a 1 m pedestal is NOT climbable by walking into it', () => {
    const it0 = level.items[0];
    const p = at(it0.x, it0.z + 2, YAW.north);
    const y0 = p.y;
    run(p, { forward: 1 }, 2);
    expect(p.y).toBe(y0);
    expect(p.z).toBeGreaterThanOrEqual(it0.z + 0.3 + R - 1e-6);
  });

  it('rejects stairs that are too steep', () => {
    const data = structuredClone(palace);
    data.stairs = [{ x: 20, z: 12, w: 1, d: 2, up: 'east', top: 1.8 }];
    expect(validateLevel(data).some((e) => e.includes('too steep'))).toBe(true);
  });
});

describe('ramps', () => {
  const rp = level.ramps[0];

  it('walking up the ramp is smooth and reaches the next room', () => {
    const p = at(rp.x + rp.w / 2, rp.z + rp.d + 1.5, YAW.north);
    let maxRise = 0;
    let lastY = p.y;
    run(p, { forward: 1 }, 3, level.boxes, (pl) => {
      maxRise = Math.max(maxRise, pl.y - lastY);
      lastY = pl.y;
    });
    expect(level.roomAt(p.x, p.z).id).toBe(2);
    expect(p.y).toBeCloseTo(0, 5);
    expect(maxRise).toBeLessThan(0.1); // small steps only: feels like a slope
  });

  it('rejects ramps steeper than 40 degrees', () => {
    const data = structuredClone(palace);
    data.ramps = [{ x: -1.5, z: 23, w: 3, d: 1, up: 'north', top: 0 }];
    expect(validateLevel(data).some((e) => e.includes('too steep'))).toBe(true);
  });
});

describe('curved walls', () => {
  const c = level.curves[0];

  it('blocks the player from inside, at every angle along the curve', () => {
    let checked = 0;
    for (let a = c.start + 3; a <= c.start + c.sweep - 3; a += 3) {
      const yaw = (-a * Math.PI) / 180; // face outwards along this compass angle
      const p = at(c.cx, c.cz, yaw);
      run(p, { forward: 1, run: true }, 1.5, level.boxes, (pl) => {
        expect(Math.hypot(pl.x - c.cx, pl.z - c.cz)).toBeLessThan(c.r);
      });
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('blocks the player from outside too', () => {
    for (let a = c.start + 5; a <= c.start + c.sweep - 5; a += 10) {
      const start = compassPoint(c.cx, c.cz, c.r + 1.2, a);
      const yaw = (-(a + 180) * Math.PI) / 180; // face the centre
      const p = at(start.x, start.z, yaw);
      run(p, { forward: 1, run: true }, 1.5, level.boxes, (pl) => {
        expect(Math.hypot(pl.x - c.cx, pl.z - c.cz)).toBeGreaterThan(c.r);
      });
    }
  });
});

describe('pillar grids', () => {
  it('every pillar blocks the player, from all four sides', () => {
    for (const pl of level.pillars) {
      for (const [dir, yaw] of Object.entries(YAW)) {
        const off = { north: [0, 1.2], south: [0, -1.2], west: [1.2, 0], east: [-1.2, 0] }[dir];
        const p = at(pl.x + off[0], pl.z + off[1], yaw);
        let minGap = Infinity;
        run(p, { forward: 1, run: true }, 1, level.boxes, (q) => {
          minGap = Math.min(minGap, Math.max(Math.abs(q.x - pl.x), Math.abs(q.z - pl.z)));
        });
        // checked every frame: the player never gets inside the pillar
        expect(minGap).toBeGreaterThanOrEqual(pl.size / 2 + R - 1e-6);
        expect(minGap).toBeLessThan(pl.size / 2 + R + 0.01); // ...and actually reached it
      }
    }
    expect(level.pillars.length).toBe(8);
  });
});

describe('doors between different floor heights', () => {
  it('the door sits at the higher floor', () => {
    const d = level.doors.find((dr) => dr.rooms.includes(9));
    expect(d.floor).toBe(1.8);
  });

  it('rejects a door that would be taller than a room', () => {
    const data = structuredClone(palace);
    data.rooms.find((r) => r.id === 4).height = 3.5; // door top is 1.8 + 2.4 = 4.2
    expect(validateLevel(data).some((e) => e.includes('too tall'))).toBe(true);
  });

  it('nothing in the palace starts overlapping the spawn point', () => {
    const s = level.spawn;
    expect(level.boxes.some((b) => playerOverlaps(s.x, s.y, s.z, b))).toBe(false);
  });
});
