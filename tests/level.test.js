import { describe, it, expect } from 'vitest';
import { buildLevel } from '../src/level/build.js';
import { validateLevel } from '../src/level/validate.js';
import { createGame } from '../src/core/game.js';
import { PLAYER } from '../src/core/physics.js';
import palace from '../src/level/palace.js';

describe('level file', () => {
  it('the palace level has no problems', () => {
    expect(validateLevel(palace)).toEqual([]);
  });

  it('builds walls, floors and ceilings for every room', () => {
    const level = buildLevel(palace);
    for (const r of level.rooms) {
      expect(level.boxes.some((b) => b.kind === 'floor' && b.room === r.id)).toBe(true);
      // rooms open to the sky have no ceiling
      expect(level.boxes.some((b) => b.kind === 'ceiling' && b.room === r.id)).toBe(!r.sky);
    }
    expect(level.boxes.filter((b) => b.kind === 'wall').length).toBeGreaterThan(10);
  });

  it('room numbers are unique', () => {
    const ids = palace.rooms.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reports mistakes in plain English', () => {
    const bad = {
      rooms: [
        { id: 1, x: 0, z: 0, w: 5, d: 5 },
        { id: 2, x: 4, z: 0, w: 5, d: 5 }, // overlaps room 1
        { id: 3, x: 20, z: 0, w: 5, d: 5 },
      ],
      doors: [{ between: [1, 3] }], // rooms do not touch
      spawn: { x: 100, z: 100 },
    };
    const errors = validateLevel(bad);
    expect(errors.some((e) => e.includes('overlap'))).toBe(true);
    expect(errors.some((e) => e.includes('do not touch'))).toBe(true);
    expect(errors.some((e) => e.includes('spawn'))).toBe(true);
    expect(() => buildLevel(bad)).toThrow(/problems/);
  });

  it('rejects a door that is wider than the shared wall', () => {
    const errors = validateLevel({
      rooms: [
        { id: 1, x: 0, z: 0, w: 5, d: 5 },
        { id: 2, x: 5, z: 0, w: 5, d: 5 },
      ],
      doors: [{ between: [1, 2], width: 5 }],
      spawn: { x: 2, z: 2 },
    });
    expect(errors.some((e) => e.includes('does not fit'))).toBe(true);
  });
});

describe('chasms', () => {
  const level = buildLevel(palace);
  const chasm = level.chasms[0];

  it('falling into a chasm sends the player back to the top', () => {
    const game = createGame(level);
    game.placeAt({ x: chasm.x + chasm.w / 2, y: chasm.floor + 0.5, z: chasm.z + chasm.d / 2, yaw: 0 });
    let fellBelowFloor = false;
    for (let i = 0; i < 180 && game.state.respawns === 0; i++) {
      game.update(1 / 60, {});
      if (game.player.y < chasm.floor - 1) fellBelowFloor = true;
    }
    expect(fellBelowFloor).toBe(true);
    expect(game.state.respawns).toBe(1);
    expect(game.player.x).toBe(chasm.respawn.x);
    expect(game.player.z).toBe(chasm.respawn.z);
    expect(game.player.y).toBe(chasm.floor);
    expect(game.state.events.at(-1).type).toBe('respawn');
  });

  it('walking off the edge into the chasm also respawns', () => {
    const game = createGame(level);
    // stand 1 m west of the chasm, facing east, and walk
    game.placeAt({ x: chasm.x - 1, y: chasm.floor, z: chasm.z + chasm.d / 2, yaw: -Math.PI / 2 });
    for (let i = 0; i < 240 && game.state.respawns === 0; i++) game.update(1 / 60, { forward: 0.5 });
    expect(game.state.respawns).toBe(1);
  });

  it('a running jump clears the chasm', () => {
    const game = createGame(level);
    game.placeAt({ x: chasm.x - 3, y: chasm.floor, z: chasm.z + chasm.d / 2, yaw: -Math.PI / 2 });
    for (let i = 0; i < 10; i++) game.update(1 / 60, {});
    let jumped = false;
    for (let i = 0; i < 120; i++) {
      const nearEdge = game.player.x > chasm.x - PLAYER.radius - 0.3;
      game.update(1 / 60, { forward: 1, run: true, jump: nearEdge && !jumped });
      if (nearEdge) jumped = true;
    }
    expect(game.state.respawns).toBe(0);
    expect(game.player.x).toBeGreaterThan(chasm.x + chasm.w);
    expect(game.player.y).toBe(chasm.floor);
  });

  it('the player cannot slip sideways out of a chasm under the floor', () => {
    const game = createGame(level);
    game.placeAt({ x: chasm.x + chasm.w / 2, y: chasm.floor - 2, z: chasm.z + chasm.d / 2, yaw: Math.PI / 2 });
    // try walking west (under the floor) while falling
    for (let i = 0; i < 20; i++) {
      game.update(1 / 60, { forward: 1, run: true });
      expect(game.player.x).toBeGreaterThanOrEqual(chasm.x + PLAYER.radius - 1e-6);
    }
  });
});
