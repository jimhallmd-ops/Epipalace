// ============================================================================
//  EPIPALACE LEVEL FILE (the one place where the palace layout is defined)
// ============================================================================
//  Both the 3D visuals AND the collision (what blocks the player) are built
//  automatically from this file, so they can never disagree.
//
//  HOW TO READ IT
//  - Units are metres. A person is about 1.7 m tall; a standard door is 1.6 m wide here.
//  - Think of graph paper seen from above (the debug map, key M, shows exactly this):
//      x = distance to the EAST  (to the right on the map)
//      z = distance to the SOUTH (down on the map)
//  - A rectangle { x, z, w, d } starts at its top-left (north-west) corner (x, z),
//    is w metres wide (east-west) and d metres deep (north-south).
//
//  WHAT GOES WHERE
//  rooms   : every walkable space, including corridors. Walls are created
//            automatically around every room edge. Rooms must not overlap.
//  doors   : an opening in the wall between two rooms that touch. Written as
//            { between: [roomA, roomB] }. Optional: width, offset (metres to slide
//            the door along the wall from the centre of the shared edge).
//  chasms  : holes in a room floor. Falling in sends the player back to `respawn`
//            (a spot on solid floor at the top).
//  walls   : extra free-standing walls inside rooms (optional), from (x1,z1) to (x2,z2),
//            must run straight east-west or north-south.
//  stairs  : { x, z, w, d, up, top } a flight of steps inside a room. `up` is the direction
//            you walk to go up (north/east/south/west); `top` is the height reached.
//  ramps   : same as stairs, but a smooth slope.
//  curves  : curved walls { cx, cz, r, start, end }: centre, radius and compass angles
//            (0 = north, 90 = east), drawn clockwise from start to end.
//  pillars : a grid of pillars { x, z, w, d, rows, cols, size, shape: 'round' | 'square' }.
//  platforms, ladders, water, triggers, open-air rooms (sky, sides) and door leaves
//  (swing / slide / secret) are described in PROJECT.md, section "Level format".
//  items   : numbered spots where mnemonic objects will go later. For now they
//            appear as numbered pedestals.
//  spawn   : where the player starts, and which way they face.
//
//  EASIEST WAY TO EDIT: open epipalace.com/editor, which reads and writes this file.
//  THIS IS A PLACEHOLDER LAYOUT. It is not based on the sketches yet.
// ============================================================================

export default {
  name: 'EpiPalace (placeholder layout)',

  // Values used whenever a room/door does not say otherwise.
  defaults: {
    height: 3.5, // room height, floor to ceiling
    wallThickness: 0.3,
    floorThickness: 0.3,
    ceilingThickness: 0.3,
    doorWidth: 1.2,
    doorHeight: 2.4,
    chasmDepth: 14, // how far down a chasm goes
    stepHeight: 0.18, // height of one stair step
  },

  spawn: { x: 0, z: 28, facing: 'north' },

  rooms: [
    { id: 1, name: 'Entrance', x: -6, z: 20, w: 12, d: 10, floor: -1, height: 4.5, color: '#f2e2b8' },
    { id: 2, name: 'Central Hall', x: -8, z: 6, w: 16, d: 14, height: 5, color: '#cfe6d2' },
    { id: 3, name: 'Left Wing', x: -24, z: 8, w: 16, d: 10, color: '#d6dcf5' },
    { id: 4, name: 'Right Wing', x: 8, z: 8, w: 16, d: 10, height: 5, color: '#f5d6dc' },
    { id: 5, name: 'Left Corridor', x: -5.5, z: -6, w: 3, d: 12, height: 3, color: '#e6e0d0' },
    { id: 6, name: 'Top-Left Branch', x: -18, z: -18, w: 16, d: 12, height: 6, color: '#d2ecef' },
    { id: 7, name: 'Right Corridor', x: 2.5, z: -6, w: 3, d: 12, height: 3, color: '#e6e0d0' },
    { id: 8, name: 'Top-Right Branch (chasm)', x: 2, z: -18, w: 16, d: 12, color: '#efe0f5' },
    // A balcony: its west side is a railing overlooking the Right Wing; the stairs arrive through a gap.
    { id: 9, name: 'Upper Gallery', x: 24, z: 8, w: 10, d: 10, floor: 1.8, color: '#e3f0d0', sides: { west: 'railing' } },
    // Open to the sky, with a railing on the west side and an open east side.
    { id: 10, name: 'Courtyard', x: -24, z: 18, w: 15, d: 12, sky: true, sides: { west: 'railing', east: 'open' }, color: '#dcebd2' },
    { id: 11, name: 'Secret Study', x: 34, z: 10, w: 6, d: 6, floor: 1.8, color: '#f0e6d2' },
    { id: 12, name: 'Hidden Alcove', x: -20, z: 30, w: 6, d: 4, color: '#f0e6d2' },
  ],

  doors: [
    { between: [1, 2] },
    { between: [2, 3] },
    { between: [2, 4] },
    { between: [2, 5] },
    { between: [5, 6] },
    { between: [2, 7], leaf: 'slide', opens: 'auto' }, // slides open as you walk up to it
    { between: [7, 8] },
    { between: [3, 10], leaf: 'swing' }, // a real door: press E (or Use) to open it
    { between: [9, 11], leaf: 'secret', trigger: 'gallery-lever' }, // looks like wall until the lever is pulled
    { between: [10, 12], leaf: 'secret', trigger: 'courtyard-plate' }, // opens when you step on the plate
  ],

  triggers: [
    { name: 'gallery-lever', type: 'lever', x: 31, z: 16.8 },
    { name: 'courtyard-plate', type: 'plate', x: -11, z: 28 },
  ],

  chasms: [
    // A 2.5 m gap across the whole of Room 8. Run (Shift) and jump (Space) to cross it.
    { room: 8, x: 8, z: -18, w: 2.5, d: 12, respawn: { x: 4, z: -9, facing: 'east' } },
  ],

  walls: [
    // A short free-standing partition in the Right Wing, to show the format.
    { x1: 16, z1: 8, x2: 16, z2: 12 },
    // A diagonal wall cutting off the north-west corner of the Top-Left Branch.
    { x1: -18, z1: -15, x2: -15, z2: -18 },
  ],

  platforms: [
    // A raised lookout in the Courtyard, 1.5 m up, reached by a ladder, with railings.
    { x: -13, z: 19, w: 4, d: 4, top: 1.5, railings: ['west', 'south'] },
  ],

  ladders: [
    // Leans on the lookout's west edge; you face east while climbing.
    { x: -13, z: 21, facing: 'east', top: 1.5 },
  ],

  water: [
    // A 2.5 m deep pool in the Courtyard: swim with Space (up) and C (dive).
    { x: -21, z: 21, w: 7, d: 6, depth: 2.5 },
  ],

  stairs: [
    // Up from the Right Wing (floor 0) to the door of the Upper Gallery (floor 1.8).
    { x: 20, z: 12, w: 4, d: 2, up: 'east', top: 1.8 },
  ],

  ramps: [
    // The Entrance floor is 1 m lower than the Central Hall: a gentle ramp leads up to the door.
    { x: -1.5, z: 20, w: 3, d: 5, up: 'north', top: 0 },
  ],

  curves: [
    // A curved screen wall in the Top-Left Branch, open to the east.
    { cx: -10, cz: -12, r: 3, start: 210, end: 330 },
  ],

  pillars: [
    // Two rows of four round pillars in the Left Wing.
    { x: -22, z: 10, w: 12, d: 6, rows: 2, cols: 4, size: 0.6, shape: 'round' },
  ],

  items: [
    { id: 1, room: 1, x: -3, z: 23 },
    { id: 2, room: 3, x: -20, z: 13 },
    { id: 3, room: 4, x: 12, z: 15 },
    { id: 4, room: 6, x: -14, z: -14 },
    { id: 5, room: 8, x: 15, z: -12 },
    { id: 6, room: 9, x: 30, z: 13 },
    { id: 7, room: 11, x: 37, z: 13 },
    { id: 8, room: 12, x: -17, z: 32 },
  ],
};
