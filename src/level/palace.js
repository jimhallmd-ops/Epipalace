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
//  items   : numbered spots where mnemonic objects will go later. For now they
//            appear as numbered pedestals.
//  spawn   : where the player starts, and which way they face.
//
//  THIS IS A PLACEHOLDER LAYOUT. It is not based on the sketches yet.
// ============================================================================

export default {
  name: 'EpiPalace (placeholder layout)',

  // Values used whenever a room/door does not say otherwise.
  defaults: {
    height: 4, // room height, floor to ceiling
    wallThickness: 0.3,
    floorThickness: 0.3,
    ceilingThickness: 0.3,
    doorWidth: 1.6,
    doorHeight: 2.6,
    chasmDepth: 14, // how far down a chasm goes
  },

  spawn: { x: 0, z: 27, facing: 'north' },

  rooms: [
    { id: 1, name: 'Entrance', x: -6, z: 20, w: 12, d: 10, color: '#f2e2b8' },
    { id: 2, name: 'Central Hall', x: -8, z: 6, w: 16, d: 14, color: '#cfe6d2' },
    { id: 3, name: 'Left Wing', x: -24, z: 8, w: 16, d: 10, color: '#d6dcf5' },
    { id: 4, name: 'Right Wing', x: 8, z: 8, w: 16, d: 10, color: '#f5d6dc' },
    { id: 5, name: 'Left Corridor', x: -6, z: -6, w: 4, d: 12, color: '#e6e0d0' },
    { id: 6, name: 'Top-Left Branch', x: -18, z: -18, w: 16, d: 12, height: 6, color: '#d2ecef' },
    { id: 7, name: 'Right Corridor', x: 2, z: -6, w: 4, d: 12, color: '#e6e0d0' },
    { id: 8, name: 'Top-Right Branch (chasm)', x: 2, z: -18, w: 16, d: 12, color: '#efe0f5' },
  ],

  doors: [
    { between: [1, 2] },
    { between: [2, 3] },
    { between: [2, 4] },
    { between: [2, 5] },
    { between: [5, 6] },
    { between: [2, 7] },
    { between: [7, 8] },
  ],

  chasms: [
    // A 2.5 m gap across the whole of Room 8. Run (Shift) and jump (Space) to cross it.
    { room: 8, x: 8, z: -18, w: 2.5, d: 12, respawn: { x: 4, z: -9, facing: 'east' } },
  ],

  walls: [
    // A short free-standing partition in the Right Wing, to show the format.
    { x1: 16, z1: 8, x2: 16, z2: 12 },
  ],

  items: [
    { id: 1, room: 1, x: -3, z: 23 },
    { id: 2, room: 3, x: -20, z: 13 },
    { id: 3, room: 4, x: 20, z: 13 },
    { id: 4, room: 6, x: -14, z: -14 },
    { id: 5, room: 8, x: 15, z: -12 },
  ],
};
