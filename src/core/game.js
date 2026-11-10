// Game rules that are not graphics: moving the player, chasm respawn, which room you are in.

import { createPlayer, stepPlayer } from './physics.js';
import { rectContains } from '../level/geometry.js';

export function createGame(level) {
  const player = createPlayer(level.spawn);
  const state = {
    player,
    room: level.roomAt(player.x, player.z),
    respawns: 0,
    events: [], // e.g. { type: 'respawn' }; read and cleared by the UI
  };

  function placeAt(spot) {
    player.x = spot.x;
    player.y = spot.y;
    player.z = spot.z;
    player.vx = player.vy = player.vz = 0;
    player.yaw = spot.yaw ?? player.yaw;
    player.pitch = 0;
    player.grounded = false;
  }

  // The game advances in fixed 1/60 s steps. On a slow device (few frames per second) several
  // steps run per frame, so walking speed stays the same instead of turning into slow motion.
  const STEP = 1 / 60;
  let pending = 0;
  function update(dt, input) {
    pending = Math.min(pending + Math.max(dt, 0), 0.25); // after a long pause, don't fast-forward
    while (pending >= STEP) {
      pending -= STEP;
      tick(input);
    }
  }

  function tick(input) {
    stepPlayer(player, input, level.boxes, STEP);

    // Fell into a chasm? Back to the top.
    for (const c of level.chasms) {
      if (player.y < c.killY && rectContains(c, player.x, player.z, 0.5)) {
        placeAt(c.respawn);
        state.respawns++;
        state.events.push({ type: 'respawn', room: c.room });
        break;
      }
    }
    // Safety net: anyone far below the level goes back to the start.
    if (player.y < level.globalKillY) {
      placeAt(level.spawn);
      state.respawns++;
      state.events.push({ type: 'respawn', room: null });
    }

    state.room = level.roomAt(player.x, player.z) || state.room;
  }

  return { player, state, update, placeAt, level };
}
