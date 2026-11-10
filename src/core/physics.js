// Player movement and collision. No graphics code here, so it can be tested automatically.
//
// The player is an upright box (radius 0.3 m, height 1.7 m). Every frame the movement is
// cut into small steps of at most 0.1 m. Walls are at least 0.2 m thick, so a step can
// never jump over a wall, no matter how fast the player moves or how slow the device is.
// Each step moves along one axis at a time (east-west, then north-south, then up-down)
// and, if the player ends up inside a box, pushes them back out to the box's surface.

export const PLAYER = {
  radius: 0.3,
  height: 1.7,
  eyeHeight: 1.6,
  walkSpeed: 4.5, // metres per second
  runSpeed: 7.5,
  jumpSpeed: 7, // jump reaches about 1.2 m
  gravity: 20,
  maxFallSpeed: 40,
};

export const MAX_STEP = 0.1;
const PEN = 1e-6; // overlaps smaller than this are just touching

export function createPlayer(spawn) {
  return {
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: spawn.yaw ?? 0, // 0 = facing north; turning left increases it
    pitch: 0,
    grounded: false,
  };
}

/** Is the player (feet at x,y,z) overlapping box b? */
export function playerOverlaps(x, y, z, b, r = PLAYER.radius, h = PLAYER.height) {
  return (
    x + r > b.min[0] + PEN &&
    x - r < b.max[0] - PEN &&
    y + h > b.min[1] + PEN &&
    y < b.max[1] - PEN &&
    z + r > b.min[2] + PEN &&
    z - r < b.max[2] - PEN
  );
}

/**
 * Moves the player by (dx, dy, dz) metres, stopping at any solid box.
 * Returns which axes were blocked.
 */
export function moveAndCollide(p, dx, dy, dz, boxes) {
  const r = PLAYER.radius;
  const h = PLAYER.height;
  // Only consider boxes near the path this frame (faster on phones).
  const minX = Math.min(p.x, p.x + dx) - r - 0.01;
  const maxX = Math.max(p.x, p.x + dx) + r + 0.01;
  const minY = Math.min(p.y, p.y + dy) - 0.01;
  const maxY = Math.max(p.y, p.y + dy) + h + 0.01;
  const minZ = Math.min(p.z, p.z + dz) - r - 0.01;
  const maxZ = Math.max(p.z, p.z + dz) + r + 0.01;
  const near = boxes.filter(
    (b) => b.max[0] > minX && b.min[0] < maxX && b.max[1] > minY && b.min[1] < maxY && b.max[2] > minZ && b.min[2] < maxZ
  );

  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / MAX_STEP));
  const sx = dx / steps;
  const sy = dy / steps;
  const sz = dz / steps;
  const hit = { x: false, y: false, z: false, landed: false, ceiling: false };

  for (let i = 0; i < steps; i++) {
    if (sx !== 0 && !hit.x) {
      p.x += sx;
      for (const b of near) {
        if (playerOverlaps(p.x, p.y, p.z, b)) {
          p.x = sx > 0 ? b.min[0] - r : b.max[0] + r;
          hit.x = true;
        }
      }
    }
    if (sz !== 0 && !hit.z) {
      p.z += sz;
      for (const b of near) {
        if (playerOverlaps(p.x, p.y, p.z, b)) {
          p.z = sz > 0 ? b.min[2] - r : b.max[2] + r;
          hit.z = true;
        }
      }
    }
    if (sy !== 0 && !hit.y) {
      p.y += sy;
      for (const b of near) {
        if (playerOverlaps(p.x, p.y, p.z, b)) {
          if (sy < 0) {
            p.y = b.max[1];
            hit.landed = true;
          } else {
            p.y = b.min[1] - h;
            hit.ceiling = true;
          }
          hit.y = true;
        }
      }
    }
  }
  return hit;
}

/**
 * Advances the player by dt seconds.
 * input = { forward: -1..1, strafe: -1..1 (right is +), run: bool, jump: bool }
 */
export function stepPlayer(p, input, boxes, dt) {
  dt = Math.min(Math.max(dt, 0), 0.05); // a long freeze is treated as one short step

  let f = input.forward || 0;
  let s = input.strafe || 0;
  const len = Math.hypot(f, s);
  if (len > 1) {
    f /= len;
    s /= len;
  }
  const speed = input.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  // forward = (-sin, -cos), right = (cos, -sin)
  p.vx = (-sin * f + cos * s) * speed;
  p.vz = (-cos * f - sin * s) * speed;

  if (input.jump && p.grounded) {
    p.vy = PLAYER.jumpSpeed;
  }
  p.vy = Math.max(p.vy - PLAYER.gravity * dt, -PLAYER.maxFallSpeed);

  const hit = moveAndCollide(p, p.vx * dt, p.vy * dt, p.vz * dt, boxes);
  p.grounded = hit.landed;
  if (hit.landed || hit.ceiling) p.vy = 0;
  return hit;
}
