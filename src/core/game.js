// Game rules that are not graphics: moving the player, doors and triggers, chasm respawn,
// which room you are in.

import { createPlayer, stepPlayer, playerOverlaps, PLAYER } from './physics.js';
import { rectContains } from '../level/geometry.js';

const USE_RANGE = 2.0; // metres: how close you must be to open a door or pull a lever
const AUTO_OPEN = 2.4; // automatic doors open when you are this close...
const AUTO_CLOSE = 3.2; // ...and close again when you are this far away

export function createGame(level) {
  const player = createPlayer(level.spawn);
  const state = {
    player,
    room: level.roomAt(player.x, player.z),
    respawns: 0,
    events: [], // e.g. { type: 'respawn' } / { type: 'secret' }; read and cleared by the UI
    target: null, // what the Use key would act on now: { kind, label }
  };

  // ---- Doors with a leaf, and triggers ----
  const doors = level.doors
    .filter((d) => d.leaf !== 'none')
    .map((d) => ({ def: d, open: false, t: 0 })); // t: 0 = closed ... 1 = fully open
  const triggers = level.triggers.map((tr) => ({ def: tr, fired: false }));
  state.doors = doors;
  state.triggers = triggers;

  const world = { boxes: level.boxes, ladders: level.ladders, water: level.water };
  let solidDoorsKey = '';
  function refreshWorld() {
    const closed = doors.filter((d) => !d.open && d.t === 0);
    const key = closed.map((d) => d.def.index).join(',');
    if (key === solidDoorsKey) return;
    solidDoorsKey = key;
    world.boxes = closed.length ? level.boxes.concat(closed.map((d) => d.def.leafBox)) : level.boxes;
  }
  solidDoorsKey = null;
  refreshWorld();

  const centreOf = (d) => (d.def.orient === 'h' ? { x: d.def.centre, z: d.def.line } : { x: d.def.line, z: d.def.centre });
  const blockedByPlayer = (d) => {
    const b = d.def.leafBox;
    const grown = { min: [b.min[0] - 0.05, b.min[1], b.min[2] - 0.05], max: [b.max[0] + 0.05, b.max[1], b.max[2] + 0.05] };
    return playerOverlaps(player.x, player.y, player.z, grown);
  };

  function fire(trigger) {
    if (trigger.fired) return;
    trigger.fired = true;
    let opened = 0;
    for (const d of doors) {
      if (d.def.trigger === trigger.def.name && !d.open) {
        d.open = true;
        opened++;
      }
    }
    state.events.push({ type: 'trigger', name: trigger.def.name, opened });
  }

  /** Finds what the Use key would act on: the nearest door or lever in front of the player. */
  function findTarget() {
    const look = [-Math.sin(player.yaw), -Math.cos(player.yaw)];
    let best = null;
    const consider = (kind, ref, x, z, y, label) => {
      const dx = x - player.x;
      const dz = z - player.z;
      const dist = Math.hypot(dx, dz);
      if (dist > USE_RANGE || Math.abs(y - player.y) > 1.5) return;
      const facing = dist < 0.7 || (dx * look[0] + dz * look[1]) / dist > 0.35;
      if (facing && (!best || dist < best.dist)) best = { kind, ref, dist, label };
    };
    for (const d of doors) {
      const c = centreOf(d);
      if (d.def.leaf === 'secret') continue; // secret doors give nothing away
      if (d.def.trigger) {
        if (!d.open) consider('locked', d, c.x, c.z, d.def.floor, 'Locked: something else opens this door');
      } else if (d.def.opens === 'use') consider('door', d, c.x, c.z, d.def.floor, d.open ? 'Close door' : 'Open door');
    }
    for (const tr of triggers) {
      if (tr.def.type === 'lever' && !tr.fired) consider('lever', tr, tr.def.x, tr.def.z, tr.def.y, 'Pull lever');
    }
    return best;
  }

  function use() {
    const target = findTarget();
    if (!target) return;
    if (target.kind === 'door') {
      target.ref.open = !target.ref.open;
    } else if (target.kind === 'lever') {
      fire(target.ref);
    }
  }

  function updateDoors(dt) {
    for (const d of doors) {
      const c = centreOf(d);
      if (d.def.opens === 'auto' && !d.def.trigger) {
        const dist = Math.hypot(player.x - c.x, player.z - c.z);
        if (dist < AUTO_OPEN) d.open = true;
        else if (dist > AUTO_CLOSE) d.open = false;
      }
      const speed = d.def.leaf === 'secret' ? 0.7 : 2; // secret doors grind open slowly
      if (d.open) d.t = Math.min(1, d.t + speed * dt);
      else if (d.t > 0) {
        d.t = Math.max(0, d.t - speed * dt);
        // Never close a door on the player: if they are in the doorway, it opens again.
        if (d.t === 0 && blockedByPlayer(d)) d.open = true;
      }
    }
    for (const tr of triggers) {
      if (tr.def.type === 'plate' && player.grounded && Math.abs(player.x - tr.def.x) <= 0.6 && Math.abs(player.z - tr.def.z) <= 0.6) fire(tr);
    }
    refreshWorld();
  }

  function placeAt(spot) {
    player.x = spot.x;
    player.y = spot.y;
    player.z = spot.z;
    player.vx = player.vy = player.vz = 0;
    player.yaw = spot.yaw ?? player.yaw;
    player.pitch = 0;
    player.grounded = false;
    player.climbing = false;
  }

  // The game advances in fixed 1/60 s steps. On a slow device (few frames per second) several
  // steps run per frame, so walking speed stays the same instead of turning into slow motion.
  const STEP = 1 / 60;
  let pending = 0;
  function update(dt, input) {
    if (input.use) use();
    pending = Math.min(pending + Math.max(dt, 0), 0.25); // after a long pause, don't fast-forward
    while (pending >= STEP) {
      pending -= STEP;
      tick(input);
    }
    const target = findTarget();
    state.target = target ? { kind: target.kind, label: target.label } : null;
  }

  function tick(input) {
    stepPlayer(player, input, world, STEP);
    updateDoors(STEP);

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
    state.underwater = level.water.some(
      (w) => player.x >= w.x && player.x <= w.x + w.w && player.z >= w.z && player.z <= w.z + w.d && player.y + PLAYER.eyeHeight < w.surface
    );
  }

  /** Opens every door at once (used by tests and by the debug console). */
  function openAllDoors() {
    for (const d of doors) {
      d.open = true;
      d.t = 1;
    }
    refreshWorld();
  }

  return { player, state, update, placeAt, level, world, openAllDoors, use, fire: (name) => triggers.filter((t) => t.def.name === name).forEach(fire) };
}
