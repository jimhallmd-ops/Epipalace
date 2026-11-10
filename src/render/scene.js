// Draws the level. Every solid surface comes from level.boxes (the same boxes used for collision).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { floorTexture, wallTexture, labelTexture } from './textures.js';
import { PLAYER } from '../core/physics.js';

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

  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 200);
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
  for (const b of level.boxes) {
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

  // ---- Glowing ceiling panels (look like lights) ----
  const panelMat = new THREE.MeshBasicMaterial({ color: '#fffdf2' });
  for (const r of level.rooms) {
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
    let cx = r.x + r.w / 2;
    let cz = r.z + r.d / 2;
    const chasm = level.chasms.find((c) => cx > c.x - 1 && cx < c.x + c.w + 1 && cz > c.z - 1 && cz < c.z + c.d + 1);
    if (chasm) {
      cx = chasm.respawn.x;
      cz = chasm.respawn.z + 1.5;
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
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);

  function render(player) {
    camera.position.set(player.x, player.y + PLAYER.eyeHeight, player.z);
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
    renderer.render(scene, camera);
  }

  return { render, renderer, scene, camera };
}
