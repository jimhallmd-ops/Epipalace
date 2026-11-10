// Tests for the map editor's file handling and editing operations.
import { describe, it, expect } from 'vitest';
import { toPalaceJS, parseLevelText, literal } from '../src/editor/serialize.js';
import * as M from '../src/editor/model.js';
import { validateLevel } from '../src/level/validate.js';
import { buildLevel } from '../src/level/build.js';
import palace from '../src/level/palace.js';

const nodeImporter = (text) => import('data:text/javascript;charset=utf-8,' + encodeURIComponent(text));

describe('saving and loading palace.js', () => {
  it('writes a file that loads back exactly the same level', async () => {
    const text = toPalaceJS(palace);
    expect(text).toContain('export default {');
    expect(text).toContain("{ id: 1, name: 'Entrance'");
    const back = await parseLevelText(text, nodeImporter);
    expect(back).toEqual(palace);
  });

  it('the written file is a valid level the game can build', async () => {
    const back = await parseLevelText(toPalaceJS(M.tidy(M.normalize(palace))), nodeImporter);
    expect(validateLevel(back)).toEqual([]);
    expect(() => buildLevel(back)).not.toThrow();
  });

  it('reads the hand-written palace.js in the repo (with comments)', async () => {
    const fs = await import('node:fs');
    const text = fs.readFileSync(new URL('../src/level/palace.js', import.meta.url), 'utf8');
    const back = await parseLevelText(text, nodeImporter);
    expect(back.rooms.length).toBe(palace.rooms.length);
  });

  it('also reads plain JSON, and rejects files that are not levels', async () => {
    expect((await parseLevelText(JSON.stringify(palace), nodeImporter)).rooms.length).toBe(palace.rooms.length);
    await expect(parseLevelText('hello', nodeImporter)).rejects.toThrow(/does not look like a level/);
  });

  it('escapes names safely', async () => {
    const data = { ...palace, name: "Jim's palace \\ test" };
    const back = await parseLevelText(toPalaceJS(data), nodeImporter);
    expect(back.name).toBe("Jim's palace \\ test");
    expect(literal(0.1 + 0.2)).toBe('0.3');
  });
});

describe('editing operations', () => {
  it('moving a room moves everything inside it, and nothing else', () => {
    const data = M.normalize(palace);
    const room4 = data.rooms.find((r) => r.id === 4);
    const stairs = { ...data.stairs[0] };
    const ramp = { ...data.ramps[0] };
    M.moveRoomWithContents(data, room4, 0, 10);
    expect(room4.z).toBe(18);
    expect(data.stairs[0].z).toBe(stairs.z + 10); // stairs are in Room 4
    expect(data.ramps[0].z).toBe(ramp.z); // ramp is in Room 1: unchanged
  });

  it('renumbering a room updates its doors, chasms and items', () => {
    const data = M.normalize(palace);
    const room8 = data.rooms.find((r) => r.id === 8);
    expect(M.renumberRoom(data, room8, 2)).toMatch(/already exists/);
    expect(M.renumberRoom(data, room8, 42)).toBeNull();
    expect(data.doors.some((d) => d.between.includes(42))).toBe(true);
    expect(data.chasms[0].room).toBe(42);
    expect(data.items.find((i) => i.id === 5).room).toBe(42);
    expect(validateLevel(data)).toEqual([]);
  });

  it('deleting a room also deletes its doors', () => {
    const data = M.normalize(palace);
    M.deleteRoom(data, data.rooms.find((r) => r.id === 9));
    expect(data.doors.some((d) => d.between.includes(9))).toBe(false);
  });

  it('finds the shared wall for a new doorway', () => {
    const data = M.normalize(palace);
    const spot = M.doorSpotAt(data, 0, 20.1); // on the wall between Rooms 1 and 2
    expect(spot.between.sort()).toEqual([1, 2]);
    expect(spot.offset).toBeCloseTo(0, 5);
    expect(M.doorSpotAt(data, 0, 25)).toBeNull(); // middle of a room: no wall
  });

  it('picks a respawn point on solid floor next to a new chasm', () => {
    const data = M.normalize(palace);
    const chasm = { room: 2, x: -2, z: 10, w: 2, d: 3 };
    chasm.respawn = M.autoRespawn(data, chasm);
    data.chasms.push(chasm);
    expect(validateLevel(data)).toEqual([]);
  });

  it('a blank level is valid', () => {
    expect(validateLevel(M.tidy(M.blankLevel()))).toEqual([]);
  });
});
