// Draws the level. Every solid surface comes from level.boxes (the same boxes used for collision).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { floorTexture, wallTexture, labelTexture } from './textures.js';
import { PLAYER } from '../core/physics.js';
import { compassPoint, subtractRect } from '../level/geometry.js';
import { RAILING_HEIGHT } from '../level/build.js';

// Proportions review: a 72° vertical view made rooms look stretched and huge. 60° vertical
// (about 90° horizontal on a widescreen) looks natural. On tall phone screens we widen the
// vertical view so the horizontal view never drops below ~65°.
const VERTICAL_FOV = 60;
const MIN_HORIZONTAL_FOV = 65;
function fovFor(aspect) {
  const minV = (2 * Math.atan(Math.tan((MIN_HORIZONTAL_FOV * Math.PI) / 360) / aspect) * 180) / Math.PI;
  return Math.min(Math.max(VERTICAL_FOV, minV), 95);
}

/** A sloped ramp: top surface + sides, from its low end to its high end. */
function rampGeometry(rp) {
  const { x, z, w, d, up, bottom, top, base } = rp;
  // corners of the rectangle, and the height at each corner
  const hAt = (px, pz) => {
    let t;
    if (up === 'north') t = (z + d - pz) / d;
    else if (up === 'south') t = (pz - z) / d;
    else if (up === 'east') t = (px - x) / w;
    else t = (x + w - px) / w;
    return bottom + (top - bottom) * t;
  };
  const c = [
    [x, z],
    [x + w, z],
    [x + w, z + d],
    [x, z + d],
  ];
  const pos = [];
  const tri = (a, b, cc) => pos.push(...a, ...b, ...cc);
  const T = c.map(([px, pz]) => [px, hAt(px, pz), pz]);
  const B = c.map(([px, pz]) => [px, base, pz]);
  // top (two triangles, wound so the normal points up)
  tri(T[0], T[3], T[2]);
  tri(T[0], T[2], T[1]);
  // four sides
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    tri(B[i], T[i], T[j]);
    tri(B[i], T[j], B[j]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const uv = [];
  for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] + pos[i + 1], pos[i + 2] + pos[i + 1]);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** A smooth curved wall (a slice of a thick ring). */
function arcWallGeometry(c) {
  const segs = Math.max(8, Math.ceil(c.sweep / 4));
  const ri = c.r - c.thickness / 2;
  const ro = c.r + c.thickness / 2;
  const pos = [];
  const nor = [];
  const uv = [];
  const push = (p, n, u, v) => {
    pos.push(...p);
    nor.push(...n);
    uv.push(u, v);
  };
  const quad = (a, b, cc, dd, na, nb, nc, nd, ua, ub) => {
    // a-b-c, a-c-d
    push(a, na, ua, a[1]);
    push(b, nb, ub, b[1]);
    push(cc, nc, ub, cc[1]);
    push(a, na, ua, a[1]);
    push(cc, nc, ub, cc[1]);
    push(dd, nd, ua, dd[1]);
  };
  for (let i = 0; i < segs; i++) {
    const a0 = c.start + (c.sweep * i) / segs;
    const a1 = c.start + (c.sweep * (i + 1)) / segs;
    const o0 = compassPoint(c.cx, c.cz, ro, a0);
    const o1 = compassPoint(c.cx, c.cz, ro, a1);
    const i0 = compassPoint(c.cx, c.cz, ri, a0);
    const i1 = compassPoint(c.cx, c.cz, ri, a1);
    const n0 = [Math.sin((a0 * Math.PI) / 180), 0, -Math.cos((a0 * Math.PI) / 180)];
    const n1 = [Math.sin((a1 * Math.PI) / 180), 0, -Math.cos((a1 * Math.PI) / 180)];
    const neg = (n) => n.map((v) => -v);
    const u0 = (c.r * a0 * Math.PI) / 180;
    const u1 = (c.r * a1 * Math.PI) / 180;
    // outer face
    quad([o0.x, c.y0, o0.z], [o0.x, c.y1, o0.z], [o1.x, c.y1, o1.z], [o1.x, c.y0, o1.z], n0, n0, n1, n1, u0, u0);
    // inner face
    quad([i1.x, c.y0, i1.z], [i1.x, c.y1, i1.z], [i0.x, c.y1, i0.z], [i0.x, c.y0, i0.z], neg(n1), neg(n1), neg(n0), neg(n0), u1, u1);
    // top
    const up = [0, 1, 0];
    quad([i0.x, c.y1, i0.z], [i1.x, c.y1, i1.z], [o1.x, c.y1, o1.z], [o0.x, c.y1, o0.z], up, up, up, up, u0, u1);
  }
  // end caps
  for (const [a, sign] of [
    [c.start, -1],
    [c.start + c.sweep, 1],
  ]) {
    const o = compassPoint(c.cx, c.cz, ro, a);
    const ii = compassPoint(c.cx, c.cz, ri, a);
    const rad = (a * Math.PI) / 180;
    const n = [sign * Math.cos(rad), 0, sign * Math.sin(rad)]; // tangent direction
    const P = sign > 0 ? [ii, o] : [o, ii];
    quad([P[0].x, c.y0, P[0].z], [P[0].x, c.y1, P[0].z], [P[1].x, c.y1, P[1].z], [P[1].x, c.y0, P[1].z], n, n, n, n, 0, 0.3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** A box whose texture repeats every `tile` metres in world space, so tiles are the same size everywhere. */
function worldBoxGeometry(b, tile = 1) {
  const sx = b.max[0] - b.min[0];
  const sy = b.max[1] - b.min[1];
  const sz = b.max[2] - b.min[2];
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    if (ny > 0.5) uv.setXY(i, x / tile, z / tile);
    else if (nx > 0.5) uv.setXY(i, z / tile, y / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  return g;
}

/** Vertex colours for chasm walls: lighter near the top edge, black 3.5 m down. */
function shadeByDepth(geo, topY) {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color('#8a8796');
  for (let i = 0; i < pos.count; i++) {
    const k = Math.max(0, 1 - (topY - pos.getY(i)) / 3.5);
    colors[i * 3] = top.r * k;
    colors[i * 3 + 1] = top.g * k;
    colors[i * 3 + 2] = top.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

export function createScene(container, level) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dfe9f2');

  const camera = new THREE.PerspectiveCamera(fovFor(window.innerWidth / window.innerHeight), window.innerWidth / window.innerHeight, 0.05, 200);
  camera.rotation.order = 'YXZ';

  // ---- Lighting: bright and even, so no room is ever dark ----
  scene.add(new THREE.HemisphereLight('#ffffff', '#d8cfc0', 2.2));
  scene.add(new THREE.AmbientLight('#ffffff', 0.5));
  const sun = new THREE.DirectionalLight('#fff6e8', 1.1);
  sun.position.set(0.4, 1, 0.25);
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#e8f0ff', 0.5);
  fill.position.set(-0.5, 0.3, -0.7);
  scene.add(fill);

  // ---- Materials ----
  const floorTex = floorTexture();
  const wallTex = wallTexture();
  const mats = {
    wall: new THREE.MeshLambertMaterial({ color: '#f4f1ea', map: wallTex }),
    lintel: new THREE.MeshLambertMaterial({ color: '#e9e2d3', map: wallTex }),
    sill: new THREE.MeshLambertMaterial({ color: '#d9cfbd' }),
    ceiling: new THREE.MeshLambertMaterial({ color: '#fbfaf6' }),
    // Chasm walls fade from grey at the top to black far below, so the hole reads as deep.
    'pit-wall': new THREE.MeshBasicMaterial({ vertexColors: true }),
    'pit-floor': new THREE.MeshBasicMaterial({ color: '#050508' }),
    item: new THREE.MeshLambertMaterial({ color: '#d4a62a' }),
    stair: new THREE.MeshLambertMaterial({ color: '#e2d9c6', map: floorTex }),
    ramp: new THREE.MeshLambertMaterial({ color: '#ddd3bd', map: floorTex, side: THREE.DoubleSide }),
    pillar: new THREE.MeshLambertMaterial({ color: '#efe9dc' }),
    curve: new THREE.MeshLambertMaterial({ color: '#f4f1ea', map: wallTex, side: THREE.DoubleSide }),
    platform: new THREE.MeshLambertMaterial({ color: '#e2d9c6', map: floorTex }),
    'pool-wall': new THREE.MeshLambertMaterial({ color: '#bfe3ef', map: floorTex }),
    'pool-floor': new THREE.MeshLambertMaterial({ color: '#a9d7e8', map: floorTex }),
    lever: new THREE.MeshLambertMaterial({ color: '#4a5260' }),
    metal: new THREE.MeshLambertMaterial({ color: '#5b6470' }),
    wood: new THREE.MeshLambertMaterial({ color: '#a0743f' }),
    door: new THREE.MeshLambertMaterial({ color: '#8a5a35' }),
    plate: new THREE.MeshLambertMaterial({ color: '#c9bc9c' }),
    ground: new THREE.MeshLambertMaterial({ color: '#c9dcb8' }),
    water: new THREE.MeshLambertMaterial({ color: '#4fa3d9', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
  };
  const floorMats = new Map(); // one per room colour
  const floorMat = (room) => {
    const color = room.color || '#e8e2d4';
    if (!floorMats.has(color)) floorMats.set(color, new THREE.MeshLambertMaterial({ color, map: floorTex }));
    return floorMats.get(color);
  };
  const roomById = new Map(level.rooms.map((r) => [r.id, r]));

  // ---- Solid geometry, merged by material (few draw calls = smooth on phones) ----
  const groups = new Map();
  // Ramp steps, curve posts and pillars are collision-only boxes; they are drawn smoothly below.
  // Railings, diagonal-wall posts and the invisible barriers of open sides are not drawn as boxes either.
  const drawnSeparately = new Set(['ramp-step', 'curve', 'pillar', 'railing', 'diag', 'barrier']);
  for (const b of level.boxes) {
    if (drawnSeparately.has(b.kind)) continue;
    const mat = b.kind === 'floor' ? floorMat(roomById.get(b.room)) : mats[b.kind];
    if (!groups.has(mat)) groups.set(mat, []);
    const geo = worldBoxGeometry(b);
    if (b.kind === 'pit-wall') shadeByDepth(geo, b.max[1]);
    groups.get(mat).push(geo);
  }
  for (const [mat, geos] of groups) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    scene.add(mesh);
    geos.forEach((g) => g.dispose());
  }

  // ---- Smooth shapes: ramps, curved walls, pillars ----
  if (level.ramps.length) scene.add(new THREE.Mesh(mergeGeometries(level.ramps.map(rampGeometry)), mats.ramp));
  if (level.curves.length) scene.add(new THREE.Mesh(mergeGeometries(level.curves.map(arcWallGeometry)), mats.curve));
  if (level.pillars.length) {
    const geos = level.pillars.map((pl) => {
      const h = pl.y1 - pl.y0;
      const g =
        pl.shape === 'square'
          ? new THREE.BoxGeometry(pl.size, h, pl.size)
          : new THREE.CylinderGeometry(pl.size / 2, pl.size / 2, h, 20).toNonIndexed();
      g.translate(pl.x, pl.y0 + h / 2, pl.z);
      return pl.shape === 'square' ? g.toNonIndexed() : g;
    });
    scene.add(new THREE.Mesh(mergeGeometries(geos), mats.pillar));
  }

  // ---- Sky (only visible where a room is open to the sky or has open sides) ----
  const sky = (() => {
    const g = new THREE.SphereGeometry(150, 32, 16);
    const pos = g.attributes.position;
    const cols = [];
    const top = new THREE.Color('#7fb8e8');
    const horizon = new THREE.Color('#e3eff7');
    const below = new THREE.Color('#c9dcb8');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 150;
      const c = y >= 0 ? horizon.clone().lerp(top, Math.pow(y, 0.6)) : horizon.clone().lerp(below, Math.min(1, -y * 6));
      cols.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }));
    m.renderOrder = -1;
    scene.add(m);
    return m;
  })();

  // ---- Lawn all round the palace, just below the lowest floor (with holes over chasms and pools) ----
  {
    const y = level.minFloor - level.settings.floorThickness - 0.02;
    const b = level.bounds;
    let pieces = [{ x: b.minX - 300, z: b.minZ - 300, w: b.maxX - b.minX + 600, d: b.maxZ - b.minZ + 600 }];
    for (const h of [...level.chasms, ...level.water]) pieces = pieces.flatMap((p) => subtractRect(p, { x: h.x - 0.3, z: h.z - 0.3, w: h.w + 0.6, d: h.d + 0.6 }));
    const geos = pieces.map((p) => {
      const g = new THREE.PlaneGeometry(p.w, p.d);
      g.rotateX(-Math.PI / 2);
      g.translate(p.x + p.w / 2, y, p.z + p.d / 2);
      return g;
    });
    scene.add(new THREE.Mesh(mergeGeometries(geos), mats.ground));
  }

  // ---- Railings: posts every ~1.2 m with a top rail and a middle rail ----
  if (level.railings.length) {
    const geos = [];
    for (const r of level.railings) {
      const len = Math.hypot(r.x2 - r.x1, r.z2 - r.z1);
      const ang = -Math.atan2(r.z2 - r.z1, r.x2 - r.x1);
      const n = Math.max(1, Math.ceil(len / 1.2));
      for (let i = 0; i <= n; i++) {
        const g = new THREE.BoxGeometry(0.06, RAILING_HEIGHT, 0.06);
        g.translate(r.x1 + ((r.x2 - r.x1) * i) / n, r.y + RAILING_HEIGHT / 2, r.z1 + ((r.z2 - r.z1) * i) / n);
        geos.push(g);
      }
      for (const [hgt, thick] of [
        [RAILING_HEIGHT - 0.03, 0.07],
        [RAILING_HEIGHT * 0.5, 0.035],
      ]) {
        const g = new THREE.BoxGeometry(len, thick, thick);
        g.rotateY(ang);
        g.translate((r.x1 + r.x2) / 2, r.y + hgt, (r.z1 + r.z2) / 2);
        geos.push(g);
      }
    }
    scene.add(new THREE.Mesh(mergeGeometries(geos), mats.metal));
  }

  // ---- Diagonal walls: rotated boxes ----
  for (const w of level.diagonals) {
    const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1) + w.thickness;
    const g = new THREE.BoxGeometry(len, w.y1 - w.y0, w.thickness);
    g.rotateY(-Math.atan2(w.z2 - w.z1, w.x2 - w.x1));
    g.translate((w.x1 + w.x2) / 2, (w.y0 + w.y1) / 2, (w.z1 + w.z2) / 2);
    scene.add(new THREE.Mesh(g, mats.curve));
  }

  // ---- Ladders: two rails and rungs every 30 cm ----
  for (const l of level.ladders) {
    const h = l.top - l.bottom + 1.0; // the rails stick up 1 m above the top, as a handhold
    const along = l.fx === 0 ? [1, 0] : [0, 1];
    const cx = l.x - l.fx * 0.06;
    const cz = l.z - l.fz * 0.06;
    const geos = [];
    for (const sgn of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.06, h, 0.06);
      g.translate(cx + along[0] * sgn * (l.w / 2), l.bottom + h / 2, cz + along[1] * sgn * (l.w / 2));
      geos.push(g);
    }
    for (let y = l.bottom + 0.3; y < l.top + 0.95; y += 0.3) {
      const g = new THREE.BoxGeometry(along[0] ? l.w : 0.04, 0.04, along[1] ? l.w : 0.04);
      g.translate(cx, y, cz);
      geos.push(g);
    }
    scene.add(new THREE.Mesh(mergeGeometries(geos), mats.wood));
  }

  // ---- Water surfaces ----
  for (const w of level.water) {
    const g = new THREE.PlaneGeometry(w.w, w.d);
    g.rotateX(-Math.PI / 2);
    g.translate(w.x + w.w / 2, w.surface, w.z + w.d / 2);
    const m = new THREE.Mesh(g, mats.water);
    m.renderOrder = 2;
    scene.add(m);
  }

  // ---- Doors that open and close (swing, slide) and secret doors (slide down into the floor) ----
  const doorMeshes = new Map(); // door index -> { group, def }
  for (const d of level.doors) {
    if (d.leaf === 'none') continue;
    const group = new THREE.Group();
    if (d.leaf === 'secret') {
      // Same wall texture and thickness as the wall around it: invisible until it opens.
      group.add(new THREE.Mesh(worldBoxGeometry(d.leafBox), mats.wall));
    } else {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(d.orient === 'h' ? d.width : 0.07, d.height, d.orient === 'h' ? 0.07 : d.width), mats.door);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), mats.metal);
      if (d.orient === 'h') {
        group.position.set(d.from, d.floor, d.line); // hinge at the "from" end
        leaf.position.set(d.width / 2, d.height / 2, 0);
        knob.position.set(d.width - 0.12, 1.0, 0);
        knob.scale.set(1, 1, 2.4);
      } else {
        group.position.set(d.line, d.floor, d.from);
        leaf.position.set(0, d.height / 2, d.width / 2);
        knob.position.set(0, 1.0, d.width - 0.12);
        knob.scale.set(2.4, 1, 1);
      }
      group.add(leaf, knob);
    }
    scene.add(group);
    doorMeshes.set(d.index, { group, def: d, base: group.position.clone() });
  }
  function animateDoors(doorStates) {
    for (const ds of doorStates || []) {
      const dm = doorMeshes.get(ds.def.index);
      if (!dm) continue;
      const k = ds.t * ds.t * (3 - 2 * ds.t); // ease in/out
      const d = dm.def;
      if (d.leaf === 'swing') dm.group.rotation.y = (d.orient === 'h' ? -1 : 1) * k * Math.PI * 0.5;
      else if (d.leaf === 'slide') {
        dm.group.position.copy(dm.base);
        if (d.orient === 'h') dm.group.position.x += k * (d.width - 0.1);
        else dm.group.position.z += k * (d.width - 0.1);
      } else if (d.leaf === 'secret') dm.group.position.y = -k * (d.height + 0.05);
    }
  }

  // ---- Triggers: levers on a post, and floor plates ----
  const leverHandles = new Map();
  for (const tr of level.triggers) {
    if (tr.type === 'plate') {
      const g = new THREE.BoxGeometry(1.0, 0.03, 1.0);
      g.translate(tr.x, tr.y + 0.015, tr.z);
      const m = new THREE.Mesh(g, mats.plate);
      scene.add(m);
      leverHandles.set(tr.name, { mesh: m, type: 'plate' });
    } else {
      const pivot = new THREE.Group();
      pivot.position.set(tr.x, tr.y + 0.9, tr.z);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), mats.metal);
      handle.position.y = 0.25;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshLambertMaterial({ color: '#c0392b' }));
      ball.position.y = 0.5;
      pivot.add(handle, ball);
      pivot.rotation.z = 0.6;
      scene.add(pivot);
      leverHandles.set(tr.name, { mesh: pivot, type: 'lever' });
    }
  }
  function animateTriggers(triggerStates) {
    for (const ts of triggerStates || []) {
      const h = leverHandles.get(ts.def.name);
      if (!h) continue;
      if (h.type === 'lever') h.mesh.rotation.z += ((ts.fired ? -0.6 : 0.6) - h.mesh.rotation.z) * 0.2;
      else h.mesh.position.y = ts.fired ? -0.02 : 0;
    }
  }

  // ---- Glowing ceiling panels (look like lights), except in rooms open to the sky ----
  const panelMat = new THREE.MeshBasicMaterial({ color: '#fffdf2' });
  for (const r of level.rooms) {
    if (r.sky) continue;
    const pw = Math.min(r.w * 0.5, 4);
    const pd = Math.min(r.d * 0.5, 4);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), panelMat);
    panel.rotation.x = Math.PI / 2;
    panel.position.set(r.x + r.w / 2, r.floor + r.height - 0.01, r.z + r.d / 2);
    scene.add(panel);
  }

  // ---- Yellow/black hazard stripes along chasm edges ----
  const hazardTex = (() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 16;
    const g = c.getContext('2d');
    g.fillStyle = '#f2c230';
    g.fillRect(0, 0, 64, 16);
    g.fillStyle = '#222';
    for (let x = -16; x < 64; x += 32) {
      g.beginPath();
      g.moveTo(x, 16);
      g.lineTo(x + 16, 0);
      g.lineTo(x + 32, 0);
      g.lineTo(x + 16, 16);
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  })();
  for (const c of level.chasms) {
    const sw = 0.3; // stripe width
    const strips = [
      [c.x + c.w / 2, c.z - sw / 2, c.w, 0], // north edge
      [c.x + c.w / 2, c.z + c.d + sw / 2, c.w, 0], // south edge
      [c.x - sw / 2, c.z + c.d / 2, c.d, Math.PI / 2], // west edge
      [c.x + c.w + sw / 2, c.z + c.d / 2, c.d, Math.PI / 2], // east edge
    ];
    for (const [x, z, len, rot] of strips) {
      const tex = hazardTex.clone();
      tex.repeat.set(len / 1.2, 1);
      tex.needsUpdate = true;
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(len, sw), new THREE.MeshBasicMaterial({ map: tex }));
      strip.rotation.set(-Math.PI / 2, 0, rot);
      strip.position.set(x, c.floor + 0.006, z);
      scene.add(strip);
    }
  }

  // ---- Room numbers painted on the floor ----
  for (const r of level.rooms) {
    // Paint the number on open floor: the spot nearest the centre that is clear of
    // chasms, pools, stairs, platforms and pillars.
    const covered = (x, z) =>
      [...level.chasms, ...level.water, ...level.stairs, ...level.ramps, ...level.platforms].some((h) => x > h.x - 1 && x < h.x + h.w + 1 && z > h.z - 1 && z < h.z + h.d + 1) ||
      level.pillars.some((p) => Math.abs(p.x - x) < 1.2 && Math.abs(p.z - z) < 1.2);
    let cx = r.x + r.w / 2;
    let cz = r.z + r.d / 2;
    if (covered(cx, cz)) {
      let best = null;
      for (let x = r.x + 1.5; x <= r.x + r.w - 1.5; x += 0.5) {
        for (let z = r.z + 1.5; z <= r.z + r.d - 1.5; z += 0.5) {
          const dist = Math.hypot(x - cx, z - cz);
          if (!covered(x, z) && (!best || dist < best.dist)) best = { x, z, dist };
        }
      }
      if (best) {
        cx = best.x;
        cz = best.z;
      }
    }
    const size = Math.min(r.w, r.d, 5) * 0.7;
    const mat = new THREE.MeshBasicMaterial({
      map: labelTexture(String(r.id), r.name, { fg: 'rgba(29,53,87,0.75)' }),
      transparent: true,
      depthWrite: false,
    });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    label.rotation.x = -Math.PI / 2;
    label.position.set(cx, r.floor + 0.01, cz);
    scene.add(label);
  }

  // ---- Signs above every door: "Room N" of the room you are about to enter ----
  const t = level.settings.wallThickness;
  for (const d of level.doors) {
    if (d.leaf === 'secret') continue; // a sign would give the secret away
    const y = d.floor + d.height + 0.35;
    const sides = [
      // [room the sign is in, room number shown, offset from wall line, rotation]
      [d.lowRoom, d.highRoom, -(t / 2 + 0.01), d.orient === 'h' ? Math.PI : -Math.PI / 2],
      [d.highRoom, d.lowRoom, t / 2 + 0.01, d.orient === 'h' ? 0 : Math.PI / 2],
    ];
    for (const [, shows, off, rot] of sides) {
      const target = roomById.get(shows);
      const mat = new THREE.MeshBasicMaterial({
        map: labelTexture(`→ ${shows}`, target.name, { bg: '#1d3557', fg: '#ffffff', w: 512, h: 256 }),
      });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), mat);
      sign.rotation.y = rot;
      if (d.orient === 'h') sign.position.set(d.centre, y, d.line + off);
      else sign.position.set(d.line + off, y, d.centre);
      scene.add(sign);
    }
  }

  // ---- Numbered item spots (placeholders for future mnemonic objects) ----
  for (const it of level.items) {
    const mat = new THREE.SpriteMaterial({ map: labelTexture(String(it.id), '', { bg: 'rgba(0,0,0,0)', fg: '#8a5a00' }) });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.7, 0.7, 1);
    sprite.position.set(it.x, it.y + 1.5, it.z);
    scene.add(sprite);
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.fov = fovFor(camera.aspect);
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);

  // The eye height glides over stair steps instead of jumping 18 cm at a time.
  let eyeY = null;
  let lastT = performance.now();
  const underwaterFog = new THREE.Fog('#2f7fb0', 0.5, 14);
  function render(player, state = {}) {
    animateDoors(state.doors);
    animateTriggers(state.triggers);
    scene.fog = state.underwater ? underwaterFog : null;
    const now = performance.now();
    const dt = Math.min((now - lastT) / 1000, 0.1);
    lastT = now;
    const target = player.y + PLAYER.eyeHeight;
    if (eyeY === null || Math.abs(target - eyeY) > 0.6 || !player.grounded || player.climbing || player.swimming) eyeY = target;
    else eyeY += (target - eyeY) * Math.min(1, dt * 14);
    camera.position.set(player.x, eyeY, player.z);
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
    sky.position.copy(camera.position);
    renderer.render(scene, camera);
  }

  return { render, renderer, scene, camera };
}
